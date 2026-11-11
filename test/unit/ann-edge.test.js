import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnIndex } from '../../src/vector/ann.js';

function seeded(seedValue) {
  let state = seedValue >>> 0;
  return () => {
    state = (state * 22695477 + 1) >>> 0;
    return state / 4294967296;
  };
}

function unit(random, dim = 12) {
  const values = Array.from({ length: dim }, () => random() * 2 - 1);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

test('ann search scores are sorted and bounded', () => {
  const random = seeded(3);
  const index = createAnnIndex({ M: 8, efConstruction: 40, efSearch: 40, seed: 3 });
  const items = Array.from({ length: 80 }, (_, i) => ({ id: `v${i}`, vector: unit(random) }));
  index.rebuild(items);
  const results = index.search(unit(random), 10);
  assert.equal(results.length, 10);
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i - 1].score >= results[i].score, 'scores should descend');
  }
  for (const result of results) {
    assert.ok(result.score >= -1.0000001 && result.score <= 1.0000001);
  }
});

test('ann is deterministic for the same seed and data', () => {
  const random = seeded(99);
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, vector: unit(random) }));
  const query = unit(random);
  const a = createAnnIndex({ M: 8, efConstruction: 30, efSearch: 30, seed: 99 });
  const b = createAnnIndex({ M: 8, efConstruction: 30, efSearch: 30, seed: 99 });
  a.rebuild(items);
  b.rebuild(items);
  assert.deepEqual(a.search(query, 8), b.search(query, 8));
});

test('ann update replaces the vector but keeps the id', () => {
  const index = createAnnIndex({ M: 6, efConstruction: 20, efSearch: 20, seed: 5 });
  index.upsert('a', [1, 0, 0]);
  index.upsert('b', [0, 1, 0]);
  index.upsert('c', [0, 0, 1]);
  assert.equal(index.search([1, 0, 0], 1)[0].id, 'a');
  index.upsert('a', [0, 1, 0]);
  assert.equal(index.size(), 3);
  const hit = index.search([0, 1, 0], 3)[0];
  assert.ok(['a', 'b'].includes(hit.id));
});

test('ann remove entry promotes another node and keeps search alive', () => {
  const index = createAnnIndex({ M: 6, efConstruction: 20, efSearch: 20, seed: 7 });
  index.upsert('one', [1, 0, 0]);
  index.upsert('two', [0, 1, 0]);
  index.upsert('three', [0, 0, 1]);
  const firstEntry = index.entry();
  assert.equal(index.remove(firstEntry), true);
  assert.notEqual(index.entry(), firstEntry);
  assert.equal(index.size(), 2);
  assert.equal(index.search([1, 0, 0], 2).length, 2);
  assert.equal(index.remove('missing'), false);
});

test('ann handles duplicate upserts and empty rebuild', () => {
  const index = createAnnIndex({ M: 4, efConstruction: 10, efSearch: 10, seed: 1 });
  index.rebuild([]);
  assert.equal(index.size(), 0);
  assert.deepEqual(index.search([1, 0], 3), []);
  index.upsert('same', [1, 0]);
  index.upsert('same', [1, 0]);
  index.upsert('same', [1, 0]);
  assert.equal(index.size(), 1);
  assert.deepEqual(index.neighbors('same'), []);
  assert.equal(index.rebuild([]), 0);
  assert.equal(index.entry(), null);
});

test('ann config is clamped to safe bounds', () => {
  const index = createAnnIndex({ M: 1, efConstruction: 1, efSearch: 1, seed: 2 });
  const config = index.config();
  assert.ok(config.M >= 2);
  assert.ok(config.efConstruction >= config.M);
  assert.ok(config.efSearch >= 10);
  assert.equal(config.seed, 2);
});

test('ann separate indexes do not share graph state', () => {
  const a = createAnnIndex({ seed: 1 });
  const b = createAnnIndex({ seed: 1 });
  a.upsert('a', [1, 0, 0]);
  b.upsert('b', [0, 1, 0]);
  assert.equal(a.size(), 1);
  assert.equal(b.size(), 1);
  assert.equal(a.search([1, 0, 0], 1)[0].id, 'a');
  assert.equal(b.search([0, 1, 0], 1)[0].id, 'b');
});
