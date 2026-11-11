import { estimateTokens } from '../memory/tokenizer.js';

export const DEFAULT_TIER_BUDGETS = Object.freeze({ perm: 700, hot: 900, cold: 400 });

function tierOf(item) {
  const importance = Number(item.importance ?? 0);
  if (importance >= 0.8) return 'perm';
  const sources = Array.isArray(item.sources) ? item.sources.map((source) => source.name) : [];
  const lexicalHit = sources.includes('fts') || sources.includes('vector') || sources.includes('graph');
  if (importance < 0.4 && !lexicalHit) return 'cold';
  return 'hot';
}

function coldLine(item) {
  return `- [cold] ${item.id} · ${item.title ?? '(untitled)'}（正文按需取回）`;
}

/**
 * Budgeted three-tier injection. Cold memories are index-only: their bodies
 * stay out of the prompt and are fetched by id when actually needed.
 */
export function selectTiers(items, { budgets = DEFAULT_TIER_BUDGETS, now = Date.now() } = {}) {
  const limits = { ...DEFAULT_TIER_BUDGETS, ...budgets };
  const buckets = { perm: [], hot: [], cold: [] };
  const used = { perm: 0, hot: 0, cold: 0 };
  let omitted = 0;
  const selected = [];
  const sorted = [...(items ?? [])].sort((a, b) => Number(b.utility ?? b.score ?? 0) - Number(a.utility ?? a.score ?? 0));
  for (const item of sorted) {
    const tier = tierOf(item);
    const line = tier === 'cold'
      ? coldLine(item)
      : `- [${item.layer ?? tier}] ${item.title ?? '(untitled)'}：${item.snippet ?? ''}`;
    const cost = estimateTokens(line);
    if (used[tier] + cost > limits[tier]) { omitted += 1; continue; }
    buckets[tier].push({ ...item, tier, render: line, cost });
    used[tier] += cost;
    selected.push(item.id);
  }
  return { ...buckets, used, budgets: limits, omitted, selected, now };
}

export function renderTiers(selection) {
  const parts = [];
  if (selection.perm.length) parts.push(`## 永久层（每轮全文）\n${selection.perm.map((item) => item.render).join('\n')}`);
  if (selection.hot.length) parts.push(`## 加强层（每轮全文）\n${selection.hot.map((item) => item.render).join('\n')}`);
  if (selection.cold.length) parts.push(`## 卸载层（仅索引，正文按需 cortex_get）\n${selection.cold.map((item) => item.render).join('\n')}`);
  if (selection.omitted) parts.push(`（另有 ${selection.omitted} 条因分层预算省略）`);
  return parts.join('\n\n');
}
