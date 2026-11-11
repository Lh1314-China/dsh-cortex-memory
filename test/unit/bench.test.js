import test from 'node:test';
import assert from 'node:assert/strict';
import { recallAtK, precisionAtK, reciprocalRank, ndcgAtK, percentile, evaluateQueries } from '../../bench/metrics.js';
import { generateSynthetic } from '../../bench/synthetic.js';
import { runBenchmark } from '../../bench/run.js';

test('ranking metrics are correct on a simple list', () => {
  const ranked = ['a', 'b', 'c', 'd'];
  const relevant = ['b', 'd'];
  assert.equal(recallAtK(ranked, relevant, 2), 0.5);
  assert.equal(precisionAtK(ranked, relevant, 2), 0.5);
  assert.equal(reciprocalRank(ranked, relevant, 4), 0.5);
  assert.ok(ndcgAtK(ranked, relevant, 4) > 0 && ndcgAtK(ranked, relevant, 4) <= 1);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
});

test('synthetic workload is deterministic and has relevant ids', () => {
  const a = generateSynthetic({ count: 50, queries: 10, seed: 7 });
  const b = generateSynthetic({ count: 50, queries: 10, seed: 7 });
  assert.deepEqual(a.traces.map((trace) => trace.id), b.traces.map((trace) => trace.id));
  assert.ok(a.queries.every((query) => query.relevant.length >= 1));
});

test('evaluateQueries aggregates metrics', () => {
  const result = evaluateQueries([
    { items: [{ id: 'a' }, { id: 'b' }], relevant: ['b'] },
    { items: [{ id: 'c' }], relevant: ['c'] },
  ], { k: 2 });
  assert.equal(result.n, 2);
  assert.equal(result.recallAtK, 1);
  assert.equal(result.mrrAtK, (0.5 + 1) / 2);
});

test('small end-to-end benchmark returns throughput and recall', () => {
  const result = runBenchmark({ count: 80, queries: 10, seed: 3, limit: 5 });
  assert.equal(result.count, 80);
  assert.ok(result.writeMs >= 0);
  assert.ok(result.search.p50Ms >= 0);
  assert.ok(result.search.recallAtK > 0);
});
