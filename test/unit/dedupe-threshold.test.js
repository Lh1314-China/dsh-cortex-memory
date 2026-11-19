import test from 'node:test';
import assert from 'node:assert/strict';
import { clampThreshold } from '../../src/engines/consolidate.js';

test('相似度阈值被夹在 0.5–0.99，非法值回落到 0.8', () => {
  assert.equal(clampThreshold(0.1), 0.5);
  // 0 当作「没传」处理，回落到默认 0.8（比按 0 全合安全）。
  assert.equal(clampThreshold(0), 0.8);
  assert.equal(clampThreshold(1.5), 0.99);
  assert.equal(clampThreshold(0.8), 0.8);
  assert.equal(clampThreshold('0.7'), 0.7);
  assert.equal(clampThreshold(undefined), 0.8);
  assert.equal(clampThreshold(Number.NaN), 0.8);
});
