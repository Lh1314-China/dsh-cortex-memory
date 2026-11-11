import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnIndex } from '../../src/vector/ann.js';

function randomFactory(seedValue) {
  let state = seedValue >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeVector(random, dim = 48) {
  const value = Array.from({ length: dim }, () => random() * 2 - 1);
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0)) || 1;
  return value.map((item) => item / norm);
}

function cosine(a, b) {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return dot;
}

test('ann handles a 1000-vector corpus with useful recall and bounded latency', () => {
  const random = randomFactory(20261111);
  const items = Array.from({ length: 1000 }, (_, index) => ({ id: `t${index}`, vector: makeVector(random) }));
  const index = createAnnIndex({ M: 24, efConstruction: 200, efSearch: 160, seed: 20261111 });
  const started = Date.now();
  const inserted = index.rebuild(items);
  const buildMs = Date.now() - started;
  assert.equal(inserted, 1000);
  assert.ok(buildMs < 30_000, `build took ${buildMs}ms`);

  let hits = 0;
  let expectedTotal = 0;
  const searchStarted = Date.now();
  for (let queryIndex = 0; queryIndex < 20; queryIndex += 1) {
    const query = makeVector(random);
    const expected = new Set(
      items
        .map((item) => ({ id: item.id, score: cosine(item.vector, query) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((item) => item.id),
    );
    const actual = index.search(query, 10, { ef: 240 });
    assert.equal(actual.length, 10);
    for (const item of actual) if (expected.has(item.id)) hits += 1;
    expectedTotal += expected.size;
  }
  const searchMs = Date.now() - searchStarted;
  assert.ok(hits / expectedTotal >= 0.8, `recall ${hits}/${expectedTotal}`);
  assert.ok(searchMs < 30_000, `20 queries took ${searchMs}ms`);

  for (let indexToRemove = 0; indexToRemove < 100; indexToRemove += 1) {
    assert.equal(index.remove(`t${indexToRemove}`), true);
  }
  assert.equal(index.size(), 900);
  assert.equal(index.search(items[500].vector, 5).length, 5);
});
