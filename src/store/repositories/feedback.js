import { feedbackId } from '../../core/ids.js';
import { nowIso } from '../../core/time.js';

export const POSITIVE_SIGNALS = Object.freeze(new Set(['used', 'helpful', 'good', 'easy']));
export const NEGATIVE_SIGNALS = Object.freeze(new Set(['incorrect', 'corrected', 'bad', 'again']));

function rowToFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    traceId: row.trace_id,
    signal: row.signal,
    value: row.value == null ? null : Number(row.value),
    source: row.source,
    eventId: row.event_id,
    at: row.at,
  };
}

export function createFeedbackRepository(db) {
  function add({ scopeId = 'global', traceId = null, signal, value = null, source = 'user', eventId = null, at = nowIso() } = {}) {
    if (!signal) throw new Error('feedback signal is required');
    const id = feedbackId();
    db.prepare(`
      INSERT INTO feedback(id, scope_id, trace_id, signal, value, source, event_id, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, traceId, signal, value == null ? null : Number(value), source, eventId, at);
    return get(id);
  }

  function get(id) {
    return rowToFeedback(db.prepare('SELECT * FROM feedback WHERE id = ?').get(id));
  }

  function list({ scopeId = 'global', traceId = null, limit = 100 } = {}) {
    const count = Math.max(1, Math.min(1000, Number(limit) || 100));
    const rows = traceId
      ? db.prepare('SELECT * FROM feedback WHERE scope_id = ? AND trace_id = ? ORDER BY at DESC LIMIT ?').all(scopeId, traceId, count)
      : db.prepare('SELECT * FROM feedback WHERE scope_id = ? ORDER BY at DESC LIMIT ?').all(scopeId, count);
    return rows.map(rowToFeedback);
  }

  function aggregate(traceId) {
    const rows = db.prepare('SELECT signal, COUNT(*) AS c FROM feedback WHERE trace_id = ? GROUP BY signal').all(traceId);
    const counts = Object.fromEntries(rows.map((row) => [row.signal, Number(row.c)]));
    const positive = [...POSITIVE_SIGNALS].reduce((sum, signal) => sum + (counts[signal] ?? 0), 0);
    const negative = [...NEGATIVE_SIGNALS].reduce((sum, signal) => sum + (counts[signal] ?? 0), 0);
    return { counts, positive, negative, total: positive + negative };
  }

  return { add, get, list, aggregate };
}
