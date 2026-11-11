export function buildAdjacency(edges) {
  const adjacency = new Map();
  const add = (from, to, weight = 1) => {
    if (!from || !to) return;
    const list = adjacency.get(from) ?? [];
    list.push({ to, weight: Number(weight) || 1 });
    adjacency.set(from, list);
  };
  for (const edge of edges) {
    add(edge.fromId ?? edge.from, edge.toId ?? edge.to, edge.weight ?? 1);
    add(edge.toId ?? edge.to, edge.fromId ?? edge.from, (edge.weight ?? 1) * 0.5);
  }
  return adjacency;
}

export function degreeCentrality(edges) {
  const adjacency = buildAdjacency(edges);
  const scores = {};
  for (const [id, list] of adjacency) scores[id] = list.length;
  return scores;
}

export function pageRank(edges, { damping = 0.85, iterations = 30 } = {}) {
  const adjacency = buildAdjacency(edges);
  const nodes = new Set(adjacency.keys());
  for (const list of adjacency.values()) for (const edge of list) nodes.add(edge.to);
  const ids = [...nodes];
  const n = Math.max(1, ids.length);
  let rank = new Map(ids.map((id) => [id, 1 / n]));
  for (let step = 0; step < iterations; step += 1) {
    const next = new Map(ids.map((id) => [id, (1 - damping) / n]));
    for (const id of ids) {
      const out = adjacency.get(id) ?? [];
      if (out.length === 0) {
        for (const target of ids) next.set(target, next.get(target) + damping * rank.get(id) / n);
        continue;
      }
      const total = out.reduce((sum, edge) => sum + edge.weight, 0);
      for (const edge of out) next.set(edge.to, next.get(edge.to) + damping * rank.get(id) * edge.weight / total);
    }
    rank = next;
  }
  return Object.fromEntries([...rank.entries()].sort((a, b) => b[1] - a[1]));
}

export function connectedComponents(edges) {
  const adjacency = buildAdjacency(edges);
  const seen = new Set();
  const components = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component = [];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      component.push(id);
      for (const edge of adjacency.get(id) ?? []) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          stack.push(edge.to);
        }
      }
    }
    components.push(component);
  }
  return components;
}

export function labelPropagation(edges, { iterations = 10 } = {}) {
  const adjacency = buildAdjacency(edges);
  const labels = new Map([...adjacency.keys()].map((id) => [id, id]));
  for (let step = 0; step < iterations; step += 1) {
    let changed = false;
    for (const [id, list] of adjacency) {
      const counts = new Map();
      for (const edge of list) {
        const label = labels.get(edge.to) ?? edge.to;
        counts.set(label, (counts.get(label) ?? 0) + edge.weight);
      }
      let best = labels.get(id);
      let bestWeight = -1;
      for (const [label, weight] of counts) {
        if (weight > bestWeight || (weight === bestWeight && label < best)) {
          best = label;
          bestWeight = weight;
        }
      }
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map();
  for (const [id, label] of labels) {
    const list = groups.get(label) ?? [];
    list.push(id);
    groups.set(label, list);
  }
  return [...groups.values()];
}

export function summarizeGraph(edges, { top = 10 } = {}) {
  const rank = pageRank(edges);
  const components = connectedComponents(edges);
  const communities = labelPropagation(edges);
  return {
    nodes: Object.keys(rank).length,
    edges: edges.length,
    top: Object.entries(rank).slice(0, top).map(([id, score]) => ({ id, score })),
    components: components.length,
    communities: communities.length,
  };
}
