import { summaryId } from '../../core/ids.js';
import { nowIso } from '../../core/time.js';

function rowToSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    level: row.level,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    content: row.content,
    sourceIds: JSON.parse(row.source_ids_json),
    coverage: Number(row.coverage),
    createdAt: row.created_at,
    model: row.model,
  };
}

export function createSummaryRepository(db) {
  function insert({ scopeId = 'global', level = 'episode', periodStart = null, periodEnd = null, content, sourceIds = [], coverage = 0, model = null } = {}) {
    if (!content) throw new Error('summary content is required');
    const id = summaryId();
    db.prepare(`
      INSERT INTO summaries(id, scope_id, level, period_start, period_end, content, source_ids_json, coverage, created_at, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, level, periodStart, periodEnd, content, JSON.stringify(sourceIds), Number(coverage), nowIso(), model);
    return get(id);
  }

  function get(id) {
    return rowToSummary(db.prepare('SELECT * FROM summaries WHERE id = ?').get(id));
  }

  function findPeriod(scopeId, level, periodStart, periodEnd) {
    return rowToSummary(db.prepare(`
      SELECT * FROM summaries
      WHERE scope_id = ? AND level = ? AND period_start = ? AND period_end = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(scopeId, level, periodStart, periodEnd));
  }

  function list(scopeId = 'global', { level = null, limit = 20 } = {}) {
    const count = Math.max(1, Math.min(1000, Number(limit) || 20));
    const rows = level
      ? db.prepare('SELECT * FROM summaries WHERE scope_id = ? AND level = ? ORDER BY created_at DESC LIMIT ?').all(scopeId, level, count)
      : db.prepare('SELECT * FROM summaries WHERE scope_id = ? ORDER BY created_at DESC LIMIT ?').all(scopeId, count);
    return rows.map(rowToSummary);
  }

  return { insert, get, findPeriod, list };
}
