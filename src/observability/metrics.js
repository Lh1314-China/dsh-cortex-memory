/**
 * Tiny in-process metrics. No external service, no labels with user text;
 * only counters and latency buckets so the guardian/UI can see what happened.
 */
export function createMetrics() {
  const counters = new Map();
  const histograms = new Map();

  function inc(name, value = 1) {
    counters.set(name, (counters.get(name) ?? 0) + Number(value));
  }

  function observe(name, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const bucket = histograms.get(name) ?? [];
    bucket.push(number);
    if (bucket.length > 2000) bucket.shift();
    histograms.set(name, bucket);
  }

  function summary(values) {
    if (!values?.length) return { count: 0, p50: null, p95: null, max: null };
    const sorted = values.slice().sort((a, b) => a - b);
    const pick = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
    return { count: sorted.length, p50: pick(50), p95: pick(95), max: sorted[sorted.length - 1] };
  }

  function snapshot() {
    const hist = {};
    for (const [name, values] of histograms) hist[name] = summary(values);
    return {
      at: new Date().toISOString(),
      counters: Object.fromEntries(counters),
      histograms: hist,
    };
  }

  function reset() {
    counters.clear();
    histograms.clear();
  }

  return { inc, observe, snapshot, reset };
}
