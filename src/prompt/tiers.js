import { estimateTokens } from '../memory/tokenizer.js';

export const DEFAULT_TIER_BUDGETS = Object.freeze({ perm: 700, hot: 900, cold: 400 });

function isPerm(item) {
  return Number(item.importance ?? 0) >= 0.8;
}

function tierOf(item, context = {}) {
  const importance = Number(item.importance ?? 0);
  if (isPerm(item)) return 'perm';
  if (importance < 0.4) return 'cold';
  // `rank`/`total` describe the non-perm candidates only: counting the perm rows
  // in the denominator would let a high-importance-heavy recall eat the whole hot
  // tier (6 of 8 candidates at 0.9 → 2 cold, 0 hot).
  const { rank = 0, total = 0 } = context;
  // Count the cold rows first and slide the cut: `ceil(total * 0.75)` rounds the
  // *cut* up, which silently shrinks the tier (5 candidates → 1, not 2).
  const coldCount = total >= 4 ? Math.max(1, Math.ceil(total * 0.25)) : 0;
  if (rank >= total - coldCount) return 'cold';
  return 'hot';
}

function coldLine(item) {
  // A bare "id + title" is a table of contents; say *why* it might be worth
  // fetching. Match source tells us the reason, which is far more useful than a
  // timestamp ("last read 3 days ago" gives no basis for a decision).
  const names = (item.sources ?? []).map((source) => source?.name).filter(Boolean);
  const why = names.includes('vector') ? '语义相近'
    : names.includes('fts') ? '字面命中'
      : names.includes('graph') ? '共享实体'
        : names.length ? `命中 ${names[0]}` : '相关';
  return `- [cold] ${item.id} · ${item.title ?? '(untitled)'}（${why}，正文按需 cortex_get）`;
}

/**
 * Recalled snippets can be ~220 chars of engineering detail. Injected every
 * turn that is a lot of budget for context that is rarely needed verbatim, so
 * the full tiers render a one-sentence gist and leave the body to cortex_get.
 */
function gist(item, maxChars) {
  let raw = String(item.snippet ?? item.summary ?? '').trim();
  if (!raw) return '';
  // Titles are usually the first line of the body; drop that duplicated opening
  // before choosing a sentence, otherwise the gist is the title again.
  const title = String(item.title ?? '').trim();
  if (title && raw.startsWith(title)) raw = raw.slice(title.length).replace(/^[\s：:，,。.!！?？;；、\-—]+/, '').trim();
  if (!raw) return '';
  const sentences = raw.split(/(?<=[。！？；.!?;\n])/).map((part) => part.trim()).filter(Boolean);
  // Too short to stand alone as a gist: take the next sentence too, instead of
  // silently falling back to a hard truncation of the raw text.
  let text = sentences[0] ?? raw;
  if (text.length < 24 && sentences.length > 1) text = `${sentences[0]}${sentences[1]}`;
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}

/**
 * Titles are often the first line of the body, so `- title：gist` repeated the
 * same words ("0.4.60 打包…：0.4.60 打包…"). Drop a long shared prefix.
 */
function withoutTitlePrefix(title, text) {
  const t = String(title ?? '').trim();
  const s = String(text ?? '').trim();
  if (!t || !s) return s;
  let index = 0;
  const max = Math.min(t.length, s.length);
  while (index < max && t[index] === s[index]) index += 1;
  if (index < 12) return s;
  const rest = s.slice(index).replace(/^[\s：:，,。.!！?？;；、\-—]+/, '');
  return rest || s;
}

/**
 * Budgeted three-tier injection. Cold memories are index-only: their bodies
 * stay out of the prompt and are fetched by id when actually needed.
 */
export function selectTiers(items, { budgets = DEFAULT_TIER_BUDGETS, now = Date.now(), gistChars = 120 } = {}) {
  const limits = { ...DEFAULT_TIER_BUDGETS, ...budgets };
  const buckets = { perm: [], hot: [], cold: [] };
  const used = { perm: 0, hot: 0, cold: 0 };
  let omitted = 0;
  const selected = [];
  const sorted = [...(items ?? [])].sort((a, b) => {
    const byUtility = Number(b.utility ?? b.score ?? 0) - Number(a.utility ?? a.score ?? 0);
    if (byUtility !== 0) return byUtility;
    // Stable tie-break: equal utility must not reshuffle between turns.
    const byImportance = Number(b.importance ?? 0) - Number(a.importance ?? 0);
    if (byImportance !== 0) return byImportance;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
  // Rank the cold cut inside the non-perm pool: counting perm rows in the
  // denominator lets a high-importance-heavy recall consume the whole hot tier.
  const permCount = sorted.filter(isPerm).length;
  const relativeTotal = sorted.length - permCount;
  let relativeRank = -1;
  for (const item of sorted) {
    const permRow = isPerm(item);
    if (!permRow) relativeRank += 1;
    const tier = tierOf(item, { rank: permRow ? 0 : relativeRank, total: relativeTotal });
    const title = item.title ?? '(untitled)';
    let line;
    if (tier === 'cold') {
      line = coldLine(item);
    } else {
      const text = withoutTitlePrefix(item.title, gist(item, gistChars));
      // A body that is exactly its title leaves an empty gist; do not render a
      // dangling colon.
      line = text ? `- [${item.layer ?? tier}] ${title}：${text}` : `- [${item.layer ?? tier}] ${title}`;
    }
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
