import { retrievability } from '../memory/dsr.js';
import { estimateTokens, jaccard, overlapScore, tokens } from '../memory/tokenizer.js';
import { daysBetween, nowIso } from '../core/time.js';
import { matchesFilters } from '../memory/query.js';

const INTENT_RULES = [
  [/昨天|今天|明天|上周|上个月|去年|什么时候|多久|时间|日期|几点|temporal/i, 'temporal'],
  [/后来|故事|一路|怎么走到|经历|回忆|narrative/i, 'narrative'],
  [/怎么|如何|步骤|流程|做法|教我|how to|procedure/i, 'procedural'],
  [/你是谁|你的边界|你的人设|你喜欢什么|你记得.*自己|identity/i, 'identity'],
  [/关系|和.*有关|谁认识|属于|relat|graph/i, 'relational'],
  [/是什么|多少|哪里|谁|fact|what|who|where/i, 'fact'],
];

export function classifyIntent(query) {
  const value = String(query ?? '');
  for (const [pattern, intent] of INTENT_RULES) {
    if (pattern.test(value)) return intent;
  }
  return 'fact';
}

export const INTENT_WEIGHTS = Object.freeze({
  fact: { fusion: 0.55, importance: 0.15, recency: 0.1, confidence: 0.15, access: 0.05, match: 0.25, exact: 0.2 },
  temporal: { fusion: 0.4, importance: 0.1, recency: 0.35, confidence: 0.1, access: 0.05, match: 0.25, exact: 0.2 },
  relational: { fusion: 0.5, importance: 0.15, recency: 0.1, confidence: 0.2, access: 0.05, match: 0.25, exact: 0.2 },
  procedural: { fusion: 0.45, importance: 0.25, recency: 0.1, confidence: 0.15, access: 0.05, match: 0.25, exact: 0.2 },
  narrative: { fusion: 0.4, importance: 0.15, recency: 0.3, confidence: 0.1, access: 0.05, match: 0.25, exact: 0.2 },
  identity: { fusion: 0.35, importance: 0.3, recency: 0.05, confidence: 0.25, access: 0.05, match: 0.25, exact: 0.2 },
});

export function weightedRrf(lists, { k = 60 } = {}) {
  const scores = new Map();
  for (const list of lists) {
    if (!Array.isArray(list?.items)) continue;
    const weight = Number(list.weight) || 1;
    let rank = 0;
    for (const item of list.items) {
      const id = item.id;
      if (!id) continue;
      rank += 1;
      const current = scores.get(id) ?? { id, score: 0, sources: [] };
      current.score += weight / (k + rank);
      current.sources.push({ name: list.name, rank, weight });
      scores.set(id, current);
    }
  }
  return scores;
}

function normalize(value, max) {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.min(1, value / max);
}

function snippet(trace, max = 220) {
  const value = trace.summary || trace.content || '';
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function queryCoverage(wanted, present) {
  if (!wanted || !present || wanted.size === 0 || present.size === 0) return 0;
  let shared = 0;
  for (const token of wanted) if (present.has(token)) shared += 1;
  return shared / wanted.size;
}

function candidateFromTrace(trace, fusion, intent, now, decay, weights = null, queryTokens = null) {
  const recency = retrievability(trace.stability, daysBetween(trace.lastAccessAt || trace.recordedAt, now), decay);
  const access = Math.log1p(Number(trace.accessCount) || 0) / Math.log1p(50);
  const w = { ...(INTENT_WEIGHTS[intent] || INTENT_WEIGHTS.fact), ...(weights ?? {}) };
  const fusionScore = typeof fusion === 'number' ? fusion : Number(fusion?.score) || 0;
  const text = `${trace.title ?? ''} ${trace.content ?? ''} ${trace.summary ?? ''}`;
  const textTokens = tokens(text);
  const match = queryCoverage(queryTokens, textTokens);
  const utility = w.fusion * fusionScore
    + w.importance * Number(trace.importance || 0)
    + w.recency * recency
    + w.confidence * Number(trace.confidence || 0)
    + w.access * access
    + w.match * match
    + w.exact * (match >= 0.999 ? 1 : 0);
  return {
    id: trace.id,
    type: 'trace',
    layer: trace.kind === 'identity' ? 'L0' : trace.kind === 'reflection' ? 'L5' : 'L2',
    title: trace.title || trace.kind,
    snippet: snippet(trace),
    text,
    tokenSet: textTokens,
    utility,
    recency,
    match,
    importance: Number(trace.importance || 0),
    confidence: Number(trace.confidence || 0),
    validAt: trace.validAt,
    recordedAt: trace.recordedAt,
    cost: Math.max(16, estimateTokens(snippet(trace))),
    sources: fusion.sources,
    attachments: Array.isArray(trace.metadata?.attachments) ? trace.metadata.attachments.length : 0,
    trace,
  };
}

/**
 * Budgeted portfolio selection: pick a small set that covers the query without
 * paying for near-duplicates. The first item is always allowed so a tiny budget
 * still returns something.
 */
export function selectPortfolio(candidates, {
  budget = 2200,
  limit = 12,
  lambda = 0.35,
  mu = 0.08,
} = {}) {
  const ranked = [...candidates].sort((a, b) => b.utility - a.utility);
  const selected = [];
  const dropped = [];
  let used = 0;
  for (const candidate of ranked) {
    if (selected.length >= limit) {
      dropped.push({ id: candidate.id, reason: 'limit' });
      continue;
    }
    const cost = Math.max(1, Math.min(candidate.cost, budget));
    if (used + cost > budget) {
      dropped.push({ id: candidate.id, reason: 'budget' });
      continue;
    }
    let redundancy = 0;
    for (const chosen of selected) {
      const candidateTokens = candidate.tokenSet ?? candidate.text;
      const chosenTokens = chosen.tokenSet ?? chosen.text;
      redundancy = Math.max(redundancy, jaccard(candidateTokens, chosenTokens), overlapScore(candidateTokens, chosenTokens) * 0.8);
    }
    const gain = candidate.utility - lambda * redundancy - mu * (cost / Math.max(1, budget));
    if (selected.length > 0 && gain <= 0) {
      dropped.push({ id: candidate.id, reason: 'low-marginal-gain', gain });
      continue;
    }
    selected.push({ ...candidate, cost, redundancy, gain });
    used += cost;
  }
  return { selected, dropped, used, budget };
}

export function createRetrievalEngine({ traces, facts = null, graph = null, vector = null, policy = null, config = {} } = {}) {
  const defaults = {
    budget: config.contextBudget ?? 2200,
    limit: config.resultLimit ?? 12,
    ftsLimit: config.ftsLimit ?? 40,
    k: 60,
    lambda: config.mmrLambda ?? 0.35,
    mu: config.costPenalty ?? 0.08,
    recentMinMatch: config.recentMinMatch ?? 0.12,
    recentImportanceFloor: config.recentImportanceFloor ?? 0.8,
    decay: config.dsr?.decay ?? -0.5,
  };

  function searchSources(query, { scopeId = 'global', limit = 12, now = Date.now(), includeArchived = false, weights = null, filters = null, vectorHits = null, gate = 'none' } = {}, intent = 'fact') {
    const queryTokens = tokens(query);
    const sourceTrace = [];
    const lists = [];
    let ftsCount = 0;
    let recentCount = 0;
    try {
      let hits = traces.searchFts(query, { scopeId, limit: Math.max(limit * 3, defaults.ftsLimit), includeArchived });
      let sourceName = 'fts';
      if (!hits.length) {
        // Character fallback: only when the exact bigram query has no hits.
        // This keeps normal FTS precision and lets 米饭 find 白饭 via 饭.
        hits = traces.searchFts(query, {
          scopeId,
          limit: Math.max(limit * 3, defaults.ftsLimit),
          includeArchived,
          soft: true,
        });
        sourceName = 'fts-soft';
      }
      ftsCount = hits.length;
      if (hits.length) lists.push({ name: sourceName, weight: sourceName === 'fts-soft' ? 0.7 : 1.0, items: hits });
    } catch (error) {
      sourceTrace.push({ source: 'fts', ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    try {
      const recent = traces.list({ scopeId, state: 'active', limit: Math.max(limit * 4, 50) });
      recentCount = recent.length;
      if (recent.length) lists.push({ name: 'recent', weight: 0.35, items: recent });
    } catch (error) {
      sourceTrace.push({ source: 'recent', ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    if (facts && typeof facts.queryAt === 'function') {
      // Facts are optional in this version; the hook is here so graph-aware
      // retrieval can be added without changing the engine contract.
      sourceTrace.push({ source: 'facts', ok: true, count: 0 });
    }
    if (graph && typeof graph.search === 'function') {
      try {
        const graphResult = graph.search(query, { scopeId, limit: Math.max(limit * 2, 10), at: nowIso(now) });
        const seen = new Set();
        const items = [];
        for (const trace of graphResult.traces ?? []) {
          if (!trace || seen.has(trace.id)) continue;
          seen.add(trace.id);
          items.push(trace);
        }
        if (items.length) lists.push({ name: 'graph', weight: 0.9, items });
        sourceTrace.push({ source: 'graph', ok: true, count: items.length, entities: graphResult.entities?.length ?? 0, facts: graphResult.facts?.length ?? 0 });
      } catch (error) {
        sourceTrace.push({ source: 'graph', ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (vector && (vectorHits !== null || typeof vector.search === 'function')) {
      try {
        const hits = vectorHits !== null
          ? vectorHits
          : vector.search(query, { scopeId, limit: Math.max(limit * 3, 20), includeArchived });
        const seen = new Set();
        const items = [];
        for (const hit of hits) {
          if (seen.has(hit.traceId)) continue;
          const trace = traces.get(hit.traceId);
          if (!trace) continue;
          seen.add(hit.traceId);
          items.push(trace);
        }
        if (items.length) lists.push({ name: 'vector', weight: 0.8, items });
        sourceTrace.push({ source: 'vector', ok: true, count: items.length });
      } catch (error) {
        sourceTrace.push({ source: 'vector', ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const fused = weightedRrf(lists, { k: defaults.k });
    const maxFusion = Math.max(1e-9, ...[...fused.values()].map((entry) => entry.score));
    const candidates = [];
    const fallbacks = [];
    let gated = 0;
    for (const [id, entry] of fused) {
      const trace = traces.get(id);
      if (!trace || trace.state === 'archived' && !includeArchived) continue;
      if (filters && !matchesFilters(trace, filters)) continue;
      const candidate = candidateFromTrace(trace, { ...entry, score: normalize(entry.score, maxFusion) }, intent, now, defaults.decay, weights, queryTokens);
      // Prompt-injection gate: only weaken candidates that entered solely via
      // the recency list or the soft FTS fallback. Strong sources still pass.
      // High importance is allowed to bypass the match floor, preserving the
      // 0.4.11 behaviour for identity-grade memories.
      const strongSource = (entry.sources ?? []).some((source) => ['fts', 'graph', 'vector', 'vector-ann', 'facts'].includes(source.name));
      if (gate === 'inject' && !strongSource
          && candidate.match < defaults.recentMinMatch
          && candidate.importance < defaults.recentImportanceFloor) {
        fallbacks.push(candidate);
        gated += 1;
        continue;
      }
      candidates.push(candidate);
    }
    // Nothing survived the gate: keep one important recent memory so a non-empty
    // store never injects an empty block, but never flood the prompt.
    if (gate === 'inject' && candidates.length === 0 && fallbacks.length) {
      fallbacks.sort((a, b) => b.importance - a.importance || b.recency - a.recency);
      candidates.push(fallbacks[0]);
    }
    for (const list of lists) {
      sourceTrace.push({ source: list.name, ok: true, count: list.items.length });
    }
    return { candidates, sourceTrace, ftsCount, recentCount, gated };
  }

  function search(query, {
    scopeId = 'global',
    budget = defaults.budget,
    limit = defaults.limit,
    now = Date.now(),
    includeArchived = false,
    filters = null,
    vectorHits = null,
    gate = 'none',
  } = {}) {
    const started = Date.now();
    const intent = classifyIntent(query);
    const activePolicy = (() => {
      try { return policy?.('retrieval') ?? null; } catch { return null; }
    })();
    const policyWeights = activePolicy?.weights ?? activePolicy?.intentWeights ?? null;
    const effectiveBudget = activePolicy?.budget != null
      ? Math.max(64, Math.min(20000, Number(activePolicy.budget)))
      : budget;
    const sources = searchSources(query, { scopeId, limit, now, includeArchived, weights: policyWeights, filters, vectorHits, gate }, intent);
    const portfolio = selectPortfolio(sources.candidates, {
      budget: effectiveBudget,
      limit,
      lambda: defaults.lambda,
      mu: defaults.mu,
    });
    const items = portfolio.selected.map((item) => ({
      id: item.id,
      type: item.type,
      layer: item.layer,
      title: item.title,
      snippet: item.snippet,
      score: Math.round(item.utility * 1000) / 1000,
      cost: item.cost,
      sources: item.sources,
      validAt: item.validAt,
      recordedAt: item.recordedAt,
      importance: Number(item.importance ?? 0),
      confidence: Number(item.confidence ?? 0),
      match: Number(item.match ?? 0),
      kind: item.trace?.kind ?? null,
      why: item.sources.map((source) => `${source.name}#${source.rank}`).join(','),
      attachments: item.attachments ?? 0,
    }));
    return {
      query,
      intent,
      scopeId,
      items,
      budget: { used: portfolio.used, total: effectiveBudget },
      trace: {
        elapsedMs: Date.now() - started,
        candidates: sources.candidates.length,
        gated: sources.gated ?? 0,
        selected: items.length,
        dropped: portfolio.dropped.length,
        sources: sources.sourceTrace,
      },
      at: nowIso(now),
    };
  }

  async function searchAsync(query, options = {}) {
    if (!vector || typeof vector.searchAsync !== 'function') return search(query, options);
    const limit = options.limit ?? defaults.limit;
    let vectorHits = [];
    try {
      vectorHits = await vector.searchAsync(query, {
        scopeId: options.scopeId ?? 'global',
        limit: Math.max(limit * 3, 20),
        includeArchived: options.includeArchived === true,
      });
    } catch {
      vectorHits = [];
    }
    return search(query, { ...options, vectorHits });
  }

  function timeline({ scopeId = 'global', aroundId, before = 5, after = 5, now = Date.now() } = {}) {
    const anchor = aroundId ? traces.get(aroundId) : null;
    if (!anchor) return { anchor: null, items: [] };
    const all = traces.list({ scopeId, state: 'active', limit: 500 });
    const sorted = all.slice().sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    const index = sorted.findIndex((item) => item.id === anchor.id);
    if (index < 0) return { anchor, items: [] };
    const from = Math.max(0, index - Math.max(0, before));
    const to = Math.min(sorted.length, index + Math.max(0, after) + 1);
    return {
      anchor,
      items: sorted.slice(from, to).map((item) => ({
        id: item.id,
        title: item.title,
        snippet: snippet(item, 160),
        recordedAt: item.recordedAt,
        kind: item.kind,
        isAnchor: item.id === anchor.id,
      })),
      at: nowIso(now),
    };
  }

  return { search, searchAsync, timeline, classifyIntent, defaults };
}
