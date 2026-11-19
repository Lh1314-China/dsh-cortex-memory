import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceBudgetFor } from '../../src/engines/reflect.js';

test('整窗按 12%（上限 16），分段按 25%（上限 24）', () => {
  const table = [
    // [条数, 整窗, 分段]
    [10, 8, 8],
    [40, 8, 10],
    [100, 12, 24],
    [200, 16, 24],
    [500, 16, 24],
  ];
  for (const [count, wholeDay, segment] of table) {
    assert.equal(sourceBudgetFor(count), wholeDay, `${count} 条整窗预算`);
    assert.equal(sourceBudgetFor(count, { segment: true }), segment, `${count} 条分段预算`);
  }
});

test('显式 maxSources 覆盖两种默认', () => {
  assert.equal(sourceBudgetFor(500, { maxSources: 30 }), 30);
  assert.equal(sourceBudgetFor(500, { segment: true, maxSources: 5 }), 5);
  assert.equal(sourceBudgetFor(500, { maxSources: 0 }), 16, '0 视为未指定');
});
