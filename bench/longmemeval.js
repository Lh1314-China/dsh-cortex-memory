import { evaluateQueries } from './metrics.js';

/**
 * LongMemEval retrieval adapter (offline, no dataset bundled).
 * Dataset: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
 * Paper:   https://arxiv.org/abs/2410.10813
 *
 * This adapter evaluates session/turn *retrieval*, not end-to-end QA. It does
 * not claim official LongMemEval scores.
 */

export function instanceType(instance) {
  if (String(instance.question_id ?? '').endsWith('_abs')) return 'abstention';
  return instance.question_type ?? 'unknown';
}

export function buildLongMemEvalIndex({ cortex, instances = [], scopeId = 'global' } = {}) {
  if (!cortex) throw new Error('buildLongMemEvalIndex needs cortex');
  const sessionTraceIds = new Map();
  const queries = [];
  let traces = 0;

  for (const instance of instances) {
    const qid = String(instance.question_id ?? `q${queries.length}`);
    const questionDate = instance.question_date ? Date.parse(instance.question_date) : Date.now();
    const sessions = Array.isArray(instance.haystack_sessions) ? instance.haystack_sessions : [];
    const sessionIds = Array.isArray(instance.haystack_session_ids) ? instance.haystack_session_ids : [];
    const dates = Array.isArray(instance.haystack_dates) ? instance.haystack_dates : [];
    const turnRelevant = [];
    sessions.forEach((turns, sessionIndex) => {
      const sessionId = String(sessionIds[sessionIndex] ?? `${qid}-s${sessionIndex}`);
      const text = (Array.isArray(turns) ? turns : [])
        .map((turn) => `${turn.role === 'assistant' ? '助手' : '用户'}：${turn.content ?? ''}`)
        .join('\n');
      if (!text.trim()) return;
      const written = cortex.write({
        text,
        kind: 'episode',
        title: `LongMemEval ${qid} ${sessionId}`,
        tags: ['longmemeval', instanceType(instance)],
        explicit: true,
        importance: 0.5,
        operationId: `lme:${qid}:${sessionId}`,
        now: dates[sessionIndex] ? Date.parse(dates[sessionIndex]) : questionDate,
      });
      if (written.trace) {
        sessionTraceIds.set(`${qid}:${sessionId}`, written.trace.id);
        traces += 1;
      }
    });
    const relevant = (instance.answer_session_ids ?? [])
      .map((sessionId) => sessionTraceIds.get(`${qid}:${sessionId}`))
      .filter(Boolean);
    queries.push({
      id: qid,
      query: instance.question ?? '',
      type: instanceType(instance),
      questionDate: new Date(questionDate).toISOString(),
      relevant,
      answer: instance.answer ?? null,
      abstention: instanceType(instance) === 'abstention',
    });
  }

  return { scopeId, traces, queries, sessionTraceIds };
}

export function evaluateLongMemEvalRetrieval({ cortex, instances = [], limit = 10, includeAbstention = false } = {}) {
  const built = buildLongMemEvalIndex({ cortex, instances });
  const evaluated = built.queries.filter((query) => includeAbstention || !query.abstention);
  const results = evaluated.map((query) => {
    const output = cortex.search(query.query, { limit, budget: 3000 });
    return { items: output.items, relevant: query.relevant, type: query.type };
  });
  const overall = evaluateQueries(results, { k: limit });
  const byType = {};
  const typeBuckets = {};
  results.forEach((result) => {
    (typeBuckets[result.type] ??= []).push(result);
  });
  for (const [type, bucket] of Object.entries(typeBuckets)) byType[type] = evaluateQueries(bucket, { k: limit });
  return { ...overall, byType, built: { traces: built.traces, queries: built.queries.length, evaluated: evaluated.length } };
}
