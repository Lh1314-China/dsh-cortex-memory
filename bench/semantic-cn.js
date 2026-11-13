#!/usr/bin/env node
/**
 * Reproducible synthetic Chinese semantic retrieval probe.
 *
 * This is not LoCoMo/LongMemEval and must not be reported as an official
 * benchmark score. It checks whether the current hybrid retrieval can find a
 * known target among controlled distractors before/after the injection gate.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCortex } from '../src/service/cortex.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-semantic-cn-'));
const cortex = createCortex({
  config: {
    dataRoot: dir,
    dbFile: path.join(dir, 'cortex.sqlite'),
    features: { autoFacts: false, llmFacts: false, autoGraphCandidates: false },
  },
});

const data = [
  ['便宜订阅', '涵儿喜欢便宜的音乐订阅，不买贵的套餐。'],
  ['白饭承诺', '涵儿答应下班带白饭，汐儿记得这个承诺。'],
  ['颈椎', '久坐后颈椎会疼，汐儿提醒涵儿起身。'],
  ['猫粮', '家里的猫只吃鸡肉味猫粮。'],
  ['雨天', '下雨天要带伞，涵儿常忘记。'],
  ['周末', '周末计划去河边散步。'],
  ['白饭', '白饭要热的，不要隔夜。'],
  ['订阅', '订阅续费前先看价格。'],
  ['颈椎', '颈椎疼时不要继续低头。'],
  ['猫', '猫晚上会在门口等。'],
  ['伞', '伞放在玄关的右边。'],
  ['散步', '散步时不看手机。'],
];
const written = new Map();
for (const [title, text] of data) {
  const row = cortex.write({ text, title, kind: 'observation', explicit: true, importance: 0.72 });
  written.set(title, row.trace.id);
}
const queries = [
  ['白饭', '白饭承诺'],
  ['便宜 订阅', '便宜订阅'],
  ['颈椎 疼', '颈椎'],
  ['猫 吃 什么', '猫粮'],
  ['下雨 带伞', '雨天'],
  ['周末 散步', '周末'],
  ['白饭 热', '白饭'],
  ['订阅 价格', '订阅'],
  ['低头 颈椎', '颈椎'],
  ['猫 晚上', '猫'],
  ['玄关 伞', '伞'],
  ['散步 手机', '散步'],
];

function metrics(rows) {
  let hits = 0;
  let mrr = 0;
  let ndcg = 0;
  for (const row of rows) {
    const index = row.ids.indexOf(row.expected);
    if (index >= 0) {
      hits += 1;
      mrr += 1 / (index + 1);
      ndcg += 1 / Math.log2(index + 2);
    }
  }
  const n = rows.length;
  return {
    n,
    recallAt3: hits / n,
    mrrAt3: mrr / n,
    ndcgAt3: ndcg / n,
  };
}

function run(mode) {
  const rows = [];
  const latencies = [];
  for (const [query, expectedTitle] of queries) {
    const started = performance.now();
    const result = mode === 'inject'
      ? cortex.recallTiered({ query, limit: 3 }).result
      : cortex.search(query, { limit: 3 });
    latencies.push(performance.now() - started);
    rows.push({ query, expected: written.get(expectedTitle), ids: result.items.map((item) => item.id) });
  }
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? null;
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null;
  return { ...metrics(rows), p50Ms: Math.round(p50 * 100) / 100, p95Ms: Math.round(p95 * 100) / 100 };
}

try {
  const full = run('full');
  const injected = run('inject');
  const result = {
    name: 'semantic-cn',
    kind: 'synthetic-controlled',
    note: 'Not an official LoCoMo/LongMemEval score. Controlled Chinese memories and queries; no real user data.',
    at: new Date().toISOString(),
    memories: data.length,
    queries: queries.length,
    full,
    inject: injected,
  };
  const out = path.join(import.meta.dirname, 'results');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'semantic-cn.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  cortex.close();
  rmSync(dir, { recursive: true, force: true });
}
