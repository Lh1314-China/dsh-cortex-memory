import { createHash } from 'node:crypto';

/**
 * A deterministic local embedder used for tests and as a zero-dependency
 * fallback. It is lexical (hashed token buckets), not semantic: enable it only
 * when no real embedding model is available, and prefer a real model later.
 */
export function createHashEmbedder({ dim = 256 } = {}) {
  if (!Number.isInteger(dim) || dim < 16 || dim > 4096) throw new Error('embedder dim must be 16..4096');
  const model = `hash-${dim}`;

  function embed(text) {
    const vector = new Float32Array(dim);
    const value = String(text ?? '').toLowerCase();
    const tokens = value.match(/[\u3400-\u4dbf\u4e00-\u9fff]+|[a-z0-9_]+/g) ?? [];
    for (const token of tokens) {
      if (token.length === 1 && /[a-z0-9]/.test(token)) continue;
      const parts = /[\u3400-\u4dbf\u4e00-\u9fff]/.test(token)
        ? Array.from({ length: Math.max(1, token.length - 1) }, (_, i) => token.slice(i, i + 2))
        : [token];
      for (const part of parts) {
        const digest = createHash('sha256').update(part).digest();
        const index = digest.readUInt32LE(0) % dim;
        const sign = (digest[4] & 1) === 0 ? 1 : -1;
        vector[index] += sign;
      }
    }
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dim; i += 1) vector[i] /= norm;
    return vector;
  }

  return { model, dim, embed };
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
