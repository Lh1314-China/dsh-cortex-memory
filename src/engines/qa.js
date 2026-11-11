/**
 * Retrieval-augmented answering over Cortex memory. This is the bridge a real
 * LoCoMo/LongMemEval QA run would use; it does not claim benchmark numbers.
 * Without an LLM it returns extractive evidence and says so.
 */
export function createQaEngine({ cortex, llm = null, reranker = null, limit = 8, budget = 3000 } = {}) {
  if (!cortex) throw new Error('qa engine needs cortex');

  async function contextFor(question, options = {}) {
    const search = typeof cortex.searchAsync === 'function' ? cortex.searchAsync : cortex.search;
    const result = await search(question, { limit: options.limit ?? limit, budget: options.budget ?? budget });
    return {
      result,
      block: result.items.map((item, index) => `[${index + 1}] (${item.layer}) ${item.title}\n${item.snippet}`).join('\n\n'),
    };
  }

  async function answer({ question, ...options } = {}) {
    const text = String(question ?? '').trim();
    if (!text) throw new Error('question is required');
    const { result } = await contextFor(text, options);
    let items = result.items;
    if (reranker && typeof reranker.rerank === 'function' && items.length > 1) {
      try {
        const ranked = await reranker.rerank(text, items.map((item) => item.snippet || item.text || ''));
        const reordered = ranked.map((row) => items[row.index]).filter(Boolean);
        if (reordered.length) items = reordered;
      } catch {
        /* fail open: keep fusion order */
      }
    }
    const block = items.map((item, index) => `[${index + 1}] (${item.layer}) ${item.title}\n${item.snippet}`).join('\n\n');
    const meaningful = Array.isArray(result.trace?.sources)
      && result.trace.sources.some((source) => ['fts', 'graph', 'vector'].includes(source.source) && Number(source.count ?? source.items ?? 0) > 0);
    if (!items.length || !meaningful) {
      return { answer: '不知道。没有召回相关记忆。', mode: 'abstain', sources: [], result };
    }
    if (llm && typeof llm.complete === 'function') {
      try {
        const output = await llm.complete({
          system: [
            '你是记忆问答器。只根据给定的记忆片段回答，不要使用外部知识。',
            '如果片段不足以回答，只输出“不知道”。',
            '回答尽量短；引用片段编号。',
          ].join('\n'),
          prompt: `问题：${text}\n\n记忆片段：\n${block}`,
          maxTokens: 300,
          temperature: 0.1,
          purpose: 'cortex-qa',
        });
        if (output) return { answer: output.trim(), mode: 'llm', sources: items, result };
      } catch {
        /* fall through */
      }
    }
    const best = items.slice(0, 3);
    return {
      answer: `（抽取式）${best.map((item) => item.snippet).join(' ')}`,
      mode: 'extractive',
      sources: best,
      result,
    };
  }

  async function batch({ questions = [], ...options } = {}) {
    const out = [];
    for (const question of questions) out.push({ question, ...(await answer({ question, ...options })) });
    return out;
  }

  return { answer, batch, contextFor };
}
