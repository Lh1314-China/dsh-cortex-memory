import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBonded, nextGrow } from '../../src/self/relationship.js';

test('信任的好事按剩余空间走，越熟越慢', () => {
  const low = nextBonded(0.2, 0.4);
  const high = nextBonded(0.9, 0.4);
  assert.ok(low - 0.2 > high - 0.9, '低处加得多');
  assert.ok(high > 0.9 && high < 1, '高处仍然加，但不会顶上');
});

test('失望掉得比好事加得多（损失更重）', () => {
  const gain = nextBonded(0.5, 0.3) - 0.5;
  const loss = 0.5 - nextBonded(0.5, -0.3);
  assert.ok(loss > gain, `掉 ${loss.toFixed(3)} 应该大于加 ${gain.toFixed(3)}`);
});

test('信任不会越界', () => {
  assert.equal(nextBonded(1, 0.5), 1);
  assert.equal(nextBonded(0, -0.5), 0);
  assert.ok(nextBonded(0.99, -1) >= 0);
});

test('熟悉度只增不减、缓慢逼近 1', () => {
  assert.ok(nextGrow(0.5, -0.3) > 0.5, '负的熟悉度增量也按专注度理解，不会倒退');
  let value = 0;
  for (let i = 0; i < 50; i += 1) value = nextGrow(value, 0.2);
  assert.ok(value > 0.99 && value <= 1);
});
