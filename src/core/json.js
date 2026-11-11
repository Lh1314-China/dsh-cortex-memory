export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (node) => {
    if (node === null || typeof node === 'number' || typeof node === 'boolean' || typeof node === 'string') {
      return node;
    }
    if (typeof node === 'undefined') return null;
    if (typeof node === 'bigint') return String(node);
    if (typeof node === 'function' || typeof node === 'symbol') return null;
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object') {
      if (seen.has(node)) throw new Error('stableStringify cannot serialize a cyclic value');
      seen.add(node);
      const out = {};
      for (const key of Object.keys(node).sort()) {
        const value = walk(node[key]);
        if (value !== undefined) out[key] = value;
      }
      seen.delete(node);
      return out;
    }
    return null;
  };
  return JSON.stringify(walk(value));
}

export function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function asJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseJson(value, null);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

export function asJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseJson(value, null);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }
  return {};
}
