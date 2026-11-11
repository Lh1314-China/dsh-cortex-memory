export function recallAtK(ranked, relevant, k = 10) {
  const rel = new Set(relevant);
  const top = ranked.slice(0, Math.max(1, k));
  return rel.size === 0 ? 0 : top.filter((id) => rel.has(id)).length / rel.size;
}

export function precisionAtK(ranked, relevant, k = 10) {
  const rel = new Set(relevant);
  const top = ranked.slice(0, Math.max(1, k));
  return top.length === 0 ? 0 : top.filter((id) => rel.has(id)).length / top.length;
}

export function reciprocalRank(ranked, relevant, k = 10) {
  const rel = new Set(relevant);
  for (let i = 0; i < Math.min(ranked.length, k); i += 1) {
    if (rel.has(ranked[i])) return 1 / (i + 1);
  }
  return 0;
}

export function ndcgAtK(ranked, relevant, k = 10) {
  const rel = new Set(relevant);
  if (rel.size === 0) return 0;
  let dcg = 0;
  for (let i = 0; i < Math.min(ranked.length, k); i += 1) {
    if (rel.has(ranked[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(rel.size, k); i += 1) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

export function percentile(values, p) {
  const list = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (list.length === 0) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1));
  return list[index];
}

export function evaluateQueries(results, { k = 10 } = {}) {
  const rows = results.map((result) => {
    const ranked = (result.items ?? []).map((item) => item.id);
    const relevant = result.relevant ?? [];
    return {
      recall: recallAtK(ranked, relevant, k),
      precision: precisionAtK(ranked, relevant, k),
      mrr: reciprocalRank(ranked, relevant, k),
      ndcg: ndcgAtK(ranked, relevant, k),
    };
  });
  const mean = (key) => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
  return {
    n: rows.length,
    recallAtK: mean('recall'),
    precisionAtK: mean('precision'),
    mrrAtK: mean('mrr'),
    ndcgAtK: mean('ndcg'),
  };
}
