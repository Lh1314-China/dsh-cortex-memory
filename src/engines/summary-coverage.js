import { createHash } from 'node:crypto';

/**
 * Recompute `coverage` for episode summaries that were written before the
 * importance-weighted definition existed (v1 stored "share of traces sampled").
 *
 * This is a *report-first* helper: it never writes. `bin/repair.mjs --rewrite-
 * coverage` decides whether to apply, and only behind the normal backup gate.
 *
 * For each v1 episode summary:
 *   total   = importance sum of traces recorded inside [period_start, period_end]
 *   covered = importance sum of the summary's own source traces (still existing)
 *   coverage = covered / total  (importance-weighted, same meaning as v2)
 */

function weightOf(row) {
  return Math.max(0.05, Number(row?.importance) || 0.5);
}

export function recomputeEpisodeCoverage({ db, scopeId = 'global', limit = 200 } = {}) {
  if (!db) throw new Error('recomputeEpisodeCoverage needs a db');
  const rows = db.prepare(`
    SELECT id, source_ids_json, coverage, period_start, period_end, model, content
    FROM summaries
    WHERE scope_id = ? AND level = 'episode'
      AND (model IS NULL OR model NOT LIKE '%-v2%')
    ORDER BY created_at DESC LIMIT ?
  `).all(scopeId, Math.max(1, Number(limit) || 200));

  const updates = [];
  for (const row of rows) {
    let sourceIds = [];
    try { sourceIds = JSON.parse(row.source_ids_json ?? '[]'); } catch { sourceIds = []; }
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) continue;
    const window = db.prepare(`
      SELECT importance FROM traces
      WHERE scope_id = ? AND recorded_at >= ? AND recorded_at <= ?
    `).all(scopeId, row.period_start, row.period_end);
    const total = window.reduce((sum, item) => sum + weightOf(item), 0);
    if (total <= 0) continue;
    const placeholders = sourceIds.map(() => '?').join(',');
    const sources = db.prepare(`
      SELECT id, importance FROM traces
      WHERE scope_id = ? AND id IN (${placeholders})
    `).all(scopeId, ...sourceIds);
    const covered = sources.reduce((sum, item) => sum + weightOf(item), 0);
    if (covered <= 0) continue;
    const next = Math.min(1, Math.round((covered / total) * 1000) / 1000);
    if (Math.abs(next - Number(row.coverage ?? 0)) < 0.001) continue;
    const digest = createHash('sha256').update(`${row.id}:${next}`).digest('hex').slice(0, 12);
    updates.push({
      id: row.id,
      from: Number(row.coverage ?? 0),
      to: next,
      sources: sources.length,
      window: window.length,
      digest,
      title: String(row.content ?? '').slice(0, 40),
    });
  }
  return { candidates: rows.length, updates };
}
