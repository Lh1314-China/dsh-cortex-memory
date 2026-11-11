import { evaluateQueries } from '../../bench/metrics.js';

/**
 * Policy replay: run two retrieval functions over the same query/relevance set
 * and compare. It is deliberately pure; no DB writes, no automatic approval.
 */
export async function evaluatePolicy({ queries = [], run, limit = 10 } = {}) {
  if (typeof run !== 'function') throw new Error('evaluatePolicy needs a run(query) function');
  const results = [];
  const latencies = [];
  for (const item of queries) {
    const start = performance.now();
    const output = await run(item.query);
    latencies.push(performance.now() - start);
    results.push({ items: output?.items ?? output ?? [], relevant: item.relevant ?? [] });
  }
  return { ...evaluateQueries(results, { k: limit }), n: queries.length, p50Ms: percentile(latencies, 50), p95Ms: percentile(latencies, 95) };
}

function percentile(values, p) {
  const list = values.slice().sort((a, b) => a - b);
  if (list.length === 0) return null;
  return list[Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1))];
}

export async function comparePolicies({ queries = [], current, candidate, limit = 10 } = {}) {
  const before = await evaluatePolicy({ queries, run: current, limit });
  const after = await evaluatePolicy({ queries, run: candidate, limit });
  return {
    before,
    after,
    delta: {
      recallAtK: after.recallAtK - before.recallAtK,
      mrrAtK: after.mrrAtK - before.mrrAtK,
      ndcgAtK: after.ndcgAtK - before.ndcgAtK,
      p95Ms: (after.p95Ms ?? 0) - (before.p95Ms ?? 0),
    },
  };
}
