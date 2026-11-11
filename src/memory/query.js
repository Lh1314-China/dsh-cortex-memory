/**
 * Small, explicit query filter language:
 *   kind:utterance tag:白饭 after:2026-11-01 before:2026-12-01 importance:>0.5 主人
 * Unknown prefixes stay in the free text, so normal searches are unchanged.
 */
const KEYS = new Set(['kind', 'tag', 'after', 'before', 'state', 'importance', 'source', 'actor']);

export function parseQuery(input) {
  const text = String(input ?? '').trim();
  const filters = {};
  const free = [];
  for (const token of text.split(/\s+/)) {
    const match = token.match(/^([a-z]+):(.+)$/i);
    if (!match || !KEYS.has(match[1].toLowerCase())) {
      free.push(token);
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2];
    if (key === 'importance') {
      const op = value.match(/^(>=|<=|>|<|=)?(.*)$/) ?? [];
      filters.importance = { op: op[1] || '=', value: Number(op[2]) };
    } else if (key === 'tag') {
      filters.tags = [...(filters.tags ?? []), value];
    } else {
      filters[key] = value;
    }
  }
  return { text: free.join(' ').trim(), filters };
}

export function matchesFilters(trace, filters = {}) {
  if (!trace) return false;
  if (filters.kind && trace.kind !== filters.kind) return false;
  if (filters.state && trace.state !== filters.state) return false;
  if (filters.source && trace.source !== filters.source) return false;
  if (filters.actor && trace.actor !== filters.actor) return false;
  if (filters.tags?.length) {
    const tags = new Set(trace.tags ?? []);
    if (!filters.tags.every((tag) => tags.has(tag))) return false;
  }
  if (filters.after) {
    const at = Date.parse(trace.recordedAt);
    if (!Number.isFinite(at) || at < Date.parse(filters.after)) return false;
  }
  if (filters.before) {
    const at = Date.parse(trace.recordedAt);
    if (!Number.isFinite(at) || at >= Date.parse(filters.before)) return false;
  }
  if (filters.importance) {
    const value = Number(trace.importance);
    const target = filters.importance.value;
    if (!Number.isFinite(target)) return false;
    const compare = { '>': value > target, '>=': value >= target, '<': value < target, '<=': value <= target, '=': value === target }[filters.importance.op];
    if (!compare) return false;
  }
  return true;
}
