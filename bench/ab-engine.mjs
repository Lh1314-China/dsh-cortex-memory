import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateSynthetic } from './synthetic.js';
import { evaluateQueries, percentile } from './metrics.js';

const engineRoot = process.argv[2];
const task = process.argv[3] ?? 'paraphrase';
const count = Number(process.argv[4] ?? 5000);
const queryCount = Number(process.argv[5] ?? 100);

if (!engineRoot) {
  console.error('usage: node bench/ab-engine.mjs <engine-root> [needle|theme|paraphrase] [count] [queries]');
  process.exit(2);
}

const { createCortex } = await import(pathToFileURL(path.join(engineRoot, 'src', 'service', 'cortex.js')).href);
const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-ab-'));
const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), contextBudget: 2200 } });
try {
  const dataset = generateSynthetic({ count, queries: queryCount, seed: 42, task });
  const written = cortex.writeMany(dataset.traces.map((trace) => ({
    text: trace.text,
    title: trace.title,
    tags: trace.tags,
    importance: trace.importance,
    explicit: true,
    operationId: `ab:${trace.id}`,
    now: Date.parse(trace.recordedAt),
  })), { chunkSize: 250 });
  const idMap = new Map();
  for (let i = 0; i < written.length; i += 1) {
    if (written[i].trace) idMap.set(dataset.traces[i].id, written[i].trace.id);
  }
  const results = [];
  const latencies = [];
  for (const query of dataset.queries) {
    const start = performance.now();
    const result = cortex.search(query.query, { limit: 10, budget: 2200 });
    latencies.push(performance.now() - start);
    results.push({
      items: result.items,
      relevant: query.relevant.map((id) => idMap.get(id)).filter(Boolean),
    });
  }
  const metrics = evaluateQueries(results, { k: 10 });
  console.log(JSON.stringify({
    engine: engineRoot,
    task,
    count,
    queries: dataset.queries.length,
    p50Ms: Math.round((percentile(latencies, 50) ?? 0) * 100) / 100,
    p95Ms: Math.round((percentile(latencies, 95) ?? 0) * 100) / 100,
    ...metrics,
  }, null, 2));
} finally {
  cortex.close();
  rmSync(dir, { recursive: true, force: true });
}
