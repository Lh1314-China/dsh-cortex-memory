import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnIndex } from '../../src/vector/ann.js';

function seed(seedValue) {
  let state = seedValue >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function vector(random, dim = 32) {
  const value = Array.from({ length: dim }, () => random() * 2 - 1);
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0)) || 1;
  return value.map((item) => item / norm);
}

function cosine(a, b) {
  return a.reduce((sum, item, index) => sum + item * b[index], 0);
}

function brute(entries, query, k) {
  return entries
    .map((entry) => ({ id: entry.id, score: cosine(entry.vector, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

test('ann index finds high-recall neighbours on random vectors', () => {
  const random = seed(7);
  const items = Array.from({ length: 400 }, (_, index) => ({ id: `n${index}`, vector: vector(random) }));
  const index = createAnnIndex({ M: 16, efConstruction: 120, efSearch: 80, seed: 7 });
  index.rebuild(items);
  assert.equal(index.size(), 400);
  let hits = 0;
  let total = 0;
  for (let q = 0; q < 20; q += 1) {
    const query = vector(random);
    const expected = new Set(brute(items, query, 10).map((item) => item.id));
    const actual = index.search(query, 10, { ef: 120 });
    assert.equal(actual.length, 10);
    for (const item of actual) if (expected.has(item.id)) hits += 1;
    total += expected.size;
  }
  assert.ok(hits / total >= 0.9, `recall ${hits}/${total}`);
});

test('ann upsert/remove/rebuild are deterministic and idempotent', () => {
  const random = seed(11);
  const items = Array.from({ length: 120 }, (_, index) => ({ id: `x${index}`, vector: vector(random, 16) }));
  const index = createAnnIndex({ M: 8, efConstruction: 40, efSearch: 40, seed: 11 });
  for (const item of items) index.upsert(item.id, item.vector);
  assert.equal(index.size(), 120);
  const first = index.search(items[0].vector, 5).map((item) => item.id);
  index.upsert(items[0].id, items[0].vector);
  assert.equal(index.size(), 120);
  assert.deepEqual(index.search(items[0].vector, 5).map((item) => item.id), first);
  assert.equal(index.remove('x0'), true);
  assert.equal(index.remove('x0'), false);
  assert.equal(index.size(), 119);
  assert.equal(index.rebuild(items.slice(0, 40)), 40);
  assert.equal(index.size(), 40);
});

test('ann index rejects malformed vectors and handles empty index', () => {
  const index = createAnnIndex();
  assert.deepEqual(index.search([1, 0], 5), []);
  assert.throws(() => index.upsert('', [1]), /id and vector/);
  assert.throws(() => index.upsert('a', []), /id and vector/);
  index.upsert('a', [1, 0]);
  index.upsert('b', [0, 1]);
  assert.equal(index.size(), 2);
  const hits = index.search([1, 0], 2);
  assert.equal(hits[0].id, 'a');
  assert.ok(hits[0].score >= hits[1].score);
});
