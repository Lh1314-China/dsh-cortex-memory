import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSynthetic } from '../../bench/synthetic.js';
import { evaluateQueries, recallAtK, hitAtK, precisionAtK, reciprocalRank, ndcgAtK } from '../../bench/metrics.js';

test('synthetic benchmark queries name one unique needle', () => {
  const dataset = generateSynthetic({ count: 50, queries: 10, seed: 7 });
  assert.equal(dataset.traces.length, 50);
  assert.equal(dataset.queries.length, 10);
  for (const query of dataset.queries) {
    assert.equal(query.type, 'needle');
    assert.equal(query.relevant.length, 1);
    assert.match(query.targetId, /^trc_syn_\d+$/);
    const index = Number(query.targetId.slice('trc_syn_'.length));
    assert.ok(query.query.includes(`第 ${index} 条合成记忆`));
    assert.ok(dataset.traces[index].text.includes(`第 ${index} 条合成记忆`));
  }
});

test('synthetic benchmark is deterministic for a fixed seed', () => {
  const a = generateSynthetic({ count: 30, queries: 5, seed: 11 });
  const b = generateSynthetic({ count: 30, queries: 5, seed: 11 });
  assert.deepEqual(a.queries, b.queries);
  assert.deepEqual(a.traces, b.traces);
});

test('theme and paraphrase queries expose different retrieval tasks', () => {
  const theme = generateSynthetic({ count: 80, queries: 12, seed: 3, task: 'theme' });
  assert.equal(theme.task, 'theme');
  assert.ok(theme.queries.every((query) => query.type === 'theme'));
  assert.ok(theme.queries.every((query) => query.query === query.targetToken));
  assert.ok(theme.queries.every((query) => query.relevant.length >= 2));

  const paraphrase = generateSynthetic({ count: 80, queries: 12, seed: 3, task: 'paraphrase' });
  assert.equal(paraphrase.task, 'paraphrase');
  assert.ok(paraphrase.queries.every((query) => query.type === 'paraphrase'));
  assert.ok(paraphrase.queries.every((query) => query.query !== query.targetToken));
  assert.ok(paraphrase.queries.every((query) => query.relevant.length >= 2));
});

test('retrieval metrics score a perfect ranking as one', () => {
  const ranked = ['a', 'b'];
  assert.equal(recallAtK(ranked, ['a'], 10), 1);
  assert.equal(hitAtK(ranked, ['a'], 10), 1);
  assert.equal(precisionAtK(ranked, ['a'], 10), 0.5);
  assert.equal(reciprocalRank(ranked, ['a'], 10), 1);
  assert.equal(ndcgAtK(ranked, ['a'], 10), 1);
  const metrics = evaluateQueries([{ items: [{ id: 'a' }], relevant: ['a'] }], { k: 10 });
  assert.equal(metrics.recallAtK, 1);
  assert.equal(metrics.hitAtK, 1);
  assert.equal(metrics.mrrAtK, 1);
});
