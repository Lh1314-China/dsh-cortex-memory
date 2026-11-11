import test from 'node:test';
import assert from 'node:assert/strict';
import { createHnswIndex } from '../../src/vector/hnsw.js';

function vector(seed, dim = 16) {
  let state = seed >>> 0;
  return Array.from({ length: dim }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  });
}

test('HNSW candidate returns the exact top result on a small corpus', () => {
  const index = createHnswIndex({ M: 12, efConstruction: 64, efSearch: 100, seed: 7 });
  const items = Array.from({ length: 300 }, (_, i) => ({ id: `v${i}`, vector: vector(i + 1) }));
  index.rebuild(items);
  const query = vector(42);
  const exact = items
    .map((item) => ({ id: item.id, score: item.vector.reduce((sum, value, i) => sum + value * query[i], 0) }))
    .sort((a, b) => b.score - a.score)[0];
  const result = index.search(query, 1, { ef: 100 })[0];
  assert.equal(result.id, exact.id);
});

test('HNSW supports upsert, remove and empty search', () => {
  const index = createHnswIndex({ seed: 3 });
  assert.deepEqual(index.search(vector(1), 3), []);
  index.upsert('a', vector(1));
  index.upsert('b', vector(2));
  index.upsert('a', vector(3));
  assert.equal(index.size(), 2);
  assert.equal(index.remove('b'), true);
  assert.equal(index.size(), 1);
  assert.equal(index.remove('missing'), false);
});
