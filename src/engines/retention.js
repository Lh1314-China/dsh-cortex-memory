import { daysBetween, nowIso } from '../core/time.js';

/**
 * Retention planning is explicit and reviewable: it returns a plan first, and
 * only `apply` changes state. Important/pinned traces are never auto-archived.
 */
export function createRetentionEngine({ traces } = {}) {
  if (!traces) throw new Error('retention engine needs traces');

  function plan({ scopeId = 'global', now = Date.now(), maxTraces = 10000, maxAgeDays = 365, minImportance = 0.2, limit = 500 } = {}) {
    const active = traces.list({ scopeId, state: 'active', limit: 10000 });
    const candidates = [];
    for (let index = 0; index < active.length; index += 1) {
      const trace = active[index];
      const ageDays = daysBetween(trace.recordedAt, now);
      const overCount = index >= Math.max(0, maxTraces);
      const overAge = ageDays > maxAgeDays;
      const lowValue = Number(trace.importance) < minImportance && Number(trace.confidence) < 0.75;
      if ((overCount || overAge) && lowValue && trace.kind !== 'reflection') {
        candidates.push({ id: trace.id, ageDays, importance: trace.importance, confidence: trace.confidence, reason: overCount ? 'over-count' : 'over-age' });
        if (candidates.length >= Math.max(1, Math.min(2000, limit))) break;
      }
    }
    return { scopeId, at: nowIso(now), active: active.length, candidates, count: candidates.length };
  }

  function apply(planResult, { dryRun = false } = {}) {
    if (!planResult?.candidates) return { archived: 0, dryRun };
    if (dryRun) return { archived: planResult.candidates.length, dryRun: true, ids: planResult.candidates.map((item) => item.id) };
    const archived = [];
    for (const candidate of planResult.candidates) {
      const current = traces.get(candidate.id);
      if (!current || current.state !== 'active') continue;
      const updated = traces.update(candidate.id, { state: 'archived', compression: 'retention' });
      if (updated) archived.push(updated.id);
    }
    return { archived: archived.length, ids: archived };
  }

  return { plan, apply };
}
