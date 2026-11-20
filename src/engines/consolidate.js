import { createHash } from 'node:crypto';
import { makeId } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { transaction } from '../store/database.js';

const PROTECTED_IMPORTANCE = 0.7;

// The protection line is one fixed, explainable threshold now:
//   >= 0.9  long-term identity level — only update / conflict, never archive or merge
//   0.7–0.9 important, may still be merged into a better copy
//   < 0.7   eligible for archive
// 0.4.116→0.4.130 computed it as the 75th percentile of the *batch*. Candidates were
// sorted by importance descending, so p75 was always the batch maximum and the line
// covered every candidate — the model could only answer keep. Percentiles of a
// self-selected top slice do not tell you anything about the store.
const PROTECTED_LINE = 0.9;

// A trace is not worth asking about twice within a day: the answer cannot change
// unless the input changes, and an all-keep run used to burn a fresh LLM call every
// 30 minutes on the same 20 traces.
const ASKED_WINDOW_MS = 24 * 3_600_000;

// Keep a caller-supplied similarity threshold inside a sane band: 0.5 is loose enough
// to find paraphrases, 0.99 never merges anything by accident.
export function clampThreshold(value) {
  return Math.min(0.99, Math.max(0.5, Number(value) || 0.8));
}
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

export function createConsolidationEngine({ db, traces, summaries = null, audit = null, llm = null, logger = null } = {}) {
  if (!db || !traces) throw new Error('consolidation engine needs db and traces');

  function record({ scopeId, at, status, model = null, inputDigest, input, decisions = [], applied = [], error = null, caller = 'unknown', groups = null, groupsDropped = null }) {
    const id = makeId('drn');
    db.prepare(`
      INSERT INTO dream_runs(id, scope_id, at, status, model, input_digest, input_json, decisions_json, applied_json, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, at, status, model, inputDigest, JSON.stringify(input), JSON.stringify(decisions), JSON.stringify(applied), error, nowIso());
    // `dream_runs` has no caller column (adding one means a migration), and two
    // runs a minute apart used to be unexplainable. The audit row keeps the actor.
    try {
      audit?.record?.({
        actor: 'system',
        action: 'consolidation.run',
        targetType: 'consolidation',
        targetId: id,
        detail: { caller, status, model, error, decisions: decisions.length, applied: applied.length, groups: groups ?? null, groupsDropped: groupsDropped ?? null },
      });
    } catch { /* audit is best effort, never fail a run for it */ }
    return { ...get(id), groups, groupsDropped };
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

  // One predicate for "may not be touched". The archive branch and the merge branch
// used to spell this out separately, and the merge branch forgot reflections: a
// low-importance reflection could be merged away as a source.
function isProtected(trace, protect = PROTECTED_IMPORTANCE) {
  return Number(trace?.importance ?? 0) >= protect || trace?.kind === 'reflection';
}

function validateDecision(decision, byId, protect = PROTECTED_IMPORTANCE, { allowProtectedMerge = false } = {}) {
    if (!decision || typeof decision !== 'object') return { ok: false, reason: 'not-an-object' };
    const action = String(decision.action ?? '').toLowerCase();
    if (!ALLOWED.has(action)) return { ok: false, reason: 'unknown-action' };
    const ids = Array.isArray(decision.ids) ? decision.ids.map(String) : [];
    if (ids.length === 0) return { ok: false, reason: 'missing-ids' };
    if (ids.some((id) => !byId.has(id))) return { ok: false, reason: 'unknown-id' };
    if (action === 'archive' && ids.some((id) => isProtected(byId.get(id), protect))) {
      return { ok: false, reason: 'protected' };
    }
    if (action === 'merge') {
      if (ids.length < 2) return { ok: false, reason: 'merge-needs-two' };
      const targetId = decision.targetId ? String(decision.targetId) : ids[0];
      if (!ids.includes(targetId)) return { ok: false, reason: 'merge-target-not-in-ids' };
      if (ids.some((id) => {
      if (id === targetId) return false;
      const trace = byId.get(id);
      // Reflections are never merge sources. High-importance traces may be sources
      // only when the caller already proved near-duplication (deterministic dedupe).
      return trace?.kind === 'reflection' || (!allowProtectedMerge && isProtected(trace, protect));
    })) return { ok: false, reason: 'protected-merge' };
      return { ok: true, action, ids, targetId, reason: String(decision.reason ?? '') };
    }
    if (action === 'update') {
      const content = String(decision.content ?? '').trim();
      if (!content || content.length > 2000) return { ok: false, reason: 'invalid-content' };
      return { ok: true, action, ids, content, reason: String(decision.reason ?? '') };
    }
    return { ok: true, action, ids, reason: String(decision.reason ?? '') };
  }

  // Trace ids that were already shown to the model during the window. dream_runs
  // keeps its input, so this needs no new table: read the recent rows and collect
  // the ids. A run with a broken input row is skipped, never fatal.
  // Preview rows are excluded: a dry run only rehearses, it does not consolidate,
  // so its candidates must stay available for the real pass.
  function askedIdsSince({ scopeId, sinceMs, maxRuns = 64 }) {
    const asked = new Set();
    try {
      const rows = db.prepare("SELECT input_json FROM dream_runs WHERE scope_id = ? AND at >= ? AND status != 'preview' ORDER BY at DESC LIMIT ?")
        .all(scopeId, new Date(sinceMs).toISOString(), Math.max(1, Math.min(200, Number(maxRuns) || 64)));
      for (const row of rows) {
        try {
          for (const item of JSON.parse(row.input_json)) {
            if (item && typeof item.id === 'string') asked.add(item.id);
          }
        } catch { /* one broken row must not hide the rest */ }
      }
    } catch { /* no run history means nothing was asked yet */ }
    return asked;
  }

  // Every trace already cited by a summary (episode, merge or thread) has a short
  // version of itself; re-summarising it buys nothing. This is the same "closed
  // loop" idea as profile coverage, measured in trace ids.
  function summarisedIds(scopeId) {
    const covered = new Set();
    try {
      for (const summary of (summaries?.list?.(scopeId, { limit: 500 }) ?? [])) {
        for (const sourceId of Array.isArray(summary.sourceIds) ? summary.sourceIds : []) covered.add(sourceId);
      }
    } catch { /* coverage is an optimisation, never a reason to fail a run */ }
    return covered;
  }

  async function run({ scopeId = 'global', now = Date.now(), limit = 30, dryRun = false, model = null, force = false, caller = 'unknown', spread = false } = {}) {
    const at = nowIso(now);
    // 500, not 200: the old pool silently hid anything older than the newest 200
    // active traces from consolidation (the LLM still receives at most `limit`).
    //
    // Selection is the opposite of 0.4.116→0.4.130: those versions sorted by
    // importance descending, so the model was always handed the batch its own
    // prompt protects (99% of the production store is >= 0.7 and the top slice is all
    // 1.0) and could only answer keep. Rank the other end first instead:
    //   1. no summary covers the trace yet,
    //   2. it was not shown to the model in the last 24h,
    //   3. lowest importance, oldest first.
    // Asked traces sink to the bottom rather than disappear: when every trace has
    // been asked, the run rotates back over the stale end instead of going idle.
    const pool = traces.list({ scopeId, state: 'active', limit: 500 });
    const covered = summarisedIds(scopeId);
    const asked = askedIdsSince({ scopeId, sinceMs: now - ASKED_WINDOW_MS });
    const ranked = pool
      .slice()
      .sort((a, b) => {
        const coveredA = covered.has(a.id) ? 1 : 0;
        const coveredB = covered.has(b.id) ? 1 : 0;
        const askedA = asked.has(a.id) ? 1 : 0;
        const askedB = asked.has(b.id) ? 1 : 0;
        return coveredA - coveredB
          || askedA - askedB
          || Number(a.importance) - Number(b.importance)
          || String(a.recordedAt).localeCompare(String(b.recordedAt));
      });
    const count = Math.max(1, Math.min(80, Number(limit) || 30));
    // A daily deep pass needs spread, not depth in one band: ranking from the low
    // end put all 60 candidates at importance 0.7 (the next untouched band). Spread
    // takes half from the low end and samples the rest evenly, so one pass sees the
    // whole store's shape.
    let candidates;
    if (spread && ranked.length > count) {
      const half = Math.ceil(count / 2);
      const low = ranked.slice(0, half);
      const rest = ranked.slice(half);
      const remainder = Math.min(count - low.length, rest.length);
      const sampled = [];
      if (remainder > 0) {
        const stride = rest.length / remainder;
        for (let index = 0; index < remainder; index += 1) {
          sampled.push(rest[Math.min(rest.length - 1, Math.floor(index * stride))]);
        }
      }
      candidates = [...low, ...sampled];
    } else {
      candidates = ranked.slice(0, count);
    }
    const input = candidates.map((trace) => ({ id: trace.id, kind: trace.kind, title: trace.title, content: String(trace.content).slice(0, 600), importance: trace.importance, recordedAt: trace.recordedAt }));
    const protect = PROTECTED_LINE;
    const protectedCount = input.filter((item) => isProtected(item, protect)).length;
    // Capture already rejects byte-identical traces, so exact matching finds
    // nothing. Group by shared 2-gram shingles instead: rephrased repeats are what
    // actually reaches consolidation.
    const shingles = (value) => {
      const flat = String(value ?? '').replace(/\s+/g, '');
      const set = new Set();
      for (let i = 0; i + 2 <= flat.length; i += 1) set.add(flat.slice(i, i + 2));
      return set;
    };
    const jaccard = (a, b) => {
      if (a.size === 0 || b.size === 0) return 0;
      let shared = 0;
      for (const gram of a) if (b.has(gram)) shared += 1;
      return shared / (a.size + b.size - shared);
    };
    const grams = candidates.map((trace) => shingles(`${trace.title ?? ''}${trace.content ?? ''}`));
    const parent = candidates.map((_, index) => index);
    const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        if (jaccard(grams[i], grams[j]) >= 0.6) parent[find(j)] = find(i);
      }
    }
    const clusters = new Map();
    candidates.forEach((trace, index) => {
      const root = find(index);
      const bucket = clusters.get(root) ?? [];
      bucket.push(trace.id);
      clusters.set(root, bucket);
    });
    const protectedIds = new Set(input.filter((item) => isProtected(item, protect)).map((item) => item.id));
    // validateDecision rejects a merge whose non-target member is protected, so a
    // group with two protected members can never be applied. Drop those instead of
    // handing the model a decision that is guaranteed to fail. When exactly one is
    // protected it must be the merge target — say so structurally instead of hoping
    // the model guesses which one is on the protection line.
    const allGroups = [...clusters.values()].filter((ids) => ids.length > 1);
    const duplicateGroups = [];
    let droppedGroups = 0;
    for (const ids of allGroups) {
      const protectedIn = ids.filter((id) => protectedIds.has(id));
      if (protectedIn.length >= 2) {
        droppedGroups += 1;
        continue;
      }
      duplicateGroups.push(protectedIn.length === 1 ? { ids, mustBeTarget: protectedIn[0] } : { ids });
    }
    const inputDigest = digest(`run:${JSON.stringify(input)}`);
    // Idempotence gate. Only a run the model actually answered means "this batch
    // was handled": `applied` and `degraded` both carry a real answer. A preview
    // (rehearsal) and a rejected batch (the model's own bad output) always let the
    // next pass through. A skipped row is special only while there is no adapter:
    // without one, every tick would otherwise rewrite the same "no-llm" row.
    // 0.4.130 short-circuited skipped rows unconditionally, so an applied keep-only
    // run still cost a fresh LLM call every 30 minutes on an identical input.
    const hasAdapter = Boolean(llm && typeof llm.complete === 'function');
    const previous = list({ scopeId, limit: 1 })[0] ?? null;
    const answered = Boolean(previous) && (previous.status === 'applied' || previous.status === 'degraded');
    const noisySkip = !hasAdapter && Boolean(previous) && previous.status === 'skipped' && previous.inputDigest === inputDigest;
    const unchanged = !force && Boolean(previous) && previous.inputDigest === inputDigest && (answered || noisySkip);
    if (unchanged) {
      return { run: previous, applied: [], decisions: [], skipped: 'unchanged' };
    }
    if (!input.length) {
      return { run: record({ scopeId, at, caller, status: 'skipped', model, inputDigest, input, error: 'no-active-traces' }), applied: [], decisions: [] };
    }

    let raw = null;
    let retried = false;
    let bounded = false;
    let failureReason = null;
    const ask = async (items, maxContent, maxTokens = 900) => {
      const payload = items.map((item) => ({ ...item, content: String(item.content ?? '').slice(0, maxContent) }));
      try {
        return await llm.complete({
          system: `你是记忆巩固器。只输出 JSON 数组，不要解释。允许 action: keep/merge/archive/update/conflict。每条必须有 ids；merge 的 ids 至少两条（合并方 + 被合并方），targetId 必须是 ids 里的一条、通常是保留信息最全的那条，只带一条 id 的 merge 会被拒绝；update 还要 content。不得归档 importance>=${protect} 或 reflection。`,
          prompt: `候选记忆：\n${JSON.stringify(payload, null, 2)}\n\n本次保护线 importance>=${protect}，共 ${protectedCount} 条受保护；低于保护线、且内容与他条重复或被已有摘要覆盖的，优先 merge，其次 archive；没有可合并的就 keep。merge 必须一次给出所有参与合并的 ids（至少两条），并把要保留的那条写进 targetId。${allProtected ? '\n注意：本批全部在保护线上，不要提出 archive 或 merge；如某条内容需要更正，用 update（提供 content），矛盾则用 conflict。' : ''}${duplicateGroups.length ? `\n已检测到这些重复组，请用 merge 合并；带 mustBeTarget 的组，targetId 必须是 mustBeTarget 指定的那条：${JSON.stringify(duplicateGroups)}` : ''}输出决策数组。`,
          maxTokens: Math.max(900, maxTokens),
          temperature: 0.1,
          purpose: 'cortex-consolidate',
          // A per-call callback keeps the reason scoped to this run; a shared
          // adapter field could be reset or overwritten by an interleaved
          // dream / feeling / summarize call.
          onReason: (reason) => { failureReason = reason; },
        });
      } catch (error) {
        failureReason = 'exception-outer';
        try { logger?.warn?.(`cortex consolidate ask failed: ${error instanceof Error ? error.message : String(error)}`); } catch { /* logging is best effort */ }
        return null;
      }
    };
    // Everything on the protection line: archive/merge would only be rejected, but
    // update/conflict are non-destructive and must stay available, so the batch is
    // still sent — with a prompt that excludes the doomed actions.
    const allProtected = protectedCount === input.length;
    if (hasAdapter) {
      // Live evidence (2026-11-16): the installed 0.4.103 recorded
      // `llm-empty:empty-text:max-tokens` — the answer was cut off by the output
      // budget, not rejected. So the fix is a bigger budget plus a bounded prompt:
      // rounding 900 was simply too small once reasoning tokens are counted.
      const big = JSON.stringify(input).length > 5000;
      if (big && input.length > 20) {
        bounded = true;
        raw = await ask(input.slice(0, 20), 300, 6000);
        if (!raw) {
          retried = true;
          raw = await ask(input.slice(0, 10), 220, 6000);
        }
      } else {
        raw = await ask(input, 600, 3000);
        if (!raw && input.length > 10) {
          retried = true;
          raw = await ask(input.slice(0, 10), 220, 6000);
        }
      }
    }
    if (!raw) {
      // "No adapter at all" and "adapter answered nothing" need different fixes;
      // the old shared `no-llm` label hid which one was happening. Carry the
      // adapter's own reason too, and mark whether the slim retry already ran —
      // otherwise "retried and still empty" looks identical to "empty first try".
      const reason = hasAdapter ? (failureReason ?? (typeof llm.lastFailure === 'function' ? llm.lastFailure() : null)) : null;
      const label = hasAdapter ? `llm-empty${retried ? '-retry' : ''}${reason ? `:${reason}` : ''}` : 'no-llm-adapter';
      return { run: record({ scopeId, at, caller, status: 'skipped', model, inputDigest, input, error: label, groups: duplicateGroups.length, groupsDropped: droppedGroups }), applied: [], decisions: [] };
    }
    const parsed = parseJsonArray(raw);
    if (!parsed) {
      return { run: record({ scopeId, at, caller, status: 'rejected', model, inputDigest, input, error: 'invalid-json', groups: duplicateGroups.length, groupsDropped: droppedGroups }), applied: [], decisions: [] };
    }

    const byId = new Map(candidates.map((trace) => [trace.id, trace]));
    const decisions = [];
    const applied = [];
    const rejected = [];
    const rejectReason = (reason) => {
      const tally = rejected.reduce((acc, item) => { acc[item.reason] = (acc[item.reason] ?? 0) + 1; return acc; }, {});
      return `（${Object.entries(tally).map(([key, count]) => `${key}×${count}`).join(' · ')}）`;
    };
    for (const decision of parsed.slice(0, 20)) {
      const valid = validateDecision(decision, byId, protect);
      if (!valid.ok) { rejected.push({ decision, reason: valid.reason }); continue; }
      decisions.push(valid);
    }
    if (dryRun) {
      // Dry runs are recorded as `preview`, never as `degraded`/`applied`: a
      // rehearsal must not count as "asked" (it would push the batch out of the
      // next real pass) and must not satisfy the idempotence gate.
      const run = record({ scopeId, at, caller, status: 'preview', model: retried ? `${model ?? 'llm'}-retry` : (bounded ? `${model ?? 'llm'}-bounded` : model), inputDigest, input, decisions, applied: [], error: rejected.length ? `dry-run; rejected ${rejected.length}${rejectReason()}` : 'dry-run', groups: duplicateGroups.length, groupsDropped: droppedGroups });
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
    const run = record({ scopeId, at, caller, status, model: retried ? `${model ?? 'llm'}-retry` : (bounded ? `${model ?? 'llm'}-bounded` : model), inputDigest, input, decisions, applied, error: rejected.length ? `rejected ${rejected.length}${rejectReason()}` : null, groups: duplicateGroups.length, groupsDropped: droppedGroups });
    audit?.record?.({ actor: 'system', action: 'dream.run', targetType: 'dream-run', targetId: run.id, detail: { status, applied: applied.length, rejected: rejected.length, digest: inputDigest } });
    return { run, applied, decisions, rejected };
  }


  function shinglesOf(value) {
    const flat = String(value ?? '').replace(/\s+/g, '');
    const set = new Set();
    for (let i = 0; i + 2 <= flat.length; i += 1) set.add(flat.slice(i, i + 2));
    return set;
  }

  function jaccardOf(a, b) {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const gram of a) if (b.has(gram)) shared += 1;
    return shared / (a.size + b.size - shared);
  }

  /**
   * Deterministic dedupe: merge near-duplicate traces without asking the model.
   * The LLM kept answering "keep" even when it was handed duplicate groups, so the
   * mechanical part of consolidation must not depend on its mood. A protected trace
   * can only ever be the merge target, never a source.
   */
  async function dedupe({ scopeId = 'global', now = Date.now(), limit = 30, threshold = 0.8, dryRun = false, caller = 'unknown', force = false } = {}) {
    const at = nowIso(now);
    const preview = Boolean(dryRun);
    const simThreshold = clampThreshold(threshold);
    // Near-duplicates cluster at the low-importance end ("重复投递不再念" receipts,
    // one-off acknowledgements, fragments), but they are not exclusive to it. Take
    // half from the lowest-importance end and sample the other half evenly across
    // the rest, so a duplicate pair in the middle of the distribution is still seen.
    // The merge target is still chosen by highest importance (most informative copy).
    const pool = traces.list({ scopeId, state: 'active', limit: 500 });
    const count = Math.max(2, Math.min(160, Number(limit) || 30));
    const sortedAsc = pool.slice().sort((a, b) => Number(a.importance) - Number(b.importance) || String(a.recordedAt).localeCompare(String(b.recordedAt)));
    const half = Math.ceil(count / 2);
    const lowHalf = sortedAsc.slice(0, Math.min(half, sortedAsc.length));
    const rest = sortedAsc.slice(lowHalf.length);
    const sampled = [];
    const remaining = Math.min(count - lowHalf.length, rest.length);
    if (remaining > 0) {
      const stride = rest.length / remaining;
      for (let index = 0; index < remaining; index += 1) {
        sampled.push(rest[Math.min(rest.length - 1, Math.floor(index * stride))]);
      }
    }
    const candidates = [...lowHalf, ...sampled];
    const protect = PROTECTED_LINE;
    // A reflection is a synthesis, not a duplicate: it never takes part in dedupe.
    const dedupePool = candidates.filter((trace) => trace.kind !== 'reflection');
    const grams = new Map(dedupePool.map((trace) => [trace.id, shinglesOf(`${trace.title ?? ''}${trace.content ?? ''}`)]));
    const parent = new Map(dedupePool.map((trace) => [trace.id, trace.id]));
    const find = (id) => {
      const next = parent.get(id);
      if (!next || next === id) return id;
      const root = find(next);
      parent.set(id, root);
      return root;
    };
    for (let i = 0; i < dedupePool.length; i += 1) {
      for (let j = i + 1; j < dedupePool.length; j += 1) {
        if (jaccardOf(grams.get(dedupePool[i].id), grams.get(dedupePool[j].id)) >= simThreshold) {
          parent.set(find(dedupePool[j].id), find(dedupePool[i].id));
        }
      }
    }
    const clusters = new Map();
    for (const trace of dedupePool) {
      const root = find(trace.id);
      const bucket = clusters.get(root) ?? [];
      bucket.push(trace);
      clusters.set(root, bucket);
    }
    const decisions = [];
    let droppedGroups = 0;
    for (const group of clusters.values()) {
      if (group.length < 2) continue;
      // Live store has 75% of active traces at importance >= 0.95, so "two protected
      // members" is the normal case, not the exception. Dedupe has already proved the
      // members are near-duplicates (Jaccard >= simThreshold), so keeping N copies buys
      // nothing; reflections were excluded from the pool above.
      const target = [...group].sort((a, b) => Number(b.importance) - Number(a.importance) || String(b.content ?? '').length - String(a.content ?? '').length)[0];
      // Union-find is transitive: A~B and B~C can pull in an A that is not similar to
      // C at all. Only merge members that are near-duplicates *of the target*.
      const members = group.filter((trace) => trace.id === target.id || jaccardOf(grams.get(trace.id), grams.get(target.id)) >= simThreshold);
      if (members.length < 2) {
        droppedGroups += 1;
        continue;
      }
      const ids = [target.id, ...members.filter((trace) => trace.id !== target.id).map((trace) => trace.id)];
      const valid = validateDecision({ action: 'merge', ids, targetId: target.id, reason: 'dedupe' }, new Map(candidates.map((trace) => [trace.id, trace])), protect, { allowProtectedMerge: true });
      if (!valid.ok) {
        droppedGroups += 1;
        continue;
      }
      decisions.push(valid);
    }

    const inputDigest = digest(`dedupe:${JSON.stringify(decisions.map((decision) => decision.ids))}`);
    // Same idempotence gate as run(), with the same rule: a preview row is a
    // rehearsal and must not block the real pass on the identical decision set.
    if (!force) {
      const previous = db.prepare("SELECT id, input_digest FROM dream_runs WHERE scope_id = ? AND model = 'dedupe' AND status != 'preview' ORDER BY at DESC LIMIT 1").get(scopeId);
      if (previous && previous.input_digest === inputDigest) {
        return { run: { ...get(previous.id), groups: decisions.length, groupsDropped: droppedGroups }, applied: [], decisions, dryRun: preview, skipped: 'unchanged' };
      }
    }
    const applied = [];
    if (!preview && decisions.length) {
      transaction(db, () => {
        for (const decision of decisions) {
          const losers = decision.ids.filter((id) => id !== decision.targetId);
          for (const id of losers) {
            traces.update(id, { state: 'archived', compression: 'merged' });
            applied.push({ action: 'merge', id, targetId: decision.targetId });
          }
          if (summaries && losers.length) {
            try {
              summaries.insert({
              scopeId, level: 'merge', content: `去重合并 ${losers.length} 条到 ${decision.targetId}${losers.length ? `（含：${losers.map((id) => String(candidates.find((trace) => trace.id === id)?.title ?? id).slice(0, 40)).join(' / ')}）` : ''}`,
              sourceIds: [...decision.ids], coverage: 1, model: 'dedupe',
              });
            } catch { /* provenance is best effort */ }
          }
        }
      });
    }

    const run = record({
      scopeId, at, caller, status: dryRun ? 'preview' : (applied.length ? 'applied' : 'skipped'),
      model: 'dedupe', inputDigest, input: candidates.map((trace) => ({ id: trace.id, title: trace.title })),
      decisions, applied, error: null,
      groups: decisions.length, groupsDropped: droppedGroups,
    });
    return { run, applied, decisions, dryRun: preview };
  }

  return { run, dedupe, list, get, parseJsonArray };
}
