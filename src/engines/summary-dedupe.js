import { jaccard } from '../memory/tokenizer.js';

/**
 * Find duplicated episode summaries.
 *
 * The v1 reflect logic wrote one episode every time it ran, and the candidate
 * window was always "the last 24 hours", so several rows can describe almost the
 * same day. Recomputing coverage fixed the numbers but not the duplication; this
 * helper reports the clusters so `repair --dedupe-episodes` can merge them behind
 * its backup gate. It never writes.
 */

function span(summary) {
  const start = Date.parse(summary.periodStart ?? '');
  const end = Date.parse(summary.periodEnd ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

function overlapRatio(a, b) {
  const left = span(a);
  const right = span(b);
  if (!left || !right) return 0;
  const overlap = Math.min(left.end, right.end) - Math.max(left.start, right.start);
  if (overlap <= 0) return 0;
  const smaller = Math.min(left.end - left.start, right.end - right.start);
  return smaller > 0 ? overlap / smaller : 0;
}

export function findDuplicateEpisodes({
  db,
  scopeId = 'global',
  overlapThreshold = 0.9,
  similarityThreshold = 0.8,
  limit = 200,
} = {}) {
  if (!db) throw new Error('findDuplicateEpisodes needs a db');
  const rows = db.prepare(`
    SELECT id, content, source_ids_json, coverage, period_start, period_end, created_at, model
    FROM summaries
    WHERE scope_id = ? AND level = 'episode'
    ORDER BY created_at DESC LIMIT ?
  `).all(scopeId, Math.max(1, Number(limit) || 200));

  const summaries = rows.map((row) => ({
    id: row.id,
    content: String(row.content ?? ''),
    sourceIds: (() => { try { return JSON.parse(row.source_ids_json ?? '[]'); } catch { return []; } })(),
    coverage: Number(row.coverage ?? 0),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    model: row.model,
  }));

  // Greedy clustering: newest row wins, older near-duplicates join its cluster.
  const used = new Set();
  const clusters = [];
  for (const summary of summaries) {
    if (used.has(summary.id)) continue;
    used.add(summary.id);
    const cluster = { keep: summary, remove: [], unionSources: [...summary.sourceIds], contentSim: 1 };
    for (const other of summaries) {
      if (used.has(other.id)) continue;
      const ratio = overlapRatio(summary, other);
      if (ratio < overlapThreshold) continue;
      const sim = jaccard(summary.content, other.content);
      if (sim < similarityThreshold) continue;
      used.add(other.id);
      cluster.remove.push(other);
      cluster.contentSim = Math.min(cluster.contentSim, Math.round(sim * 1000) / 1000);
      for (const id of other.sourceIds) if (!cluster.unionSources.includes(id)) cluster.unionSources.push(id);
    }
    if (cluster.remove.length) clusters.push(cluster);
  }
  return { candidates: summaries.length, clusters };
}
