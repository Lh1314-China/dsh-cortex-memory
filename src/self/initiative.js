import { clamp, nowIso } from '../core/time.js';
import { makeId } from '../core/ids.js';

export const INTENTION_KINDS = Object.freeze([
  'recall', 'question', 'consolidate', 'express', 'propose', 'external',
]);

export const DEFAULT_INITIATIVE_POLICY = Object.freeze({
  maxPerHour: 3,
  maxPerTurn: 2,
  minPriority: 0.35,
  cooldownMs: Object.freeze({
    recall: 5 * 60_000,
    question: 30 * 60_000,
    consolidate: 6 * 60 * 60_000,
    express: 2 * 60 * 60_000,
    propose: 24 * 60 * 60_000,
    external: 60 * 60_000,
  }),
  quietHours: Object.freeze([]),
});

function inQuietHours(now, quietHours) {
  if (!Array.isArray(quietHours) || quietHours.length === 0) return false;
  const hour = new Date(now).getHours();
  return quietHours.some(([from, to]) => (from <= to ? hour >= from && hour < to : hour >= from || hour < to));
}

export function proposeIntentions({
  selfState = null,
  appraisal = null,
  unresolvedDisputes = 0,
  pendingQuestions = 0,
  lastConsolidationAt = null,
  now = Date.now(),
} = {}) {
  const out = [];
  const drives = selfState?.drives ?? {};
  const push = (kind, priority, reason, payload = {}) => {
    out.push({
      kind,
      priority: clamp(priority, 0, 1),
      reason,
      payload,
      createdAt: nowIso(now),
      dueAt: new Date(now + 60_000).toISOString(),
      expiresAt: new Date(now + 6 * 60 * 60_000).toISOString(),
    });
  };

  if (unresolvedDisputes > 0) {
    push('question', 0.8, `有 ${unresolvedDisputes} 条事实冲突需要确认`, { topic: 'dispute', count: unresolvedDisputes });
  }
  if (appraisal?.threat > 0.55 && (drives.safety ?? 0.7) < 0.6) {
    push('question', 0.75, '感觉到边界/安全压力，想先确认', { topic: 'boundary' });
  }
  if ((drives.coherence ?? 0.6) < 0.4 && (!lastConsolidationAt || now - Date.parse(lastConsolidationAt) > 3 * 60 * 60_000)) {
    push('consolidate', 0.7, '自我/世界模型出现不一致，想整理一下', { reason: 'coherence' });
  }
  if (appraisal?.identityRelevance > 0.6 && appraisal?.novelty > 0.35) {
    push('propose', 0.62, '这段经历可能改变自我叙事，想提案', { topic: 'identity', traceId: appraisal.traceId ?? null });
  }
  if ((drives.curiosity ?? 0.55) > 0.7 && (appraisal?.novelty ?? 0) > 0.55 && pendingQuestions < 1) {
    push('question', 0.55, '有新的、不确定的信息，想问清楚', { topic: 'curiosity', text: appraisal?.text ?? '' });
  }
  if ((drives.care ?? 0.6) < 0.4) {
    push('express', 0.5, '想确认一下关系状态', { topic: 'care' });
  }
  if ((drives.expression ?? 0.5) > 0.78 && Math.abs(appraisal?.valence ?? 0) > 0.45) {
    push('express', 0.45, '有较强的内在状态想表达', { topic: 'expression', valence: appraisal.valence });
  }
  if ((drives.autonomy ?? 0.55) < 0.35 && (appraisal?.relevance ?? 0) > 0.5) {
    push('recall', 0.4, '想主动找回相关记忆，参与当前事情', { topic: 'autonomy' });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export function filterIntentions(intentions, {
  now = Date.now(),
  recent = [],
  policy = DEFAULT_INITIATIVE_POLICY,
} = {}) {
  if (inQuietHours(now, policy.quietHours)) return [];
  const hourAgo = now - 60 * 60_000;
  const recentThisHour = recent.filter((item) => Date.parse(item.createdAt) >= hourAgo);
  let slots = Math.max(0, policy.maxPerHour - recentThisHour.length);
  if (slots <= 0) return [];
  const lastByKind = new Map();
  for (const item of recent) {
    const at = Date.parse(item.createdAt);
    const current = lastByKind.get(item.kind);
    if (!Number.isFinite(current) || at > current) lastByKind.set(item.kind, at);
  }
  const selected = [];
  for (const intention of intentions) {
    if (selected.length >= policy.maxPerTurn || slots <= 0) break;
    if (intention.priority < policy.minPriority) continue;
    const cooldown = policy.cooldownMs[intention.kind] ?? 0;
    const last = lastByKind.get(intention.kind);
    if (Number.isFinite(last) && now - last < cooldown) continue;
    selected.push(intention);
    slots -= 1;
  }
  return selected;
}

export function createInitiativeStore(db) {
  function insert(intention, { scopeId = 'global', status = 'pending' } = {}) {
    const id = makeId('itn');
    db.prepare(`
      INSERT INTO intentions(id, scope_id, kind, priority, status, payload_json, reason,
                             created_at, due_at, expires_at, cooldown_until, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id, scopeId, intention.kind, intention.priority, status,
      JSON.stringify(intention.payload ?? {}), intention.reason ?? null,
      intention.createdAt, intention.dueAt ?? null, intention.expiresAt ?? null,
      intention.cooldownUntil ?? null,
    );
    return get(id);
  }

  function get(id) {
    const row = db.prepare('SELECT * FROM intentions WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      scopeId: row.scope_id,
      kind: row.kind,
      priority: Number(row.priority),
      status: row.status,
      payload: JSON.parse(row.payload_json),
      reason: row.reason,
      createdAt: row.created_at,
      dueAt: row.due_at,
      expiresAt: row.expires_at,
      cooldownUntil: row.cooldown_until,
      result: row.result_json ? JSON.parse(row.result_json) : null,
    };
  }

  function pending(scopeId = 'global', { now = Date.now(), limit = 20 } = {}) {
    const rows = db.prepare(`
      SELECT * FROM intentions
      WHERE scope_id = ? AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `).all(scopeId, new Date(now).toISOString(), Math.max(1, Math.min(100, limit)));
    return rows.map((row) => get(row.id));
  }

  function recent(scopeId = 'global', { now = Date.now(), hours = 24, limit = 100 } = {}) {
    const from = new Date(now - hours * 3600_000).toISOString();
    const rows = db.prepare('SELECT * FROM intentions WHERE scope_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?')
      .all(scopeId, from, Math.max(1, Math.min(500, limit)));
    return rows.map((row) => get(row.id));
  }

  function mark(id, status, result = null) {
    db.prepare('UPDATE intentions SET status = ?, result_json = ? WHERE id = ?')
      .run(status, result ? JSON.stringify(result) : null, id);
    return get(id);
  }

  return { insert, get, pending, recent, mark };
}

export function selectIntentions({
  selfState,
  appraisal,
  unresolvedDisputes = 0,
  pendingQuestions = 0,
  lastConsolidationAt = null,
  store = null,
  scopeId = 'global',
  now = Date.now(),
  policy = DEFAULT_INITIATIVE_POLICY,
  recent = [],
} = {}) {
  const proposed = proposeIntentions({
    selfState, appraisal, unresolvedDisputes, pendingQuestions, lastConsolidationAt, now,
  });
  const filtered = filterIntentions(proposed, { now, recent, policy });
  if (!store) return filtered;
  return filtered.map((intention) => store.insert(intention, { scopeId }));
}
