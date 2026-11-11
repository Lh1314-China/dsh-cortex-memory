function stripJson(text) {
  const source = String(text ?? '').trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(source.slice(start, end + 1)); } catch { return null; }
}

/**
 * LLM fact extractor. It is deliberately JSON-only and fail-closed: a malformed
 * response produces no facts. It never invents a source event; the caller ties
 * each fact to the trace/event that produced it.
 */
export async function extractFactsWithLlm({ llm, text, maxFacts = 8 } = {}) {
  if (!llm || typeof llm.complete !== 'function') return { candidates: [], error: 'llm-unavailable' };
  const source = String(text ?? '').trim();
  if (source.length < 2) return { candidates: [], error: 'empty' };
  const raw = await llm.complete({
    system: [
      '你是记忆事实抽取器。只输出 JSON，不要 Markdown，不要解释。',
      '格式：{"facts":[{"subject":"...","predicate":"...","object":"...","confidence":0.0}]}',
      '只抽取文本明确支持的事实；主语/宾语尽量短；没有事实就输出 {"facts":[]}。',
      '不要把问题、命令、愿望当成事实；不要猜测。predicate 用英文 snake_case。',
    ].join('\n'),
    prompt: source.slice(0, 6000),
    maxTokens: 500,
    temperature: 0,
    purpose: 'cortex-facts',
  });
  if (!raw) return { candidates: [], error: 'empty-response' };
  const parsed = stripJson(raw);
  if (!parsed || !Array.isArray(parsed.facts)) return { candidates: [], error: 'invalid-json' };
  const seen = new Set();
  const candidates = [];
  for (const item of parsed.facts.slice(0, Math.max(1, Math.min(20, maxFacts)))) {
    if (!item || typeof item !== 'object') continue;
    const subject = String(item.subject ?? '').trim().slice(0, 40);
    const predicate = String(item.predicate ?? '').trim().slice(0, 60);
    const object = String(item.object ?? '').trim().slice(0, 120);
    const confidence = Number(item.confidence);
    if (!subject || !predicate || !object || !Number.isFinite(confidence) || confidence < 0.6) continue;
    const key = `${subject}|${predicate}|${object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ subject, predicate, object, confidence: Math.min(1, confidence) });
  }
  return { candidates, error: null };
}
