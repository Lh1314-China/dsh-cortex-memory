import { daysBetween, nowIso } from '../core/time.js';
import { computeRetrievability } from '../memory/dsr.js';
import { jaccard, estimateTokens } from '../memory/tokenizer.js';

/**
 * Compression is the bridge between "remembering everything" and "keeping a
 * model". A trace is archived only when a derived model covers it and its DSR
 * retrievability has fallen; the trace remains searchable by wake words.
 */
export function coverageOf(trace, { summaries = [], facts = [] } = {}) {
  const sourceHit = summaries.find((summary) => (summary.sourceIds ?? []).includes(trace.id));
  if (sourceHit) return { coverage: 1, by: 'summary-source' };
  const factHit = facts.find((fact) => fact.sourceEventId && fact.sourceEventId === trace.eventId);
  let best = factHit ? 0.6 : 0;
  let by = factHit ? 'fact-source' : null;
  for (const summary of summaries) {
    const overlap = jaccard(trace.content, summary.content);
    if (overlap > best) {
      best = overlap;
      by = 'summary-overlap';
    }
  }
  return { coverage: Math.min(1, best), by };
}

export function createCompressionEngine({ traces, summaries, facts = null, config = {} } = {}) {
  if (!traces || !summaries) throw new Error('compression engine needs traces and summaries');

  function evaluate({ scopeId = 'global', now = Date.now() } = {}) {
    const active = traces.list({ scopeId, state: 'active', limit: 5000 });
    const threadSummaries = summaries.list(scopeId, { limit: 200 });
    const factList = facts?.list?.({ scopeId, limit: 5000 }) ?? [];
    const rows = active.map((trace) => {
      const ageDays = daysBetween(trace.lastAccessAt || trace.recordedAt, now);
      const retrievability = computeRetrievability(trace, now, config.dsr?.decay ?? -0.5);
      const covered = coverageOf(trace, { summaries: threadSummaries, facts: factList });
      const eligible = ageDays >= (config.compression?.minAgeDays ?? 7)
        && retrievability < (config.compression?.retrievability ?? 0.5)
        && Number(trace.importance) < (config.compression?.importance ?? 0.35)
        && covered.coverage >= (config.compression?.coverageThreshold ?? 0.8);
      return { trace, ageDays, retrievability, coverage: covered.coverage, by: covered.by, eligible, cost: estimateTokens(trace.content) };
    });
    return rows;
  }

  function compress({ scopeId = 'global', now = Date.now(), limit = 100 } = {}) {
    const rows = evaluate({ scopeId, now }).filter((row) => row.eligible).slice(0, Math.max(1, Math.min(500, limit)));
    const archived = [];
    for (const row of rows) {
      const updated = traces.update(row.trace.id, { state: 'archived', compression: 'archived' });
      archived.push({ id: row.trace.id, coverage: row.coverage, retrieved: row.retrievability, ageDays: row.ageDays, trace: updated });
    }
    return { archived: archived.length, items: archived, at: nowIso(now) };
  }

  function revive(traceId, { now = Date.now() } = {}) {
    const trace = traces.get(traceId);
    if (!trace) return { revived: false, reason: 'not-found' };
    const updated = traces.update(traceId, {
      state: 'active',
      compression: 'raw',
      lastAccessAt: nowIso(now),
      stability: Math.max(Number(trace.stability) || 1, 3),
    });
    return { revived: true, trace: updated };
  }

  return { evaluate, compress, revive, coverageOf };
}
