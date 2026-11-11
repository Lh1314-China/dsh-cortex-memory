/**
 * Small dependency-free HNSW index for Cortex.
 *
 * This is a candidate replacement for the single-layer NSW in ann.js. It is
 * intentionally not wired into the production vector index until a benchmark
 * shows acceptable recall. The implementation uses simple sorted frontiers
 * (not a binary heap) because it is easier to audit; this is a benchmark
 * candidate, not a final large-corpus engine.
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

function createHeap(compare) {
  const items = [];
  const swap = (a, b) => { const value = items[a]; items[a] = items[b]; items[b] = value; };
  function bubbleUp(index) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compare(items[index], items[parent]) >= 0) break;
      swap(index, parent);
      index = parent;
    }
  }
  function bubbleDown(index) {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < items.length && compare(items[left], items[best]) < 0) best = left;
      if (right < items.length && compare(items[right], items[best]) < 0) best = right;
      if (best === index) break;
      swap(index, best);
      index = best;
    }
  }
  return {
    push(item) { items.push(item); bubbleUp(items.length - 1); },
    pop() {
      if (!items.length) return undefined;
      const first = items[0];
      const last = items.pop();
      if (items.length) { items[0] = last; bubbleDown(0); }
      return first;
    },
    peek() { return items[0]; },
    get size() { return items.length; },
    toArray() { return items.slice(); },
  };
}

export function createHnswIndex({ M = 16, efConstruction = 100, efSearch = 64, seed = 42, maxLevel = 16 } = {}) {
  const maxNeighbors = Math.max(2, Math.min(64, Number(M) || 16));
  const constructionWidth = Math.max(maxNeighbors, Number(efConstruction) || 100);
  const searchWidth = Math.max(10, Number(efSearch) || 64);
  const levelCap = Math.max(1, Math.min(32, Number(maxLevel) || 16));
  const levelNormalizer = 1 / Math.log(Math.max(2, maxNeighbors));
  const random = mulberry32(seed);
  const nodes = new Map();
  let entry = null;
  let topLevel = -1;

  function randomLevel() {
    const value = -Math.log(Math.max(1e-12, random())) * levelNormalizer;
    return Math.min(levelCap, Math.floor(value));
  }

  function nearestInLayer(query, startId, layer) {
    let current = nodes.get(startId);
    if (!current) return null;
    let currentDistance = distance(query, current.vector);
    let improved = true;
    while (improved) {
      improved = false;
      for (const neighborId of current.neighbors[layer] ?? []) {
        const neighbor = nodes.get(neighborId);
        if (!neighbor) continue;
        const candidateDistance = distance(query, neighbor.vector);
        if (candidateDistance < currentDistance) {
          current = neighbor;
          currentDistance = candidateDistance;
          improved = true;
        }
      }
    }
    return { id: current.id, d: currentDistance };
  }

  function searchLayer(query, entryPoints, width, layer) {
    const visited = new Set();
    const candidates = createHeap((a, b) => a.d - b.d);
    const results = createHeap((a, b) => b.d - a.d);
    for (const id of entryPoints) {
      if (visited.has(id)) continue;
      const node = nodes.get(id);
      if (!node) continue;
      const d = distance(query, node.vector);
      visited.add(id);
      candidates.push({ id, d });
      results.push({ id, d });
    }
    while (candidates.size) {
      const current = candidates.pop();
      const worst = results.size >= width ? results.peek().d : Infinity;
      if (current.d > worst && results.size >= width) break;
      const node = nodes.get(current.id);
      if (!node) continue;
      for (const neighborId of node.neighbors[layer] ?? []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const neighbor = nodes.get(neighborId);
        if (!neighbor) continue;
        const d = distance(query, neighbor.vector);
        if (results.size >= width && d >= results.peek().d) continue;
        candidates.push({ id: neighborId, d });
        results.push({ id: neighborId, d });
        if (results.size > width) results.pop();
      }
    }
    return results.toArray().sort((a, b) => a.d - b.d);
  }

  function connect(node, candidates, layer) {
    const selected = candidates
      .filter((item) => item.id !== node.id && nodes.has(item.id))
      .sort((a, b) => a.d - b.d)
      .slice(0, maxNeighbors);
    node.neighbors[layer] = selected.map((item) => item.id);
    for (const candidate of selected) {
      const other = nodes.get(candidate.id);
      if (!other) continue;
      const neighbors = other.neighbors[layer] ?? [];
      if (!neighbors.includes(node.id)) neighbors.push(node.id);
      if (neighbors.length > maxNeighbors) {
        neighbors.sort((a, b) => distance(other.vector, nodes.get(a)?.vector ?? []) - distance(other.vector, nodes.get(b)?.vector ?? []));
        neighbors.length = maxNeighbors;
      }
      other.neighbors[layer] = neighbors;
    }
  }

  function upsert(id, vector) {
    if (!id || !Array.isArray(vector) || !vector.length) throw new Error('hnsw upsert needs id and vector');
    const existing = nodes.get(id);
    if (existing) {
      existing.vector = vector.slice();
      return existing;
    }
    const node = { id, vector: vector.slice(), level: randomLevel(), neighbors: [] };
    nodes.set(id, node);
    if (!entry) {
      entry = id;
      topLevel = node.level;
      return node;
    }
    let current = entry;
    for (let layer = topLevel; layer > node.level; layer -= 1) {
      const nearest = nearestInLayer(node.vector, current, layer);
      if (nearest) current = nearest.id;
    }
    for (let layer = Math.min(node.level, topLevel); layer >= 0; layer -= 1) {
      const candidates = searchLayer(node.vector, [current], constructionWidth, layer);
      connect(node, candidates, layer);
      if (candidates.length) current = candidates[0].id;
    }
    if (node.level > topLevel) {
      entry = id;
      topLevel = node.level;
    }
    return node;
  }

  function search(query, k = 10, { ef = searchWidth } = {}) {
    if (!entry || !nodes.size) return [];
    const width = Math.max(Math.max(1, Number(k) || 10), Number(ef) || searchWidth);
    let current = entry;
    for (let layer = topLevel; layer > 0; layer -= 1) {
      const nearest = nearestInLayer(query, current, layer);
      if (nearest) current = nearest.id;
    }
    const ranked = searchLayer(query, [current], width, 0);
    return ranked.slice(0, Math.max(1, Number(k) || 10)).map((item) => ({ id: item.id, score: 1 - item.d }));
  }

  function remove(id) {
    const node = nodes.get(id);
    if (!node) return false;
    for (const other of nodes.values()) {
      for (const neighbors of other.neighbors) {
        const index = neighbors.indexOf(id);
        if (index >= 0) neighbors.splice(index, 1);
      }
    }
    nodes.delete(id);
    if (entry === id) {
      const first = nodes.values().next().value;
      entry = first?.id ?? null;
      topLevel = -1;
      for (const other of nodes.values()) topLevel = Math.max(topLevel, other.level);
    }
    return true;
  }

  function rebuild(entries = []) {
    nodes.clear();
    entry = null;
    topLevel = -1;
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
    config: () => ({ M: maxNeighbors, efConstruction: constructionWidth, efSearch: searchWidth, seed }),
  };
}
