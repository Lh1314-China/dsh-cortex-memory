import { hashText } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { cosine } from './embedder.js';
import { createAnnIndex } from './ann.js';
import { createHnswIndex } from './hnsw.js';
import { createExternalAnnClient } from './external-ann.js';
import { CortexError, ERROR_CODES } from '../core/errors.js';

function toBlob(vector) {
  const copy = new Float32Array(vector);
  return Buffer.from(copy.buffer);
}

function fromBlob(blob) {
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/**
 * Brute-force vector index. It is intentionally simple and local: the number of
 * personal memories is small (thousands, not billions), and a full scan keeps
 * the code auditable. A real ANN backend can replace it behind this interface.
 */
export function createVectorIndex({
  db,
  embedder,
  model = null,
  dim = null,
  annEnabled = false,
  annMin = 500,
  annEngine = 'hnsw',
  annOptions = {},
  externalAnnEnabled = false,
  externalAnnOptions = {},
} = {}) {
  if (!db || !embedder) throw new Error('vector index needs db and embedder');
  const effectiveModel = model ?? embedder.model ?? 'unknown';
  const effectiveDim = Number(dim ?? embedder.dim ?? 0);
  if (!effectiveDim) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'embedder dim is required');
  const annMinCount = Math.max(1, Math.min(100000, Number(annMin) || 500));
  const ann = annEnabled
    ? (annEngine === 'nsw' ? createAnnIndex(annOptions) : createHnswIndex(annOptions))
    : null;
  const externalAnn = externalAnnEnabled && externalAnnOptions?.endpoint
    ? createExternalAnnClient(externalAnnOptions)
    : null;
  let annBuilt = false;

  function ensureAnn() {
    if (!ann || annBuilt) return;
    const rows = db.prepare('SELECT trace_id, vector FROM embeddings WHERE model = ? AND dim = ?').all(effectiveModel, effectiveDim);
    ann.rebuild(rows.map((row) => ({ id: row.trace_id, vector: Array.from(fromBlob(row.vector)) })));
    annBuilt = true;
  }

  function upsert(traceId, text) {
    if (!traceId) return null;
    // Remote providers are async. A write must not block on the network: kick
    // off the embedding and let it land later. Callers that need completion
    // use upsertAsync().
    if (embedder.kind === 'openai-embedding' || embedder.async === true) {
      upsertAsync(traceId, text).catch(() => null);
      return { traceId, pending: true };
    }
    const vector = embedder.embed(String(text ?? ''));
    return store(traceId, text, vector);
  }

  function store(traceId, text, vector) {
    const hash = hashText(String(text ?? ''));
    db.prepare(`
      INSERT INTO embeddings(trace_id, model, dim, vector, hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(trace_id) DO UPDATE SET
        model = excluded.model, dim = excluded.dim, vector = excluded.vector,
        hash = excluded.hash, updated_at = excluded.updated_at
    `).run(traceId, effectiveModel, effectiveDim, toBlob(vector), hash, nowIso());
    if (ann) {
      ann.upsert(traceId, Array.from(vector));
      annBuilt = true;
    }
    return { traceId, model: effectiveModel, dim: effectiveDim, hash };
  }

  async function upsertAsync(traceId, text) {
    if (!traceId) return null;
    const vector = await embedder.embed(String(text ?? ''));
    if (!vector) return null;
    return store(traceId, text, vector);
  }

  function remove(traceId) {
    if (ann) ann.remove(traceId);
    return db.prepare('DELETE FROM embeddings WHERE trace_id = ?').run(traceId).changes > 0;
  }

  function status() {
    const row = db.prepare('SELECT COUNT(*) AS c FROM embeddings').get();
    return {
      model: effectiveModel,
      dim: effectiveDim,
      count: Number(row?.c ?? 0),
      async: embedder.kind === 'openai-embedding' || embedder.async === true,
      ann: ann ? { enabled: true, engine: annEngine === 'nsw' ? 'nsw' : 'hnsw', size: ann.size(), min: annMinCount, built: annBuilt } : { enabled: false },
      externalAnn: externalAnn ? { enabled: true, endpoint: externalAnn.endpoint } : { enabled: false },
    };
  }

  function searchWithVector(queryVector, { scopeId = 'global', limit = 20, minScore = 0.05, includeArchived = false } = {}) {
    const stateClause = includeArchived ? "t.state IN ('active','archived')" : "t.state = 'active'";
    if (ann) {
      ensureAnn();
      if (ann.size() >= annMinCount) {
        const approx = ann.search(Array.from(queryVector), Math.max(limit * 3, 20));
        const one = db.prepare(`
          SELECT e.vector FROM embeddings e JOIN traces t ON t.id = e.trace_id
          WHERE e.trace_id = ? AND t.scope_id = ? AND ${stateClause} AND e.model = ? AND e.dim = ?
        `);
        const hits = [];
        for (const candidate of approx) {
          const row = one.get(candidate.id, scopeId, effectiveModel, effectiveDim);
          if (!row) continue;
          const score = cosine(queryVector, fromBlob(row.vector));
          if (score < minScore) continue;
          hits.push({ traceId: candidate.id, score: Math.round(score * 10000) / 10000 });
        }
        if (hits.length >= Math.min(limit, 5)) {
          return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(200, limit)));
        }
      }
    }
    const rows = db.prepare(`
      SELECT e.trace_id, e.vector, e.model, e.dim, t.importance, t.confidence
      FROM embeddings e JOIN traces t ON t.id = e.trace_id
      WHERE t.scope_id = ? AND ${stateClause} AND e.model = ? AND e.dim = ?
    `).all(scopeId, effectiveModel, effectiveDim);
    const hits = [];
    for (const row of rows) {
      const score = cosine(queryVector, fromBlob(row.vector));
      if (score < minScore) continue;
      hits.push({ traceId: row.trace_id, score: Math.round(score * 10000) / 10000 });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(200, limit)));
  }

  function search(query, options = {}) {
    if (embedder.kind === 'openai-embedding' || embedder.async === true) return [];
    const text = String(query ?? '').trim();
    if (!text) return [];
    return searchWithVector(embedder.embed(text), options);
  }

  async function searchAsync(query, options = {}) {
    const text = String(query ?? '').trim();
    if (!text) return [];
    const queryVector = await embedder.embed(text);
    if (!queryVector) return [];
    if (externalAnn) {
      try {
        const approximate = await externalAnn.search(Array.from(queryVector), Math.max(20, (Number(options.limit) || 20) * 3));
        const stateClause = options.includeArchived ? "t.state IN ('active','archived')" : "t.state = 'active'";
        const one = db.prepare(`
          SELECT e.trace_id, e.vector FROM embeddings e JOIN traces t ON t.id = e.trace_id
          WHERE e.trace_id = ? AND t.scope_id = ? AND ${stateClause} AND e.model = ? AND e.dim = ?
        `);
        const hits = [];
        for (const candidate of approximate) {
          const row = one.get(candidate.id, options.scopeId ?? 'global', effectiveModel, effectiveDim);
          if (!row) continue;
          hits.push({ traceId: candidate.id, score: Math.round(Number(candidate.score) * 10000) / 10000 });
        }
        if (hits.length >= Math.min(Number(options.limit) || 20, 5)) return hits;
      } catch {
        /* fall through to exact scan */
      }
    }
    return searchWithVector(queryVector, options);
  }

  function rebuild({ scopeId = 'global', limit = 5000 } = {}) {
    if (ann) { ann.rebuild([]); annBuilt = true; }
    const traces = db.prepare(`
      SELECT id, title, content, summary FROM traces
      WHERE scope_id = ? AND state = 'active' ORDER BY recorded_at DESC LIMIT ?
    `).all(scopeId, Math.max(1, Math.min(50000, limit)));
    for (const trace of traces) upsert(trace.id, `${trace.title ?? ''} ${trace.content ?? ''} ${trace.summary ?? ''}`);
    return { rebuilt: traces.length, ...status() };
  }

  async function rebuildAsync({ scopeId = 'global', limit = 5000 } = {}) {
    if (ann) { ann.rebuild([]); annBuilt = true; }
    const traces = db.prepare(`
      SELECT id, title, content, summary FROM traces
      WHERE scope_id = ? AND state = 'active' ORDER BY recorded_at DESC LIMIT ?
    `).all(scopeId, Math.max(1, Math.min(50000, limit)));
    let rebuilt = 0;
    for (const trace of traces) {
      try {
        await upsertAsync(trace.id, `${trace.title ?? ''} ${trace.content ?? ''} ${trace.summary ?? ''}`);
        rebuilt += 1;
      } catch {
        /* keep going; fail-open per row */
      }
    }
    return { rebuilt, ...status() };
  }

  return { upsert, upsertAsync, remove, search, searchAsync, status, rebuild, rebuildAsync, model: effectiveModel, dim: effectiveDim };
}
