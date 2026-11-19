import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMood } from '../../src/self/state.js';

const base = { valence: 0, arousal: 0.2, energy: 0.6 };

test('越接近边界，同样的好事推动越小（饱和）', () => {
  const fromNeutral = applyMood({ ...base, valence: 0 }, { valence: 0.8, salience: 0.6 });
  const fromHigh = applyMood({ ...base, valence: 0.9 }, { valence: 0.8, salience: 0.6 });
  const deltaNeutral = fromNeutral.valence - 0;
  const deltaHigh = fromHigh.valence - 0.9;
  assert.ok(deltaHigh < deltaNeutral, `高处应更小：${deltaHigh} < ${deltaNeutral}`);
  assert.ok(deltaHigh > 0, '仍然要往好的方向走');
});

test('反复叠加只会逼近上限，不会一次顶死', () => {
  let mood = { ...base };
  for (let i = 0; i < 3; i += 1) mood = applyMood(mood, { valence: 1, salience: 1, weight: 0.5 });
  assert.ok(mood.valence < 0.99, `不应该顶到 1.0：${mood.valence}`);
  assert.ok(mood.valence > 0.9, `但也该足够高：${mood.valence}`);
});

test('负向事件同样饱和，一次不该按到底', () => {
  const mood = applyMood({ ...base, valence: -0.9 }, { valence: -1, salience: 0.9 });
  assert.ok(mood.valence > -1, `一次事件不该把它按到底：${mood.valence}`);
  assert.ok(mood.valence < -0.9, '但确实更低了');
});

test('唤醒度用同样的饱和规则，且不越出 0..1', () => {
  const high = applyMood({ ...base, arousal: 0.95 }, { arousal: 1, salience: 1 });
  assert.ok(high.arousal <= 1);
  assert.ok(high.arousal > 0.95);
});
