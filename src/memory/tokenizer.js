const LATIN = /[a-z0-9_]+/g;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

export function tokenList(text) {
  const value = String(text ?? '').toLowerCase();
  const out = [];
  for (const word of value.match(LATIN) ?? []) {
    if (word.length > 1) out.push(word);
  }
  for (const run of value.match(HAN) ?? []) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
    if (run.length >= 3 && run.length <= 4) out.push(run);
  }
  return out;
}

export function tokens(text) {
  return new Set(tokenList(text));
}

export function ftsText(text) {
  // FTS5 needs a whitespace-separated token stream; CJK bigrams are built here
  // so the index does not depend on the host locale or a dictionary.
  return tokenList(text).join(' ');
}

function quote(token) {
  return `"${String(token).replace(/"/g, '""')}"`;
}

export function buildMatchQuery(query, { mode = 'or', maxTokens = 24 } = {}) {
  const list = [...new Set(tokenList(query))].slice(0, maxTokens);
  if (list.length === 0) return '';
  const joiner = mode === 'and' ? ' AND ' : ' OR ';
  return list.map(quote).join(joiner);
}

export function overlapScore(a, b) {
  const left = typeof a === 'string' ? tokens(a) : a;
  const right = typeof b === 'string' ? tokens(b) : b;
  if (!left || !right || left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.sqrt(left.size * right.size);
}

export function jaccard(a, b) {
  const left = typeof a === 'string' ? tokens(a) : a;
  const right = typeof b === 'string' ? tokens(b) : b;
  if (!left || !right) return 0;
  let intersection = 0;
  let union = left.size + right.size;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
      union -= 1;
    }
  }
  return union === 0 ? 0 : intersection / union;
}

export function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function estimateTokens(text) {
  // Mixed CJK/latin heuristic: ~1 token per 1.6 visible characters, floor 1.
  const value = String(text ?? '');
  if (!value) return 0;
  return Math.max(1, Math.ceil(value.length / 1.6));
}
