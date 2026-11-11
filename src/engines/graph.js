import { jaccard } from '../memory/tokenizer.js';
import { nowIso } from '../core/time.js';

/**
 * Lightweight personalized PageRank over entities. Facts and explicit edges are
 * both adjacency sources; the graph is loaded per query (bounded by scope), so
 * there is no separate graph database to keep in sync.
 */
export function createGraphEngine({ entities, facts, edges = null, traces = null } = {}) {
  if (!entities || !facts) throw new Error('graph engine needs entities and facts');

  function loadAdjacency(scopeId, at) {
    const adjacency = new Map();
    const add = (from, to, rel, weight) => {
      if (!from || !to) return;
      const list = adjacency.get(from) ?? [];
      list.push({ to, rel, weight });
      adjacency.set(from, list);
    };
    const allFacts = facts.list({ scopeId, limit: 500 });
    for (const fact of allFacts) {
      if (fact.status === 'invalidated') continue;
      if (fact.validFrom && fact.validFrom > at) continue;
      if (fact.validTo && fact.validTo <= at) continue;
      if (fact.objectId) add(fact.subjectId, fact.objectId, fact.predicate, fact.confidence ?? 0.7);
      add(fact.objectId, fact.subjectId, `~${fact.predicate}`, (fact.confidence ?? 0.7) * 0.5);
    }
    if (edges) {
      for (const edge of edges.list({ scopeId, limit: 1000 })) {
        add(edge.fromId, edge.toId, edge.rel, edge.weight ?? 1);
        add(edge.toId, edge.fromId, `~${edge.rel}`, (edge.weight ?? 1) * 0.5);
      }
    }
    return adjacency;
  }

  function seedWeights(query, scopeId) {
    const candidates = entities.list({ scopeId, limit: 500 });
    const weights = new Map();
    const text = String(query ?? '');
    const lower = text.toLowerCase().trim();
    for (const entity of candidates) {
      let score = jaccard(text, `${entity.name} ${(entity.aliases ?? []).join(' ')}`);
      if (score === 0 && lower) {
        const names = [entity.name, ...(entity.aliases ?? [])].map((name) => String(name ?? '').toLowerCase().trim()).filter(Boolean);
        if (names.some((name) => name === lower || (name.length > 1 && lower.includes(name)) || (lower.length > 1 && name.includes(lower)))) {
          score = 0.65;
        }
      }
      if (score > 0) weights.set(entity.id, score);
    }
    if (weights.size === 0) {
      // Fall back to the top few most connected entities only if the query has
      // no lexical match; this keeps graph expansion from inventing relevance.
      return weights;
    }
    const max = Math.max(...weights.values());
    for (const [id, value] of weights) weights.set(id, value / max);
    return weights;
  }

  function ppr(adjacency, seeds, { damping = 0.5, iterations = 20 } = {}) {
    const nodes = new Set(adjacency.keys());
    for (const list of adjacency.values()) for (const edge of list) nodes.add(edge.to);
    for (const id of seeds.keys()) nodes.add(id);
    const ids = [...nodes];
    const n = Math.max(1, ids.length);
    let rank = new Map(ids.map((id) => [id, seeds.get(id) ?? 0]));
    const seedTotal = [...seeds.values()].reduce((sum, value) => sum + value, 0) || 1;
    for (const id of ids) rank.set(id, (seeds.get(id) ?? 0) / seedTotal);
    for (let step = 0; step < iterations; step += 1) {
      const next = new Map(ids.map((id) => [id, (1 - damping) / n]));
      for (const id of ids) {
        const out = adjacency.get(id) ?? [];
        if (out.length === 0) {
          for (const target of ids) next.set(target, next.get(target) + damping * rank.get(id) / n);
          continue;
        }
        const totalWeight = out.reduce((sum, edge) => sum + (edge.weight || 0.1), 0);
        for (const edge of out) {
          const share = (edge.weight || 0.1) / totalWeight;
          next.set(edge.to, (next.get(edge.to) ?? 0) + damping * rank.get(id) * share);
        }
      }
      rank = next;
    }
    return [...rank.entries()]
      .filter(([id]) => !seeds.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({ id, score }));
  }

  function search(query, { scopeId = 'global', limit = 10, at = nowIso() } = {}) {
    const seeds = seedWeights(query, scopeId);
    if (seeds.size === 0) return { query, seeds: [], entities: [], facts: [], traces: [], at };
    const adjacency = loadAdjacency(scopeId, at);
    const ranked = ppr(adjacency, seeds).slice(0, Math.max(1, Math.min(50, limit)));
    const entityMap = new Map(entities.list({ scopeId, limit: 500 }).map((item) => [item.id, item]));
    const entityResults = ranked.map((item) => ({ ...item, entity: entityMap.get(item.id) ?? null })).filter((item) => item.entity);
    const top = new Set([...seeds.keys(), ...entityResults.map((item) => item.id)]);
    const factResults = facts.list({ scopeId, limit: 500 })
      .filter((fact) => fact.status !== 'invalidated')
      .filter((fact) => top.has(fact.subjectId) || top.has(fact.objectId))
      .map((fact) => {
        const score = Math.max(
          (entityResults.find((item) => item.id === fact.subjectId)?.score ?? seeds.get(fact.subjectId) ?? 0),
          (entityResults.find((item) => item.id === fact.objectId)?.score ?? seeds.get(fact.objectId) ?? 0),
        ) * (fact.confidence ?? 0.7);
        return { fact, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(50, limit)));
    const traceResults = [];
    if (traces) {
      for (const { fact } of factResults) {
        if (!fact.sourceEventId) continue;
        const trace = traces.findByEvent(fact.sourceEventId);
        if (trace) traceResults.push(trace);
      }
    }
    return {
      query,
      seeds: [...seeds.keys()],
      entities: entityResults,
      facts: factResults,
      traces: traceResults,
      at,
    };
  }

  return { search, ppr, seedWeights, loadAdjacency };
}
