import { clamp, daysBetween, nowIso } from '../core/time.js';

/**
 * DSR (difficulty / stability / retrievability) model.
 *
 * This is inspired by the public FSRS line of work, but the defaults and the
 * initial-stability heuristic are our own: they take memory type, importance,
 * emotional salience, confidence and source reliability into account. The
 * model is intentionally small and explainable; it does not learn parameters
 * until there is enough feedback to justify it.
 */

export const GRADES = Object.freeze({ again: 1, hard: 2, good: 3, easy: 4 });

export const DEFAULT_WEIGHTS = Object.freeze({
  w0: 0.4,
  w1: 0.6,
  w2: 2.4,
  w3: 5.8,
  w4: 4.93,
  w5: 0.94,
  w6: 0.86,
  w7: 0.01,
  w8: 1.49,
  w9: 0.14,
  w10: 0.94,
  w11: 2.18,
  w12: 0.05,
  w13: 0.34,
  w14: 1.26,
  w15: 0.29,
  w16: 2.61,
});

export const TYPE_BASE_STABILITY = Object.freeze({
  identity: 3650,
  working: 0.25,
  episodic: 2.5,
  semantic: 30,
  procedural: 20,
  reflective: 10,
});

export function decayFactor(decay) {
  const d = clamp(decay, -1, -0.1);
  return 0.9 ** (1 / d) - 1;
}

export function retrievability(stability, elapsedDays, decay = -0.5) {
  const s = Math.max(0.05, Number(stability) || 0.05);
  const t = Math.max(0, Number(elapsedDays) || 0);
  const factor = decayFactor(decay);
  const value = (1 + factor * (t / s)) ** clamp(decay, -1, -0.1);
  return clamp(value, 0, 1);
}

export function initialStability({
  type = 'episodic',
  importance = 0.5,
  salience = 0.5,
  confidence = 0.7,
  sourceReliability = 1,
  valence = 0,
} = {}) {
  const base = TYPE_BASE_STABILITY[type] ?? TYPE_BASE_STABILITY.episodic;
  const emotional = 1 + 0.4 * Math.abs(clamp(valence, -1, 1));
  const value = base
    * (0.5 + clamp(importance, 0, 1))
    * (0.6 + 0.8 * clamp(salience, 0, 1))
    * (0.5 + clamp(confidence, 0, 1))
    * (0.6 + 0.4 * clamp(sourceReliability, 0, 1))
    * emotional;
  return clamp(value, 0.1, 3650);
}

export function nextDifficulty(difficulty, grade, weights = DEFAULT_WEIGHTS) {
  const d = clamp(Number(difficulty) || 5, 1, 10);
  const g = clamp(Number(grade) || 3, 1, 4);
  const next = d - weights.w6 * (g - 3);
  const reverted = weights.w7 * 5 + (1 - weights.w7) * next;
  return clamp(reverted, 1, 10);
}

export function nextStability({
  stability,
  difficulty,
  retrievability: r,
  grade,
  weights = DEFAULT_WEIGHTS,
  maximumStability = 3650,
}) {
  const s = Math.max(0.1, Number(stability) || 1);
  const d = clamp(Number(difficulty) || 5, 1, 10);
  const g = clamp(Number(grade) || 3, 1, 4);
  const rr = clamp(r, 0, 1);
  let next;
  if (g === GRADES.again) {
    next = weights.w11
      * d ** -weights.w12
      * ((s + 1) ** weights.w13 - 1)
      * Math.exp((1 - rr) * weights.w14);
    next = Math.max(0.1, next);
  } else {
    const hardPenalty = g === GRADES.hard ? weights.w15 : 1;
    const easyBonus = g === GRADES.easy ? weights.w16 : 1;
    const increase = 1
      + Math.exp(weights.w8)
      * (11 - d)
      * s ** -weights.w9
      * (Math.exp((1 - rr) * weights.w10) - 1)
      * hardPenalty
      * easyBonus;
    next = s * Math.max(1, increase);
  }
  return clamp(next, 0.1, Math.max(1, Number(maximumStability) || 3650));
}

/**
 * Apply one review to a trace-like state. Pure: returns a new object.
 */
export function review(state, grade, {
  now = Date.now(),
  decay = -0.5,
  maximumStability = 3650,
  weights = DEFAULT_WEIGHTS,
} = {}) {
  const last = state.lastReviewAt || state.recordedAt || nowIso(now);
  const elapsed = daysBetween(last, now);
  const r = retrievability(state.stability, elapsed, decay);
  const difficulty = nextDifficulty(state.difficulty, grade, weights);
  const stability = nextStability({
    stability: state.stability,
    difficulty,
    retrievability: r,
    grade,
    weights,
    maximumStability,
  });
  return {
    stability,
    difficulty,
    retrievability: retrievability(stability, 0, decay),
    reviewCount: (Number(state.reviewCount) || 0) + 1,
    lapseCount: (Number(state.lapseCount) || 0) + (grade === GRADES.again ? 1 : 0),
    lastReviewAt: nowIso(now),
  };
}

export function gradeFromSignal(signal) {
  switch (String(signal ?? '').toLowerCase()) {
    case 'easy':
    case 'helpful':
    case 'used':
      return GRADES.easy;
    case 'good':
      return GRADES.good;
    case 'ignored':
    case 'hard':
      return GRADES.hard;
    case 'again':
    case 'incorrect':
    case 'corrected':
      return GRADES.again;
    default:
      return GRADES.good;
  }
}

/**
 * Archive decision: forgetting is compression, not deletion. A trace is only
 * archived when it is old enough, hard to recall, not important, and already
 * covered by a derived model (summary/fact/skill).
 */
export function archiveDecision(trace, {
  now = Date.now(),
  decay = -0.5,
  archiveRetrievability = 0.35,
  archiveImportance = 0.35,
  minAgeDays = 14,
  coverage = 0,
  coverageThreshold = 0.8,
} = {}) {
  if (trace.type === 'identity' || trace.kind === 'identity') return { archive: false, reason: 'identity' };
  if (trace.state !== 'active') return { archive: false, reason: `state:${trace.state}` };
  const age = daysBetween(trace.lastAccessAt || trace.recordedAt || trace.validAt, now);
  const r = retrievability(trace.stability, age, decay);
  const important = Number(trace.importance) >= archiveImportance;
  const oldEnough = age >= minAgeDays;
  const hardToRecall = r <= archiveRetrievability;
  const covered = Number(coverage) >= coverageThreshold;
  if (!oldEnough) return { archive: false, reason: 'too-young', retrievability: r, age };
  if (important) return { archive: false, reason: 'important', retrievability: r, age };
  if (!hardToRecall) return { archive: false, reason: 'still-retrievable', retrievability: r, age };
  if (!covered) return { archive: false, reason: 'not-covered', retrievability: r, age, coverage };
  return { archive: true, reason: 'compressed', retrievability: r, age, coverage };
}

export function computeRetrievability(trace, now = Date.now(), decay = -0.5) {
  const age = daysBetween(trace.lastReviewAt || trace.lastAccessAt || trace.recordedAt || trace.validAt, now);
  return retrievability(trace.stability, age, decay);
}
