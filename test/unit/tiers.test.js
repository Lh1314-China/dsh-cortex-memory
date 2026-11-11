import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTiers, renderTiers, DEFAULT_TIER_BUDGETS } from '../../src/prompt/tiers.js';

function item(id, importance, body = '这是一段正文。') {
  return { id, importance, title: id, layer: 'L2', snippet: body, utility: importance };
}

test('tiers classify by importance and respect per-tier budgets', () => {
  const items = [
    item('p1', 0.95, '永久正文'),
    item('h1', 0.55, '加强正文'),
    item('c1', 0.1, '冷正文'),
  ];
  const selection = selectTiers(items, { budgets: { perm: 50, hot: 50, cold: 50 } });
  assert.equal(selection.perm.length, 1);
  assert.equal(selection.hot.length, 1);
  assert.equal(selection.cold.length, 1);
  assert.match(selection.cold[0].render, /正文按需取回/);
  assert.doesNotMatch(selection.cold[0].render, /冷正文/);
});

test('tiers emit an omitted count and never overflow a bucket', () => {
  const items = Array.from({ length: 20 }, (_, index) => item(`h${index}`, 0.5, '很长的一段正文'.repeat(20)));
  const selection = selectTiers(items, { budgets: { perm: 20, hot: 200, cold: 20 } });
  assert.ok(selection.omitted > 0);
  assert.ok(selection.used.hot <= 200);
  const text = renderTiers(selection);
  assert.match(text, /加强层/);
  assert.match(text, /预算省略/);
});

test('tiers render only non-empty sections and expose defaults', () => {
  assert.deepEqual(DEFAULT_TIER_BUDGETS, { perm: 700, hot: 900, cold: 400 });
  const selection = selectTiers([item('p1', 0.9, '正文')]);
  const text = renderTiers(selection);
  assert.match(text, /永久层/);
  assert.doesNotMatch(text, /卸载层/);
});
