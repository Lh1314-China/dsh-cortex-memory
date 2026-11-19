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

// Trust and care move asymmetrically: a good interaction adds a fraction of the
// remaining room (so the hundredth kindness matters less than the first), while a
// disappointment takes a bigger bite (losses weigh more than gains). Both stay
// inside 0..1.
const LOSS_WEIGHT = 1.6;

export function nextBonded(value, delta) {
  const current = clamp(value, 0, 1);
  const amount = Number(delta) || 0;
  if (!amount) return current;
  if (amount > 0) {
    const k = Math.min(1, amount);
    return clamp(current + (1 - current) * k, 0, 1);
  }
  const k = Math.min(1, Math.abs(amount) * LOSS_WEIGHT);
  return clamp(current - current * k, 0, 1);
}

export function nextGrow(value, delta) {
  const current = clamp(value, 0, 1);
  const k = Math.min(1, Math.abs(Number(delta) || 0));
  return clamp(current + (1 - current) * k, 0, 1);
}

export function createRelationshipStore(db, { resolveTarget = null } = {}) {
  const targetOf = typeof resolveTarget === 'function' ? resolveTarget : (value) => String(value ?? '').trim();

  function get(scopeId, target) {
    return rowToRelationship(db.prepare('SELECT * FROM relationships WHERE scope_id = ? AND target = ?').get(scopeId, targetOf(target)));
  }

  function ensure(scopeId = 'global', target = '用户') {
    const name = targetOf(target);
    const current = get(scopeId, name);
    if (current) return current;
    const id = makeId('rel');
    const now = nowIso();
    db.prepare(`
      INSERT INTO relationships(id, scope_id, target, trust, care, familiarity, expectations_json, boundaries_json, recent_json, updated_at)
      VALUES (?, ?, ?, 0.5, 0.5, 0, '[]', '[]', '[]', ?)
    `).run(id, scopeId, name, now);
    return get(scopeId, name);
  }

  function update(scopeId, target, patch = {}) {
    const name = targetOf(target);
    const current = ensure(scopeId, name);
    const next = normalizeRelationship({ ...current, ...patch, target: name });
    db.prepare(`
      UPDATE relationships SET trust = ?, care = ?, familiarity = ?, expectations_json = ?, boundaries_json = ?, recent_json = ?, updated_at = ?
      WHERE scope_id = ? AND target = ?
    `).run(
      next.trust, next.care, next.familiarity,
      JSON.stringify(next.expectations), JSON.stringify(next.boundaries), JSON.stringify(next.recent),
      nowIso(), scopeId, name,
    );
    return get(scopeId, name);
  }

  function applyDelta(scopeId, target, delta = {}, { event = null, at = nowIso() } = {}) {
    const name = targetOf(target);
    const current = ensure(scopeId, name);
    const recent = [...(current.recent ?? []), ...(event ? [{ at, event: String(event).slice(0, 300) }] : [])].slice(-30);
    return update(scopeId, target, {
      trust: nextBonded(current.trust, Number(delta.trustDelta || 0)),
      care: nextBonded(current.care, Number(delta.careDelta || 0)),
      // Familiarity only grows, and saturates: it is the count of shared time,
      // not a score you can lose.
      familiarity: nextGrow(current.familiarity, Math.abs(Number(delta.familiarityDelta || 0.01))),
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
