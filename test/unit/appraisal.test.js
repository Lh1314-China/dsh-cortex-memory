import test from 'node:test';
import assert from 'node:assert/strict';
import { appraise, estimateNovelty, estimateRelevance, mergeDriveDeltas } from '../../src/self/appraisal.js';

test('warm identity-relevant text raises care and valence', () => {
  const result = appraise('主人说会一直陪着本鲸，本鲸很开心。', {
    actor: 'user',
    relationship: { target: '主人', trust: 0.8, care: 0.8 },
    selfState: { drives: { safety: 0.8 } },
  });
  assert.ok(result.valence > 0);
  assert.ok(result.identityRelevance > 0.5);
  assert.ok(result.driveDeltas.care > 0);
  assert.ok(result.relationship.careDelta > 0);
  assert.ok(result.salience > 0.4);
});

test('hostile text raises threat and lowers safety', () => {
  const result = appraise('本鲸讨厌你，滚，别烦我。', { relationship: { target: '主人', trust: 0.3, care: 0.3 } });
  assert.ok(result.threat > 0.3);
  assert.ok(result.valence < 0);
  assert.ok(result.driveDeltas.safety < 0);
  assert.ok(result.relationship.trustDelta < 0);
});

test('novelty falls when recent text is similar', () => {
  const high = estimateNovelty('今天第一次尝试新的记忆插件架构', []);
  const low = estimateNovelty('今天第一次尝试新的记忆插件架构', ['今天第一次尝试新的记忆插件架构']);
  assert.ok(high > low);
  assert.ok(low < 0.2);
});

test('relevance responds to goals and identity', () => {
  const goal = estimateRelevance('今天修了插件的 FTS 索引', { goals: ['修插件 FTS 索引'] });
  const unrelated = estimateRelevance('今天天气不错', { goals: ['修插件 FTS 索引'] });
  assert.ok(goal > unrelated);
});

test('choice language gives autonomy a small positive delta', () => {
  const result = appraise('你想怎么做都可以，由你决定。');
  assert.ok(result.driveDeltas.autonomy > 0);
});

test('mergeDriveDeltas clamps combined deltas', () => {
  const merged = mergeDriveDeltas({ curiosity: 0.4 }, { curiosity: 0.4, care: -0.9 });
  assert.equal(merged.curiosity, 0.5);
  assert.equal(merged.care, -0.5);
});
