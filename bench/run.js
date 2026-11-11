import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../src/service/cortex.js';
import { generateSynthetic } from './synthetic.js';
import { evaluateQueries, percentile } from './metrics.js';

export function runBenchmark({
  count = Number(process.env.CORTEX_BENCH_COUNT ?? 10000),
  queries = Number(process.env.CORTEX_BENCH_QUERIES ?? 100),
  seed = 42,
  vector = process.env.CORTEX_BENCH_VECTOR === '1',
  limit = 10,
  task = 'needle',
} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-bench-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), vectorEnabled: vector, contextBudget: 2200 } });
  try {
    const dataset = generateSynthetic({ count, queries, seed, task });
    const idMap = new Map();
    const writeStart = performance.now();
    const inputs = dataset.traces.map((trace) => ({
      text: trace.text,
      title: trace.title,
      tags: trace.tags,
      importance: trace.importance,
      explicit: true,
      operationId: `bench:${trace.id}`,
      now: Date.parse(trace.recordedAt),
    }));
    const written = cortex.writeMany(inputs, { chunkSize: 250 });
    for (let i = 0; i < written.length; i += 1) {
      if (written[i].trace) idMap.set(dataset.traces[i].id, written[i].trace.id);
    }
    const writeMs = performance.now() - writeStart;
    const results = [];
    const searchLatencies = [];
    for (const query of dataset.queries) {
      const start = performance.now();
      const result = cortex.search(query.query, { limit, budget: 2200 });
      searchLatencies.push(performance.now() - start);
      results.push({ items: result.items, relevant: query.relevant.map((id) => idMap.get(id)).filter(Boolean) });
    }
    const metrics = evaluateQueries(results, { k: limit });
    return {
      generatedAt: dataset.generatedAt,
      seed,
      count,
      task: dataset.task,
      queries: dataset.queries.length,
      vector,
      writeMs: Math.round(writeMs),
      writesPerSecond: Math.round((count / writeMs) * 1000),
      search: {
        p50Ms: Math.round((percentile(searchLatencies, 50) ?? 0) * 100) / 100,
        p95Ms: Math.round((percentile(searchLatencies, 95) ?? 0) * 100) / 100,
        ...metrics,
      },
      dbBytes: (() => {
        try { return cortex.db.prepare('PRAGMA page_count').get().page_count * cortex.db.prepare('PRAGMA page_size').get().page_size; } catch { return null; }
      })(),
    };
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const count = Number(args.find((arg) => arg.startsWith('--count='))?.split('=')[1] ?? 10000);
  const queries = Number(args.find((arg) => arg.startsWith('--queries='))?.split('=')[1] ?? 100);
  const task = args.find((arg) => arg.startsWith('--task='))?.split('=')[1] ?? 'needle';
  const result = runBenchmark({ count, queries, task, vector: args.includes('--vector') });
  console.log(JSON.stringify(result, null, 2));
}
