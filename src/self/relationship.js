import { makeId } from '../core/ids.js';
import { clamp, nowIso } from '../core/time.js';
import { CortexError, ERROR_CODES } from '../core/errors.js';

export function normalizeRelationship(input = {}) {
  return {
    target: String(input.target ?? '').trim(),
    trust: clamp(input.trust ?? 0.5, 0, 1),
    care: clamp(input.care ?? 0.5, 0, 1),
    familiarity: clamp(input.familiarity ?? 0, 0, 1),
    expectations: Array.isArray(input.expectations) ? input.expectations.map(String).slice(0, 20) : [],
    boundaries: Array.isArray(input.boundaries) ? input.boundaries.map(String).slice(0, 30) : [],
    recent: Array.isArray(input.recent) ? input.recent.slice(-30) : [],
  };
}

function rowToRelationship(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    target: row.target,
    trust: Number(row.trust),
    care: Number(row.care),
    familiarity: Number(row.familiarity),
    expectations: JSON.parse(row.expectations_json),
    boundaries: JSON.parse(row.boundaries_json),
    recent: JSON.parse(row.recent_json),
    updatedAt: row.updated_at,
  };
}

export function createRelationshipStore(db) {
  function get(scopeId, target) {
    return rowToRelationship(db.prepare('SELECT * FROM relationships WHERE scope_id = ? AND target = ?').get(scopeId, target));
  }

  function ensure(scopeId = 'global', target = '用户') {
    const current = get(scopeId, target);
    if (current) return current;
    const id = makeId('rel');
    const now = nowIso();
    db.prepare(`
      INSERT INTO relationships(id, scope_id, target, trust, care, familiarity, expectations_json, boundaries_json, recent_json, updated_at)
      VALUES (?, ?, ?, 0.5, 0.5, 0, '[]', '[]', '[]', ?)
    `).run(id, scopeId, target, now);
    return get(scopeId, target);
  }

  function update(scopeId, target, patch = {}) {
    const current = ensure(scopeId, target);
    const next = normalizeRelationship({ ...current, ...patch, target });
    db.prepare(`
      UPDATE relationships SET trust = ?, care = ?, familiarity = ?, expectations_json = ?, boundaries_json = ?, recent_json = ?, updated_at = ?
      WHERE scope_id = ? AND target = ?
    `).run(
      next.trust, next.care, next.familiarity,
      JSON.stringify(next.expectations), JSON.stringify(next.boundaries), JSON.stringify(next.recent),
      nowIso(), scopeId, target,
    );
    return get(scopeId, target);
  }

  function applyDelta(scopeId, target, delta = {}, { event = null, at = nowIso() } = {}) {
    const current = ensure(scopeId, target);
    const recent = [...(current.recent ?? []), ...(event ? [{ at, event: String(event).slice(0, 300) }] : [])].slice(-30);
    return update(scopeId, target, {
      trust: current.trust + Number(delta.trustDelta || 0),
      care: current.care + Number(delta.careDelta || 0),
      familiarity: current.familiarity + Number(delta.familiarityDelta || 0.01),
      recent,
    });
  }

  function list(scopeId = 'global') {
    return db.prepare('SELECT * FROM relationships WHERE scope_id = ? ORDER BY updated_at DESC').all(scopeId).map(rowToRelationship);
  }

  function render(scopeId = 'global', target = '用户') {
    const value = get(scopeId, target);
    if (!value) return '';
    return `${value.target}：信任 ${Math.round(value.trust * 100)}% / 在乎 ${Math.round(value.care * 100)}% / 熟悉 ${Math.round(value.familiarity * 100)}%`;
  }

  return { get, ensure, update, applyDelta, list, render };
}
