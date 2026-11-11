import { evaluateQueries } from './metrics.js';

/**
 * LoCoMo retrieval adapter (offline, no dataset bundled).
 * Dataset/repo: https://github.com/snap-research/locomo
 *
 * The adapter is intentionally shape-tolerant: official samples expose
 * conversation sessions as `session_1`, `session_2`, ... with `evidence` like
 * `D1:2`. It evaluates retrieval only; it does not claim official QA scores.
 */

function sessionKeys(conversation) {
  return Object.keys(conversation ?? {})
    .filter((key) => /^session_\d+$/.test(key))
    .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]));
}

function parseEvidence(evidence) {
  const list = Array.isArray(evidence) ? evidence : [evidence];
  const out = [];
  for (const item of list) {
    const match = String(item ?? '').match(/D(\d+):(\d+)/i);
    if (match) out.push({ session: Number(match[1]), turn: Number(match[2]) });
  }
  return out;
}

export function buildLoCoMoIndex({ cortex, samples = [], scopeId = 'global' } = {}) {
  if (!cortex) throw new Error('buildLoCoMoIndex needs cortex');
  const turnTraceIds = new Map();
  const queries = [];
  let traces = 0;

  for (const sample of samples) {
    const sampleId = String(sample.sample_id ?? `sample-${queries.length}`);
    const conversation = sample.conversation ?? {};
    for (const key of sessionKeys(conversation)) {
      const number = Number(key.split('_')[1]);
      const date = conversation[`${key}_date_time`] ?? conversation[`${key}_date`] ?? null;
      const turns = Array.isArray(conversation[key]) ? conversation[key] : [];
      turns.forEach((turn, index) => {
        const text = `${turn.speaker ?? turn.role ?? '用户'}：${turn.text ?? turn.content ?? ''}`;
        if (!text.trim()) return;
        const written = cortex.write({
          text,
          kind: 'episode',
          title: `LoCoMo ${sampleId} D${number}:${index + 1}`,
          tags: ['locomo'],
          explicit: true,
          importance: 0.5,
          operationId: `locomo:${sampleId}:D${number}:${index + 1}`,
          now: date ? Date.parse(date) : undefined,
        });
        if (written.trace) {
          turnTraceIds.set(`${sampleId}:D${number}:${index + 1}`, written.trace.id);
          traces += 1;
        }
      });
    }
    for (const item of sample.qa ?? []) {
      const relevant = [];
      for (const ref of parseEvidence(item.evidence)) {
        const id = turnTraceIds.get(`${sampleId}:D${ref.session}:${ref.turn}`);
        if (id) relevant.push(id);
      }
      queries.push({
        id: `${sampleId}:${queries.length}`,
        query: item.question ?? '',
        answer: item.answer ?? null,
        type: String(item.category ?? 'unknown'),
        relevant,
        evidence: item.evidence ?? [],
      });
    }
  }
  return { scopeId, traces, queries, turnTraceIds };
}

export async function evaluateLoCoMoRetrieval({ cortex, samples = [], limit = 10, includeAdversarial = false } = {}) {
  const built = buildLoCoMoIndex({ cortex, samples });
  const evaluated = built.queries.filter((query) => includeAdversarial || query.type !== '5');
  const results = evaluated.map((query) => ({ items: cortex.search(query.query, { limit, budget: 3000 }).items, relevant: query.relevant, type: query.type }));
  const overall = evaluateQueries(results, { k: limit });
  const byType = {};
  const buckets = {};
  for (const result of results) (buckets[result.type] ??= []).push(result);
  for (const [type, bucket] of Object.entries(buckets)) byType[type] = evaluateQueries(bucket, { k: limit });
  return { ...overall, byType, built: { traces: built.traces, queries: built.queries.length, evaluated: evaluated.length } };
}
