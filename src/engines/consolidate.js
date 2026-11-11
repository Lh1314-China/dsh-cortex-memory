import { createHash } from 'node:crypto';
import { makeId } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { transaction } from '../store/database.js';

const PROTECTED_IMPORTANCE = 0.7;
const ALLOWED = new Set(['keep', 'merge', 'archive', 'update', 'conflict']);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseJsonArray(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createConsolidationEngine({ db, traces, summaries = null, audit = null, llm = null } = {}) {
  if (!db || !traces) throw new Error('consolidation engine needs db and traces');

  function record({ scopeId, at, status, model = null, inputDigest, input, decisions = [], applied = [], error = null }) {
    const id = makeId('drn');
    db.prepare(`
      INSERT INTO dream_runs(id, scope_id, at, status, model, input_digest, input_json, decisions_json, applied_json, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, at, status, model, inputDigest, JSON.stringify(input), JSON.stringify(decisions), JSON.stringify(applied), error, nowIso());
    return get(id);
  }

  function get(id) {
    const row = db.prepare('SELECT * FROM dream_runs WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id, scopeId: row.scope_id, at: row.at, status: row.status, model: row.model,
      inputDigest: row.input_digest, input: JSON.parse(row.input_json), decisions: JSON.parse(row.decisions_json),
      applied: JSON.parse(row.applied_json), error: row.error, createdAt: row.created_at,
    };
  }

  function list({ scopeId = 'global', limit = 20 } = {}) {
    return db.prepare('SELECT * FROM dream_runs WHERE scope_id = ? ORDER BY at DESC LIMIT ?')
      .all(scopeId, Math.max(1, Math.min(200, Number(limit) || 20)))
      .map((row) => get(row.id));
  }

  function validateDecision(decision, byId) {
    if (!decision || typeof decision !== 'object') return { ok: false, reason: 'not-an-object' };
    const action = String(decision.action ?? '').toLowerCase();
    if (!ALLOWED.has(action)) return { ok: false, reason: 'unknown-action' };
    const ids = Array.isArray(decision.ids) ? decision.ids.map(String) : [];
    if (ids.length === 0) return { ok: false, reason: 'missing-ids' };
    if (ids.some((id) => !byId.has(id))) return { ok: false, reason: 'unknown-id' };
    if (action === 'archive' && ids.some((id) => byId.get(id).importance >= PROTECTED_IMPORTANCE || byId.get(id).kind === 'reflection')) {
      return { ok: false, reason: 'protected' };
    }
    if (action === 'merge') {
      if (ids.length < 2) return { ok: false, reason: 'merge-needs-two' };
      const targetId = decision.targetId ? String(decision.targetId) : ids[0];
      if (!ids.includes(targetId)) return { ok: false, reason: 'merge-target-not-in-ids' };
      if (ids.some((id) => byId.get(id).importance >= PROTECTED_IMPORTANCE && id !== targetId)) return { ok: false, reason: 'protected-merge' };
      return { ok: true, action, ids, targetId, reason: String(decision.reason ?? '') };
    }
    if (action === 'update') {
      const content = String(decision.content ?? '').trim();
      if (!content || content.length > 2000) return { ok: false, reason: 'invalid-content' };
      return { ok: true, action, ids, content, reason: String(decision.reason ?? '') };
    }
    return { ok: true, action, ids, reason: String(decision.reason ?? '') };
  }

  async function run({ scopeId = 'global', now = Date.now(), limit = 30, dryRun = false, model = null } = {}) {
    const at = nowIso(now);
    const candidates = traces.list({ scopeId, state: 'active', limit: 200 })
      .sort((a, b) => Number(b.importance) - Number(a.importance) || String(a.recordedAt).localeCompare(String(b.recordedAt)))
      .slice(0, Math.max(1, Math.min(80, Number(limit) || 30)));
    const input = candidates.map((trace) => ({ id: trace.id, kind: trace.kind, title: trace.title, content: String(trace.content).slice(0, 600), importance: trace.importance, recordedAt: trace.recordedAt }));
    const inputDigest = digest(JSON.stringify(input));
    if (!input.length) {
      return { run: record({ scopeId, at, status: 'skipped', model, inputDigest, input, error: 'no-active-traces' }), applied: [], decisions: [] };
    }

    let raw = null;
    if (llm && typeof llm.complete === 'function') {
      try {
        raw = await llm.complete({
          system: '你是记忆巩固器。只输出 JSON 数组，不要解释。允许 action: keep/merge/archive/update/conflict。每条必须有 ids；merge 还要 targetId；update 还要 content。不得归档 importance>=0.7 或 reflection。',
          prompt: `候选记忆：\n${JSON.stringify(input, null, 2)}\n\n输出决策数组。`,
          maxTokens: 900,
          temperature: 0.1,
          purpose: 'cortex-consolidate',
        });
      } catch {
        raw = null;
      }
    }
    if (!raw) {
      return { run: record({ scopeId, at, status: 'skipped', model, inputDigest, input, error: 'no-llm' }), applied: [], decisions: [] };
    }
    const parsed = parseJsonArray(raw);
    if (!parsed) {
      return { run: record({ scopeId, at, status: 'rejected', model, inputDigest, input, error: 'invalid-json' }), applied: [], decisions: [] };
    }

    const byId = new Map(candidates.map((trace) => [trace.id, trace]));
    const decisions = [];
    const applied = [];
    const rejected = [];
    for (const decision of parsed.slice(0, 20)) {
      const valid = validateDecision(decision, byId);
      if (!valid.ok) { rejected.push({ decision, reason: valid.reason }); continue; }
      decisions.push(valid);
    }
    if (dryRun) {
      const status = rejected.length ? (decisions.length ? 'degraded' : 'rejected') : 'applied';
      const run = record({ scopeId, at, status, model, inputDigest, input, decisions, applied: [], error: rejected.length ? `dry-run; rejected ${rejected.length}` : null });
      return { run, applied: [], decisions, rejected, dryRun: true };
    }

    transaction(db, () => {
      for (const decision of decisions) {
        if (decision.action === 'archive') {
          for (const id of decision.ids) {
            traces.update(id, { state: 'archived', compression: 'dream' });
            applied.push({ action: 'archive', id });
          }
        } else if (decision.action === 'merge') {
          const losers = decision.ids.filter((id) => id !== decision.targetId);
          for (const id of losers) {
            traces.update(id, { state: 'archived', compression: 'merged' });
            applied.push({ action: 'merge', id, targetId: decision.targetId });
          }
          if (summaries && losers.length) {
            summaries.insert({
              scopeId, level: 'merge', content: `合并 ${losers.length} 条到 ${decision.targetId}`,
              sourceIds: [...decision.ids], coverage: 1, model: model ?? 'cortex-consolidate',
            });
          }
        } else if (decision.action === 'update') {
          traces.update(decision.ids[0], { content: decision.content });
          applied.push({ action: 'update', id: decision.ids[0] });
        } else if (decision.action === 'conflict') {
          applied.push({ action: 'conflict', ids: decision.ids, reason: decision.reason });
        }
      }
    });

    const status = rejected.length ? (decisions.length ? 'degraded' : 'rejected') : 'applied';
    const run = record({ scopeId, at, status, model, inputDigest, input, decisions, applied, error: rejected.length ? `rejected ${rejected.length}` : null });
    audit?.record?.({ actor: 'system', action: 'dream.run', targetType: 'dream-run', targetId: run.id, detail: { status, applied: applied.length, rejected: rejected.length, digest: inputDigest } });
    return { run, applied, decisions, rejected };
  }

  return { run, list, get, parseJsonArray };
}
