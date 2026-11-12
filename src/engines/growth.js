import { clamp, nowIso } from '../core/time.js';
import { review, gradeFromSignal, GRADES } from '../memory/dsr.js';
import { POSITIVE_SIGNALS, NEGATIVE_SIGNALS } from '../store/repositories/feedback.js';

/**
 * Feedback is where memory becomes development:
 * - a trace's DSR state changes,
 * - its confidence changes,
 * - the self-state and relationship move a little,
 * - and calibration is measured instead of assumed.
 */
export function createGrowthEngine({
  traces,
  feedback,
  selfStore = null,
  relationshipStore = null,
  audit = null,
  config = {},
} = {}) {
  if (!traces || !feedback) throw new Error('growth engine needs traces and feedback');

  function applyFeedback({
    traceId,
    signal,
    predicted = null,
    source = 'user',
    target = '用户',
    scopeId = 'global',
    eventId = null,
    now = Date.now(),
  } = {}) {
    const trace = traces.get(traceId);
    if (!trace) throw new Error(`trace not found: ${traceId}`);
    const grade = gradeFromSignal(signal);
    const reviewed = review(trace, grade, {
      now,
      decay: config.dsr?.decay ?? -0.5,
      maximumStability: config.dsr?.maximumStability ?? 3650,
    });
    const positive = POSITIVE_SIGNALS.has(signal);
    const negative = NEGATIVE_SIGNALS.has(signal);
    const confidenceDelta = positive ? 0.05 : negative ? -0.12 : 0;
    const confidence = clamp((trace.confidence ?? 0.7) + confidenceDelta, 0, 1);
    const updated = traces.update(traceId, {
      stability: reviewed.stability,
      difficulty: reviewed.difficulty,
      retrievability: reviewed.retrievability,
      reviewCount: reviewed.reviewCount,
      lapseCount: reviewed.lapseCount,
      lastReviewAt: reviewed.lastReviewAt,
      lastAccessAt: nowIso(now),
      confidence,
    });
    const row = feedback.add({
      scopeId,
      traceId,
      signal,
      value: predicted == null ? confidence : clamp(predicted, 0, 1),
      source,
      eventId,
      at: nowIso(now),
    });

    let self = null;
    if (selfStore) {
      self = selfStore.applyAppraisal(scopeId, {
        salience: 0.65,
        valence: positive ? 0.35 : negative ? -0.35 : 0,
        arousal: 0.3,
        driveDeltas: {
          care: positive ? 0.04 : negative ? -0.03 : 0,
          coherence: negative ? -0.08 : 0.02,
          safety: negative ? -0.04 : 0,
        },
      }, { at: now });
    }

    let relationship = null;
    if (relationshipStore) {
      relationship = relationshipStore.applyDelta(scopeId, target, {
        trustDelta: positive ? 0.03 : negative ? -0.05 : 0,
        careDelta: positive ? 0.03 : negative ? -0.02 : 0,
        familiarityDelta: 0.005,
      }, { event: `feedback:${signal}`, at: nowIso(now) });
    }

    audit?.record?.({
      actor: source,
      action: 'trace.feedback',
      targetType: 'trace',
      targetId: traceId,
      detail: { signal, grade, confidence, stability: reviewed.stability },
    });

    return { trace: updated, feedback: row, self, relationship, grade };
  }

  function calibration({ scopeId = 'global', window = 200 } = {}) {
    const items = feedback.list({ scopeId, limit: window })
      .filter((item) => item.value != null)
      .filter((item) => POSITIVE_SIGNALS.has(item.signal) || NEGATIVE_SIGNALS.has(item.signal));
    if (items.length === 0) {
      return { n: 0, brier: null, accuracy: null, ece: null, bins: [] };
    }
    const bins = Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, actual: 0 }));
    let brier = 0;
    let correct = 0;
    for (const item of items) {
      const y = POSITIVE_SIGNALS.has(item.signal) ? 1 : 0;
      const p = clamp(item.value, 0, 1);
      brier += (p - y) ** 2;
      if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
      const index = Math.min(9, Math.floor(p * 10));
      bins[index].n += 1;
      bins[index].predicted += p;
      bins[index].actual += y;
    }
    const n = items.length;
    let ece = 0;
    for (const bin of bins) {
      if (!bin.n) continue;
      ece += (bin.n / n) * Math.abs((bin.predicted / bin.n) - (bin.actual / bin.n));
    }
    return {
      n,
      brier: brier / n,
      accuracy: correct / n,
      ece,
      bins: bins.map((bin) => ({
        n: bin.n,
        predicted: bin.n ? bin.predicted / bin.n : null,
        actual: bin.n ? bin.actual / bin.n : null,
      })),
    };
  }

  function snapshot({ scopeId = 'global' } = {}) {
    const items = feedback.list({ scopeId, limit: 1000 });
    const positive = items.filter((item) => POSITIVE_SIGNALS.has(item.signal)).length;
    const negative = items.filter((item) => NEGATIVE_SIGNALS.has(item.signal)).length;
    return {
      feedback: { total: items.length, positive, negative },
      calibration: calibration({ scopeId }),
      at: nowIso(),
    };
  }

  return { applyFeedback, calibration, snapshot, GRADES };
}
