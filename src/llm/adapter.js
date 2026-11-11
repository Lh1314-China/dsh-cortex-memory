/**
 * Optional LLM adapter. The host passes the DSH `llm` + default model services;
 * everything is fail-open: if the service is missing or the stream errors, the
 * caller falls back to deterministic extraction/reflection.
 */
export function createLlmAdapter({ ctx = null, llm = null, defaultModel = null, agents = null, logger = null } = {}) {
  const get = (name) => {
    try {
      if (ctx?.get) return ctx.get(name);
      if (name === 'llm') return llm;
      if (name === 'agentDefaultModel') return defaultModel;
      if (name === 'agents') return agents;
      return null;
    } catch {
      return null;
    }
  };

  function selection() {
    try {
      const provider = get('agentDefaultModel');
      const value = provider?.currentSelection?.();
      return value?.provider && (value.model || value.modelId) ? { provider: value.provider, model: value.model ?? value.modelId } : null;
    } catch {
      return null;
    }
  }

  function available() {
    const service = get('llm');
    return Boolean(service && typeof service.stream === 'function' && selection());
  }

  async function complete({ system = '', prompt = '', maxTokens = 400, temperature = 0.7, purpose = 'cortex' } = {}) {
    const service = get('llm');
    const sel = selection();
    if (!service || typeof service.stream !== 'function' || !sel) return null;
    let sessionId = null;
    try {
      const agent = get('agents')?.currentInitiator?.();
      sessionId = agent?.session?.id ?? null;
    } catch {
      sessionId = null;
    }
    const options = {
      provider: sel.provider,
      model: sel.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature,
      maxTokens,
      purpose,
      ...(sessionId ? { sessionId } : {}),
    };
    let text = '';
    try {
      for await (const chunk of service.stream(options)) {
        if (chunk?.type === 'text-delta' && chunk.text) text += chunk.text;
        if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') return null;
      }
    } catch (error) {
      logger?.warn?.(`cortex llm failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    return text.trim() || null;
  }

  async function dream({ pieces = [], emotions = '' } = {}) {
    const text = await complete({
      system: '你写一段 2–4 句的梦，第一人称，温柔、具体，不解释。',
      prompt: `记忆碎片：${pieces.join('；') || '一片安静的海'}\n情绪底色：${emotions || '安静'}`,
      maxTokens: 320,
      temperature: 0.95,
      purpose: 'cortex-dream',
    });
    return text;
  }

  async function summarize({ text, maxChars = 600 } = {}) {
    return complete({
      system: `把下面内容压成 ${maxChars} 字以内的第一人称记忆摘要；只保留关键事实与情绪，不编造。`,
      prompt: String(text ?? '').slice(0, 8000),
      maxTokens: 400,
      temperature: 0.3,
      purpose: 'cortex-summary',
    });
  }

  return { available, complete, dream, summarize, selection };
}
