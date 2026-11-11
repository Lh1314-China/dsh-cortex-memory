const LATIN = /[a-z0-9_]+/g;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
const STOP_HAN = new Set('的了是在有和与我你他她它们这那就也都一个第条件把被让给对从到为以于及或而且但不没有很可能会吧呢啊'.split(''));

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

export function ftsTokenList(text) {
  // Bigrams preserve phrase specificity; single non-stop CJK chars act as a
  // cheap fuzzy fallback for near-synonyms that share a character (米饭/白饭).
  const out = tokenList(text);
  const value = String(text ?? '');
  for (const run of value.match(HAN) ?? []) {
    for (const ch of run) {
      if (!STOP_HAN.has(ch)) out.push(ch);
    }
  }
  return out;
}

export function ftsText(text, { soft = false } = {}) {
  // FTS5 needs a whitespace-separated token stream; CJK bigrams are built here
  // so the index does not depend on the host locale or a dictionary.
  return (soft ? ftsTokenList(text) : tokenList(text)).join(' ');
}

function quote(token) {
  return `"${String(token).replace(/"/g, '""')}"`;
}

export function buildMatchQuery(query, { mode = 'or', maxTokens = 24, soft = false } = {}) {
  const source = soft ? ftsTokenList(query) : tokenList(query);
  const list = [...new Set(source)].slice(0, soft ? Math.max(maxTokens, 48) : maxTokens);
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
