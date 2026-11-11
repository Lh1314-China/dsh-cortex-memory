import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADES,
  DEFAULT_WEIGHTS,
  decayFactor,
  retrievability,
  initialStability,
  nextDifficulty,
  nextStability,
  review,
  gradeFromSignal,
  archiveDecision,
  computeRetrievability,
} from '../../src/memory/dsr.js';

const NOW = Date.parse('2026-11-11T00:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * 86400000).toISOString();

test('retrievability is 0.9 at t=S and decreases with time', () => {
  assert.ok(Math.abs(retrievability(10, 10, -0.5) - 0.9) < 1e-6);
  assert.ok(retrievability(10, 20, -0.5) < retrievability(10, 3, -0.5));
  assert.ok(retrievability(20, 10, -0.5) > retrievability(10, 10, -0.5));
  assert.ok(retrievability(1, 1000, -0.5) >= 0);
});

test('decay factor is finite and negative-decay safe', () => {
  assert.ok(Number.isFinite(decayFactor(-0.5)));
  assert.ok(decayFactor(-1) > 0);
  assert.ok(decayFactor(-0.1) > 0);
});

test('initial stability ranks identity above working and rewards importance', () => {
  const identity = initialStability({ type: 'identity', importance: 0.9 });
  const working = initialStability({ type: 'working', importance: 0.1 });
  const low = initialStability({ type: 'episodic', importance: 0.1 });
  const high = initialStability({ type: 'episodic', importance: 0.9 });
  assert.ok(identity > working);
  assert.ok(high > low);
  assert.ok(identity <= 3650);
});

test('difficulty is clamped and mean-reverts', () => {
  assert.equal(nextDifficulty(1, GRADES.easy), 1);
  assert.equal(nextDifficulty(10, GRADES.again), 10);
  const middle = nextDifficulty(5, GRADES.good);
  assert.ok(middle >= 1 && middle <= 10);
});

test('review raises stability for good and lowers it for again', () => {
  const base = {
    stability: 10,
    difficulty: 5,
    recordedAt: daysAgo(10),
    lastReviewAt: daysAgo(10),
    reviewCount: 0,
    lapseCount: 0,
  };
  const good = review(base, GRADES.good, { now: NOW, maximumStability: 3650 });
  assert.ok(good.stability > base.stability);
  assert.equal(good.reviewCount, 1);
  assert.equal(good.lapseCount, 0);
  const again = review(base, GRADES.again, { now: NOW, maximumStability: 3650 });
  assert.ok(again.stability < base.stability);
  assert.equal(again.lapseCount, 1);
  assert.ok(again.reviewCount === 1);
});

test('stability never exceeds the configured ceiling', () => {
  const next = nextStability({
    stability: 3000,
    difficulty: 1,
    retrievability: 0.9,
    grade: GRADES.easy,
    weights: DEFAULT_WEIGHTS,
    maximumStability: 100,
  });
  assert.ok(next <= 100);
});

test('feedback signals map to grades', () => {
  assert.equal(gradeFromSignal('helpful'), GRADES.easy);
  assert.equal(gradeFromSignal('used'), GRADES.easy);
  assert.equal(gradeFromSignal('ignored'), GRADES.hard);
  assert.equal(gradeFromSignal('corrected'), GRADES.again);
  assert.equal(gradeFromSignal('unknown'), GRADES.good);
});

test('archive is blocked for identity, important or young traces', () => {
  const base = {
    id: 't1',
    state: 'active',
    kind: 'observation',
    importance: 0.1,
    stability: 1,
    recordedAt: daysAgo(100),
    lastAccessAt: daysAgo(100),
  };
  assert.equal(archiveDecision({ ...base, kind: 'identity' }, { now: NOW }).archive, false);
  assert.equal(archiveDecision({ ...base, importance: 0.9 }, { now: NOW, coverage: 1 }).archive, false);
  assert.equal(archiveDecision({ ...base, recordedAt: daysAgo(1), lastAccessAt: daysAgo(1) }, { now: NOW, coverage: 1 }).archive, false);
  assert.equal(archiveDecision(base, { now: NOW, coverage: 0.1 }).archive, false);
  const decision = archiveDecision(base, { now: NOW, coverage: 0.95 });
  assert.equal(decision.archive, true);
  assert.equal(decision.reason, 'compressed');
});

test('computeRetrievability uses the last review/access time', () => {
  const trace = { stability: 10, lastReviewAt: daysAgo(10) };
  assert.ok(Math.abs(computeRetrievability(trace, NOW, -0.5) - 0.9) < 1e-6);
});
