import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../src/service/cortex.js';
import { createOpenAIEmbedder } from '../src/vector/providers.js';
import { generateSynthetic } from './synthetic.js';
import { evaluateQueries, percentile } from './metrics.js';

const count = Number(process.argv[2] ?? 300);
const queryCount = Number(process.argv[3] ?? 50);
const useVector = process.argv[4] !== 'fts';
const dir = mkdtempSync(path.join(os.tmpdir(), `cortex-vector-ab-${useVector ? 'bge' : 'fts'}-`));
const embedder = createOpenAIEmbedder({
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'bge-m3',
  dim: 1024,
  timeoutMs: 30000,
});
const cortex = createCortex({
  config: {
    dataRoot: dir,
    dbFile: path.join(dir, 'cortex.sqlite'),
    contextBudget: 2200,
    vectorEnabled: useVector,
    features: useVector ? { vector: true } : {},
    ...(useVector ? { embedder } : {}),
  },
});
try {
  const dataset = generateSynthetic({ count, queries: queryCount, seed: 42, task: 'paraphrase' });
  const written = cortex.writeMany(dataset.traces.map((trace) => ({
    text: trace.text,
    title: trace.title,
    tags: trace.tags,
    importance: trace.importance,
    explicit: true,
    operationId: `vector-ab:${trace.id}`,
    now: Date.parse(trace.recordedAt),
  })), { chunkSize: 250 });
  const idMap = new Map();
  for (let i = 0; i < written.length; i += 1) {
    if (written[i].trace) idMap.set(dataset.traces[i].id, written[i].trace.id);
  }
  if (useVector) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rebuilt = await cortex.vector.rebuildAsync({ limit: count });
    console.error(`vector rebuild: ${JSON.stringify(rebuilt)}`);
  }
  const results = [];
  const latencies = [];
  for (const query of dataset.queries) {
    const start = performance.now();
    const result = useVector
      ? await cortex.searchAsync(query.query, { limit: 10, budget: 2200 })
      : cortex.search(query.query, { limit: 10, budget: 2200 });
    latencies.push(performance.now() - start);
    results.push({
      items: result.items,
      relevant: query.relevant.map((id) => idMap.get(id)).filter(Boolean),
    });
  }
  const metrics = evaluateQueries(results, { k: 10 });
  console.log(JSON.stringify({
    task: 'paraphrase',
    vector: useVector,
    count,
    queries: dataset.queries.length,
    p50Ms: Math.round((percentile(latencies, 50) ?? 0) * 100) / 100,
    p95Ms: Math.round((percentile(latencies, 95) ?? 0) * 100) / 100,
    vectorStatus: cortex.vector?.status?.() ?? null,
    ...metrics,
  }, null, 2));
} finally {
  cortex.close();
  rmSync(dir, { recursive: true, force: true });
}
