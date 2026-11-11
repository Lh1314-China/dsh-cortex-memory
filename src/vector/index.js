import { hashText } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { cosine } from './embedder.js';
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
export function createVectorIndex({ db, embedder, model = null, dim = null } = {}) {
  if (!db || !embedder) throw new Error('vector index needs db and embedder');
  const effectiveModel = model ?? embedder.model ?? 'unknown';
  const effectiveDim = Number(dim ?? embedder.dim ?? 0);
  if (!effectiveDim) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'embedder dim is required');

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
    return { traceId, model: effectiveModel, dim: effectiveDim, hash };
  }

  async function upsertAsync(traceId, text) {
    if (!traceId) return null;
    const vector = await embedder.embed(String(text ?? ''));
    if (!vector) return null;
    return store(traceId, text, vector);
  }

  function remove(traceId) {
    return db.prepare('DELETE FROM embeddings WHERE trace_id = ?').run(traceId).changes > 0;
  }

  function status() {
    const row = db.prepare('SELECT COUNT(*) AS c FROM embeddings').get();
    return { model: effectiveModel, dim: effectiveDim, count: Number(row?.c ?? 0), async: embedder.kind === 'openai-embedding' || embedder.async === true };
  }

  function searchWithVector(queryVector, { scopeId = 'global', limit = 20, minScore = 0.05, includeArchived = false } = {}) {
    const stateClause = includeArchived ? "t.state IN ('active','archived')" : "t.state = 'active'";
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
    return searchWithVector(queryVector, options);
  }

  function rebuild({ scopeId = 'global', limit = 5000 } = {}) {
    const traces = db.prepare(`
      SELECT id, title, content, summary FROM traces
      WHERE scope_id = ? AND state = 'active' ORDER BY recorded_at DESC LIMIT ?
    `).all(scopeId, Math.max(1, Math.min(50000, limit)));
    for (const trace of traces) upsert(trace.id, `${trace.title ?? ''} ${trace.content ?? ''} ${trace.summary ?? ''}`);
    return { rebuilt: traces.length, ...status() };
  }

  async function rebuildAsync({ scopeId = 'global', limit = 5000 } = {}) {
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
