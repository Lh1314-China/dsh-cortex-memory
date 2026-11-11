/**
 * A small single-layer NSW (navigable small world) index. It is the
 * approximate-nearest-neighbour precursor to HNSW: greedy descent from an
 * entry point, then a bounded best-first expansion. It is intentionally
 * dependency-free and deterministic for a given seed.
 *
 * The Cortex vector store keeps a brute-force exact scan for small corpora;
 * this index is for a future large-corpus switch and for measuring the
 * recall/latency tradeoff without adding a native dependency.
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

function distance(a, b) {
  return 1 - cosine(a, b);
}

export function createAnnIndex({ M = 16, efConstruction = 100, efSearch = 64, seed = 42 } = {}) {
  const maxNeighbors = Math.max(2, Math.min(64, Number(M) || 16));
  const constructionWidth = Math.max(maxNeighbors, Number(efConstruction) || 100);
  const searchWidth = Math.max(10, Number(efSearch) || 64);
  const random = mulberry32(seed);
  const nodes = new Map();
  let entry = null;

  function nearestCandidates(query, startId, width) {
    const start = nodes.get(startId);
    if (!start) return [];
    const visited = new Set([startId]);
    const ranked = [{ id: startId, d: distance(query, start.vector) }];
    const frontier = [{ id: startId, d: ranked[0].d }];
    while (frontier.length && ranked.length < width * 2) {
      frontier.sort((a, b) => a.d - b.d);
      const current = frontier.shift();
      const node = nodes.get(current.id);
      if (!node) continue;
      for (const neighborId of node.neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const neighbor = nodes.get(neighborId);
        if (!neighbor) continue;
        const d = distance(query, neighbor.vector);
        ranked.push({ id: neighborId, d });
        frontier.push({ id: neighborId, d });
        if (ranked.length >= width * 2) break;
      }
    }
    return ranked.sort((a, b) => a.d - b.d).slice(0, width);
  }

  function connect(id, candidates) {
    const node = nodes.get(id);
    if (!node) return;
    for (const candidate of candidates) {
      if (candidate.id === id) continue;
      const other = nodes.get(candidate.id);
      if (!other) continue;
      if (!node.neighbors.includes(candidate.id)) node.neighbors.push(candidate.id);
      if (!other.neighbors.includes(id)) other.neighbors.push(id);
    }
    prune(node);
    for (const candidate of candidates) {
      const other = nodes.get(candidate.id);
      if (other) prune(other);
    }
  }

  function prune(node) {
    if (node.neighbors.length <= maxNeighbors) return;
    node.neighbors.sort((a, b) => distance(node.vector, nodes.get(a)?.vector ?? []) - distance(node.vector, nodes.get(b)?.vector ?? []));
    for (const removed of node.neighbors.splice(maxNeighbors)) {
      const other = nodes.get(removed);
      if (other) other.neighbors = other.neighbors.filter((id) => id !== node.id);
    }
  }

  function upsert(id, vector) {
    if (!id || !Array.isArray(vector) || !vector.length) throw new Error('ann upsert needs id and vector');
    const existing = nodes.get(id);
    if (existing) {
      existing.vector = vector.slice();
      return existing;
    }
    const node = { id, vector: vector.slice(), neighbors: [] };
    nodes.set(id, node);
    if (!entry) {
      entry = id;
      return node;
    }
    const candidates = nearestCandidates(node.vector, entry, constructionWidth)
      .filter((candidate) => candidate.id !== id)
      .slice(0, maxNeighbors);
    connect(id, candidates);
    const entryDistance = distance(node.vector, nodes.get(entry)?.vector ?? []);
    if (entryDistance > (candidates[0]?.d ?? Infinity)) entry = id;
    return node;
  }

  function search(query, k = 10, { ef = searchWidth } = {}) {
    if (!entry || !nodes.size) return [];
    const width = Math.max(Math.max(1, Number(k) || 10), Number(ef) || searchWidth);
    const ranked = nearestCandidates(query, entry, width);
    return ranked.slice(0, Math.max(1, Number(k) || 10)).map((item) => ({ id: item.id, score: 1 - item.d }));
  }

  function remove(id) {
    const node = nodes.get(id);
    if (!node) return false;
    for (const neighborId of node.neighbors) {
      const other = nodes.get(neighborId);
      if (other) other.neighbors = other.neighbors.filter((entryId) => entryId !== id);
    }
    nodes.delete(id);
    if (entry === id) entry = nodes.keys().next().value ?? null;
    return true;
  }

  function rebuild(entries = []) {
    nodes.clear();
    entry = null;
    for (const item of entries) upsert(item.id, item.vector);
    return nodes.size;
  }

  return {
    upsert,
    search,
    remove,
    rebuild,
    size: () => nodes.size,
    entry: () => entry,
    neighbors: (id) => nodes.get(id)?.neighbors.slice() ?? [],
    config: () => ({ M: maxNeighbors, efConstruction: constructionWidth, efSearch: searchWidth, seed }),
  };
}
