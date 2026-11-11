import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalAnnClient } from '../../src/vector/external-ann.js';

test('external ANN client sends a bounded query and filters bad items', async () => {
  let request;
  const client = createExternalAnnClient({
    endpoint: 'http://127.0.0.1:9999/search',
    timeoutMs: 500,
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body), signal: Boolean(options.signal) };
      return { ok: true, json: async () => ({ items: [{ id: 'a', score: 0.9 }, { id: 2, score: 0.8 }, { id: 'b' }] }) };
    },
  });
  const items = await client.search(new Array(16).fill(0.1), 5);
  assert.equal(request.url, 'http://127.0.0.1:9999/search');
  assert.equal(request.body.k, 5);
  assert.equal(request.signal, true);
  assert.deepEqual(items, [{ id: 'a', score: 0.9 }]);
});

test('external ANN client rejects a missing endpoint and bad responses', async () => {
  assert.throws(() => createExternalAnnClient({ endpoint: 'file:///tmp/index' }), /http/);
  const client = createExternalAnnClient({
    endpoint: 'http://127.0.0.1:9999/search',
    fetchImpl: async () => ({ ok: true, json: async () => ({ nope: true }) }),
  });
  await assert.rejects(() => client.search([0.1], 3), /items/);
});
