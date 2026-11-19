import test from 'node:test';
import assert from 'node:assert/strict';
import { touchInterval } from '../../src/memory/spacing.js';

test('spacing doubles per access and caps at the maximum', () => {
  assert.equal(touchInterval(0), 300_000);
  assert.equal(touchInterval(1), 600_000);
  assert.equal(touchInterval(2), 1_200_000);
  assert.equal(touchInterval(3), 2_400_000);
  assert.equal(touchInterval(20), 21_600_000, 'caps at six hours');
  assert.equal(touchInterval(-5), 300_000, 'negative counts fall back to the base');
  assert.equal(touchInterval(2, { baseMs: 1_000, maxMs: 5_000 }), 4_000);
  assert.equal(touchInterval(4, { baseMs: 1_000, maxMs: 5_000 }), 5_000, 'never exceeds maxMs');
});
