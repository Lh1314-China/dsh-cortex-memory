import { makeId } from '../../core/ids.js';
import { asJsonArray, stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';

function rowToSkill(row) {
  if (!row) return null;
  const success = Number(row.success_count ?? 0);
  const failure = Number(row.failure_count ?? 0);
  const total = success + failure;
  const rate = total ? success / total : 0;
  return {
    id: row.id,
    scopeId: row.scope_id,
    name: row.name,
    version: Number(row.version ?? 1),
    intent: row.intent,
    preconditions: asJsonArray(row.preconditions_json),
    steps: asJsonArray(row.steps_json),
    contraindications: asJsonArray(row.contraindications_json),
    successCount: success,
    failureCount: failure,
    successRate: rate,
    automaticity: Math.min(1, total / 10) * rate,
    lastUsedAt: row.last_used_at,
    state: row.state,
    sourceTraceIds: asJsonArray(row.source_trace_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSkillRepository(db) {
  function get(id) {
    return rowToSkill(db.prepare('SELECT * FROM skills WHERE id = ?').get(id));
  }

  function findByName(scopeId, name) {
    return rowToSkill(db.prepare('SELECT * FROM skills WHERE scope_id = ? AND name = ? ORDER BY version DESC LIMIT 1').get(scopeId, name));
  }

  function create({
    scopeId = 'global',
    name,
    intent = '',
    preconditions = [],
    steps = [],
    contraindications = [],
    sourceTraceIds = [],
    state = 'candidate',
  } = {}) {
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('skill name is required');
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('skill needs at least one step');
    const existing = findByName(scopeId, clean);
    if (existing) return existing;
    const id = makeId('skl');
    const now = nowIso();
    db.prepare(`
      INSERT INTO skills(id, scope_id, name, version, intent, preconditions_json, steps_json,
                         contraindications_json, success_count, failure_count, last_used_at,
                         state, source_trace_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?)
    `).run(
      id, scopeId, clean, intent,
      stableStringify(preconditions), stableStringify(steps), stableStringify(contraindications),
      state, stableStringify(sourceTraceIds), now, now,
    );
    return get(id);
  }

  function recordOutcome(id, success, { at = nowIso(), note = '' } = {}) {
    const skill = get(id);
    if (!skill) throw new Error(`skill not found: ${id}`);
    const successCount = skill.successCount + (success ? 1 : 0);
    const failureCount = skill.failureCount + (success ? 0 : 1);
    const total = successCount + failureCount;
    const rate = total ? successCount / total : 0;
    let state = skill.state;
    if (state === 'candidate' && total >= 3 && rate >= 0.7) state = 'trial';
    if (state === 'trial' && total >= 5 && rate >= 0.8) state = 'active';
    if (state === 'active' && total >= 4 && rate < 0.5) state = 'deprecated';
    if (state === 'trial' && total >= 4 && rate < 0.4) state = 'deprecated';
    db.prepare(`
      UPDATE skills SET success_count = ?, failure_count = ?, last_used_at = ?, state = ?, updated_at = ?
      WHERE id = ?
    `).run(successCount, failureCount, nowIso(), state, nowIso(), id);
    return { ...get(id), lastOutcome: { success, note, at } };
  }

  function setState(id, state) {
    db.prepare('UPDATE skills SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), id);
    return get(id);
  }

  function list({ scopeId = 'global', state = null, limit = 50 } = {}) {
    const count = Math.max(1, Math.min(1000, Number(limit) || 50));
    const rows = state
      ? db.prepare('SELECT * FROM skills WHERE scope_id = ? AND state = ? ORDER BY updated_at DESC LIMIT ?').all(scopeId, state, count)
      : db.prepare('SELECT * FROM skills WHERE scope_id = ? ORDER BY updated_at DESC LIMIT ?').all(scopeId, count);
    return rows.map(rowToSkill);
  }

  return { get, findByName, create, recordOutcome, setState, list };
}
