/**
 * Optional remote model providers. Nothing here is enabled by default, and no
 * model or package is downloaded during plugin installation. The caller must
 * opt in with a base URL + model and accept the network/secret tradeoff.
 */

function joinUrl(baseUrl, suffix) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('baseUrl is required');
  return `${base}${suffix}`;
}

async function postJson(url, { apiKey, body, timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 15000));
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`model endpoint HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function createOpenAIEmbedder({
  baseUrl,
  apiKey = '',
  model = 'text-embedding-3-small',
  dim = 1536,
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!baseUrl) throw new Error('remote embedder needs baseUrl');
  async function embedMany(texts = []) {
    const input = (Array.isArray(texts) ? texts : [texts]).map((text) => String(text ?? ''));
    if (!input.length) return [];
    const data = await postJson(joinUrl(baseUrl, '/embeddings'), {
      apiKey, fetchImpl, timeoutMs, body: { model, input },
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows.map((row) => Float32Array.from(row.embedding ?? []));
  }
  async function embed(text) {
    const [vector] = await embedMany([text]);
    return vector ?? null;
  }
  return { kind: 'openai-embedding', model, dim: Number(dim) || null, embed, embedMany };
}

export function createHttpReranker({
  baseUrl,
  apiKey = '',
  model = 'bge-reranker-base',
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!baseUrl) throw new Error('reranker needs baseUrl');
  async function rerank(query, documents = [], { topN = null } = {}) {
    const docs = (Array.isArray(documents) ? documents : []).map((doc) => String(doc ?? ''));
    if (!docs.length) return [];
    const data = await postJson(joinUrl(baseUrl, '/rerank'), {
      apiKey, fetchImpl, timeoutMs, body: { model, query: String(query ?? ''), documents: docs, top_n: topN ?? docs.length },
    });
    const rows = Array.isArray(data?.results) ? data.results : [];
    return rows.map((row) => ({
      index: Number(row.index),
      score: Number(row.relevance_score ?? row.score ?? 0),
      document: docs[Number(row.index)] ?? null,
    })).filter((row) => Number.isInteger(row.index) && row.index >= 0 && row.index < docs.length);
  }
  return { kind: 'http-reranker', model, rerank };
}
