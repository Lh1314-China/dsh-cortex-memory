import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIEmbedder, createHttpReranker } from '../../src/vector/providers.js';

function mockFetch(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

test('OpenAI-compatible embedder batches text and preserves dimensions', async () => {
  const { fetchImpl, calls } = mockFetch({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] });
  const embedder = createOpenAIEmbedder({ baseUrl: 'http://127.0.0.1:9000/v1', model: 'm', dim: 2, fetchImpl });
  const vectors = await embedder.embedMany(['甲', '乙']);
  assert.equal(vectors.length, 2);
  assert.ok(Math.abs(vectors[0][0] - 0.1) < 1e-6);
  assert.ok(Math.abs(vectors[0][1] - 0.2) < 1e-6);
  assert.equal(calls[0].url, 'http://127.0.0.1:9000/v1/embeddings');
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'm', input: ['甲', '乙'] });
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('HTTP reranker maps indices back to documents', async () => {
  const { fetchImpl, calls } = mockFetch({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }] });
  const reranker = createHttpReranker({ baseUrl: 'http://127.0.0.1:9000/v1', model: 'r', fetchImpl });
  const ranked = await reranker.rerank('米食', ['无关', '米食']);
  assert.equal(ranked[0].index, 1);
  assert.equal(ranked[0].document, '米食');
  assert.equal(ranked[0].score, 0.9);
  assert.equal(calls[0].url, 'http://127.0.0.1:9000/v1/rerank');
});

test('providers fail clearly on missing config/network errors', async () => {
  assert.throws(() => createOpenAIEmbedder({}), /baseUrl/);
  assert.throws(() => createHttpReranker({}), /baseUrl/);
  const { fetchImpl } = mockFetch({}, 500);
  const embedder = createOpenAIEmbedder({ baseUrl: 'http://x/v1', fetchImpl });
  await assert.rejects(() => embedder.embed('x'), /HTTP 500/);
});
