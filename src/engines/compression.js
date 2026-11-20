import { daysBetween, nowIso } from '../core/time.js';
import { computeRetrievability } from '../memory/dsr.js';
import { jaccard, estimateTokens, tokens } from '../memory/tokenizer.js';

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

export function createCompressionEngine({ traces, summaries, facts = null, entities = null, config = {}, memoryPolicy = null } = {}) {
  if (!traces || !summaries) throw new Error('compression engine needs traces and summaries');

  function evaluate({ scopeId = 'global', now = Date.now() } = {}) {
    const active = traces.list({ scopeId, state: 'active', limit: 5000 });
    const threadSummaries = summaries.list(scopeId, { limit: 200 });
    const factList = facts?.list?.({ scopeId, limit: 5000 }) ?? [];
    // Evergreen kinds are the owner's decision, not a heuristic: compression
    // never auto-archives them even when coverage and decay say it could.
    const evergreenKinds = memoryPolicy?.current?.().evergreenKinds ?? [];
    const rows = active.map((trace) => {
      const ageDays = daysBetween(trace.lastAccessAt || trace.recordedAt, now);
      const retrievability = computeRetrievability(trace, now, config.dsr?.decay ?? -0.5);
      const covered = coverageOf(trace, { summaries: threadSummaries, facts: factList });
      const evergreen = evergreenKinds.includes(String(trace.kind ?? ''));
      const eligible = !evergreen
        && ageDays >= (config.compression?.minAgeDays ?? 7)
        && retrievability < (config.compression?.retrievability ?? 0.5)
        && Number(trace.importance) < (config.compression?.importance ?? 0.35)
        && covered.coverage >= (config.compression?.coverageThreshold ?? 0.8);
      return { trace, ageDays, retrievability, coverage: covered.coverage, by: covered.by, evergreen, eligible, cost: estimateTokens(trace.content) };
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


// --- 0.4.117: verifiable coverage preview (read-only) ----------------------
// Two lessons from the first cut (reviewer, 2026-11-16):
//   1) an additive 0.45 floor turned "any overlap" into 47% coverage, so the
//      distribution collapsed (p50 0.472, spread 0.013);
//   2) tokens() keeps CJK bigrams with no stopword filtering, so two arbitrary
//      Chinese sentences share "我们/可以/这个". Content tokens are filtered by
//      document frequency instead of a hand-written list.
const STOP_CHARS = new Set('的了着过是在有和与我你他她它们这那就也都一个上下不没很可能会要把被让给对从到为以及或而且但并吗呢吧啊呀嘛哦嗯好'.split(''));

function contentTokenSets(documents) {
  // documents: array of strings. Returns [{ id?, set }] with high-frequency
  // bigrams removed, computed once per preview run.
  const raw = documents.map((value) => {
    const set = new Set();
    for (const token of tokens(value)) {
      if (token.length === 1) { if (STOP_CHARS.has(token)) continue; set.add(token); continue; }
      if (token.length === 2 && STOP_CHARS.has(token[0]) && STOP_CHARS.has(token[1])) continue;
      set.add(token);
    }
    return set;
  });
  const df = new Map();
  for (const set of raw) for (const token of set) df.set(token, (df.get(token) ?? 0) + 1);
  const cutoff = Math.max(2, Math.ceil(raw.length * 0.1));
  return raw.map((set) => {
    const kept = new Set();
    for (const token of set) if ((df.get(token) ?? 0) <= cutoff) kept.add(token);
    return kept;
  });
}

function coverage2(trace, summaryInput, traceSet) {
  const left = traceSet ?? contentTokenSets([`${trace.title ?? ''}${trace.content ?? ''}`])[0];
  const summarySets = (summaryInput ?? []).map((entry) => (entry && entry.set
    ? entry
    : { id: entry?.id ?? null, set: contentTokenSets([String(entry?.content ?? '')])[0] }));
  if (!left || left.size === 0) return { score: 0, by: null, summaryId: null, hit: 0, rate: 0 };
  let best = { score: 0, by: null, summaryId: null, hit: 0, rate: 0 };
  for (const entry of summarySets) {
    const right = entry.set;
    if (!right || right.size === 0) continue;
    let hit = 0;
    for (const token of left) if (right.has(token)) hit += 1;
    if (hit < 2) continue;
    const rate = hit / left.size;
    // No additive floor: coverage is the share of the trace's content tokens the
    // summary actually contains. Thin overlap stays small instead of starting at 0.47.
    const score = Math.min(0.92, 0.92 * rate);
    if (score > best.score) best = { score, by: 'summary-token', summaryId: entry.id, hit, rate };
  }
  return best;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

function previewCoverage({ scopeId = 'global', now = Date.now(), limit = 5000, threshold = 0.35 } = {}) {
  const active = traces.list({ scopeId, state: 'active', limit: Math.max(1, Math.min(5000, Number(limit) || 5000)) });
  const threadSummaries = summaries.list(scopeId, { limit: 200 });
  const factList = facts?.list?.({ scopeId, limit: 5000 }) ?? [];
  const importances = active.map((trace) => Number(trace.importance) || 0).sort((a, b) => a - b);
  // Same definition as consolidation: never below 0.9, capped at 0.95.
  const protectLine = Math.max(0.9, Math.min(0.95, percentile(importances, 0.75)));

  const docs = [];
  for (const trace of active) docs.push(`${trace.title ?? ''}${trace.content ?? ''}`);
  for (const summary of threadSummaries) docs.push(String(summary.content ?? ''));
  const sets = contentTokenSets(docs);
  const traceSets = new Map(active.map((trace, index) => [trace.id, sets[index]]));
  const summarySets = threadSummaries.map((summary, index) => ({ id: summary.id, set: sets[active.length + index] }));

  // Facts are denser and already curated; group their text by the event they came from.
  const factByEvent = new Map();
  for (const fact of factList) {
    if (!fact?.sourceEventId) continue;
    const bucket = factByEvent.get(fact.sourceEventId) ?? [];
    const subjectName = entities?.get?.(fact.subjectId)?.name ?? '';
    const objectName = fact.objectLiteral ?? entities?.get?.(fact.objectId)?.name ?? '';
    const evidence = Array.isArray(fact.evidence) ? fact.evidence.join(' ') : '';
    bucket.push(`${subjectName} ${fact.predicate ?? ''} ${objectName} ${evidence}`.trim());
    factByEvent.set(fact.sourceEventId, bucket);
  }
  const factSets = new Map();
  for (const [eventId, parts] of factByEvent) factSets.set(eventId, contentTokenSets([parts.join(' ')]));

  const rows = [];
  let protectedSkipped = 0;
  let recentSkipped = 0;
  let summaryCovered = 0;
  let factCovered = 0;
  let bothCovered = 0;
  for (const trace of active) {
    if (Number(trace.importance) >= protectLine || trace.kind === 'reflection' || trace.kind === 'promise') {
      protectedSkipped += 1;
      continue;
    }
    const lastAccess = trace.lastAccessAt ? Date.parse(trace.lastAccessAt) : null;
    if (lastAccess && now - lastAccess < 30 * 86_400_000) {
      recentSkipped += 1;
      continue;
    }
    const cover = coverage2(trace, summarySets, traceSets.get(trace.id));
    const factText = factByEvent.get(trace.eventId);
    const factSet = factText ? contentTokenSets([factText.join(' ')])[0] : null;
    let fact = { score: 0, hit: 0, rate: 0 };
    if (factSet) {
      let hit = 0;
      const left = traceSets.get(trace.id);
      for (const token of left) if (factSet.has(token)) hit += 1;
      if (hit >= 2) fact = { score: Math.min(0.9, 0.5 + 0.4 * (hit / left.size)), hit, rate: hit / left.size };
    }
    const kinds = (cover.score > 0 ? 1 : 0) + (fact.score > 0 ? 1 : 0);
    if (cover.score > 0) summaryCovered += 1;
    if (fact.score > 0) factCovered += 1;
    if (kinds >= 2) bothCovered += 1;
    const r = Math.max(cover.score, fact.score);
    if (!r) continue;
    rows.push({
      id: trace.id,
      title: String(trace.title ?? '').slice(0, 60),
      r: Number(r.toFixed(3)),
      kinds,
      basis: cover.score >= fact.score ? 'summary-token' : 'fact',
      summaryId: cover.summaryId,
      hit: cover.score >= fact.score ? cover.hit : fact.hit,
      rate: Number((cover.score >= fact.score ? cover.rate : fact.rate).toFixed(3)),
      tokens: traceSets.get(trace.id)?.size ?? 0,
    });
  }
  const values = rows.map((row) => row.r);
  const p50 = percentile(values, 0.5);
  const p75 = percentile(values, 0.75);
  const p90 = percentile(values, 0.9);
  const spread = Number((p90 - p50).toFixed(3));
  const THRESHOLD = Math.min(0.9, Math.max(0.2, Number(threshold) || 0.35));
  const pool = rows.filter((row) => row.r >= THRESHOLD).sort((a, b) => b.r - a.r);
  const strongPool = pool.filter((row) => row.kinds >= 2);
  const reason = values.length < 10 ? 'no_signal'
    : (pool.length === 0 ? 'empty_pool'
      : (strongPool.length === 0 ? 'single-evidence-only'
        : (spread < 0.05 ? 'flat' : null)));
  return {
    scanned: active.length,
    total: active.length,
    protectedSkipped,
    recentSkipped,
    scored: rows.length,
    summaryCovered,
    factCovered,
    bothCovered,
    facts: factList.length,
    summaries: threadSummaries.length,
    protectLine,
    threshold: THRESHOLD,
    percentiles: { p50, p75, p90, spread },
    pool: pool.length,
    strongPool: strongPool.length,
    usable: reason === null,
    reason,
    top: rows.sort((a, b) => b.r - a.r).slice(0, 10),
    wouldCut: strongPool.slice(0, 5),
  };
}

  return { evaluate, compress, revive, coverageOf, coverage2, previewCoverage };
}
