#!/usr/bin/env node
/**
 * 记忆治理自测（governance bench）
 *
 * 协议对齐 KrabArena 的 write-to-recall / overwrite 测法，只测「库的行为」，不测 LLM 作答。
 * 产出三个数字：
 *   1. 写后可召回 p50 / p95  —— 写完到这条事实能被召回要多久
 *   2. 旧值退役              —— 覆盖后当前事实还是不是旧值
 *   3. 干净召回 @1           —— 没被覆盖的事实 top1 对不对
 *
 * 安全边界（写死）：
 *   - 在系统临时目录里建一个全新库，绝不打开真实记忆库
 *   - dbFile 不在临时目录 -> 直接 exit 2 拒跑
 *   - 数据全部是合成事实，不含任何真实记忆
 *
 * 用法：
 *   node bench/governance.mjs --passes 2 --topk 5
 *   node bench/governance.mjs --out results/governance-20261119
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCortex } from '../src/service/cortex.js';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PASSES = Math.max(1, Number(arg('passes', 2)));
const TOPK = Math.max(1, Number(arg('topk', 5)));
const CAP_MS = Math.max(1000, Number(arg('cap', 60000)));
const OUT = arg('out', '');

// ---- 红线：只在临时目录建库 ----
const tmpRoot = path.resolve(os.tmpdir());
const dir = mkdtempSync(path.join(tmpRoot, 'cortex-governance-'));
const dbFile = path.join(dir, 'cortex.sqlite');
if (!path.resolve(dbFile).startsWith(tmpRoot + path.sep)) {
  console.error(`拒绝执行：dbFile 不在临时目录（${dbFile}）`);
  process.exit(2);
}

// ---- 合成数据：10 人 × 3 字段 = 30 条；前 10 条（job）做覆盖 ----
const SUBJECTS = ['林舟', '周野', '阿柚', '陈默', '小满', '顾辰', '苏禾', '程一', '夜白', '何夕'];
const FIELDS = [
  { predicate: 'job', question: '现在做什么工作', values: ['大二学生', '在读研究生', '自由插画师', '产品实习生', '咖啡店主'] },
  { predicate: 'city', question: '现在住在哪个城市', values: ['杭州', '成都', '广州', '南京', '西安'] },
  { predicate: 'pet', question: '养了什么宠物', values: ['两只英短', '一只柯基', '没有宠物', '三只仓鼠', '一只布偶'] },
];

const FACTS = [];
for (let i = 0; i < 30; i++) {
  const subject = SUBJECTS[i % SUBJECTS.length];
  const field = FIELDS[i % FIELDS.length];
  const value = field.values[Math.floor(i / 10) % field.values.length];
  FACTS.push({
    id: `f${String(i + 1).padStart(2, '0')}`,
    subject,
    predicate: field.predicate,
    question: field.question,
    probe: `${subject}${field.question}`,
    value,
    text: `${subject}${field.question}：${value}`,
  });
}

// 覆盖：只动前 10 条（10 个人的 job），每轮轮换到下一个值
const OVERWRITE_IDS = new Set(FACTS.slice(0, 10).map((f) => f.id));
const valueAt = (fact, offset) => {
  const field = FIELDS.find((f) => f.predicate === fact.predicate);
  const base = field.values.indexOf(fact.value);
  return field.values[(base + offset) % field.values.length];
};

// ---- 工具 ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const p95 = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)] : null;
};
const round3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

function itemText(item) {
  return [item.content, item.snippet, item.title, item.text].filter(Boolean).join(' ');
}
function hitValue(items, value) {
  return items.some((item) => itemText(item).includes(value));
}
// 旧值残留只认「同一个人、同一个问题」下的旧答案：同字段的值会在不同人之间
// 重复，纯文本匹配会把别人的记录误算成残留。
function hitRetired(items, fact, oldValue) {
  const prefix = `${fact.subject}${fact.question}：`;
  return items.some((item) => {
    const text = itemText(item);
    return text.includes(prefix) && text.includes(oldValue);
  });
}
function topValue(items) {
  return items.length ? itemText(items[0]) : '';
}

function currentFact(cortex, subject, predicate) {
  // asOf 返回 { subject, mode, facts: [...] }，facts 里当前值字段叫 object
  const result = cortex.asOf({ subject, predicate, mode: 'strict', scopeId: 'global' });
  const rows = result?.facts ?? [];
  return rows.length ? (rows[0].object ?? null) : null;
}

function search(cortex, query) {
  return cortex.search(query, { limit: TOPK, scopeId: 'global' })?.items ?? [];
}

function writeFact(cortex, { subject, predicate, objectLiteral, text, operationId }) {
  return cortex.write({
    text,
    kind: 'observation',
    explicit: true,
    importance: 0.7,
    scopeId: 'global',
    facts: [{ subject, predicate, objectLiteral, confidence: 0.9 }],
    operationId,
  });
}

async function runPass(cortex, passNo) {
  // 阶段 1：写后到可召回
  const lags = [];
  const misses = [];
  for (const fact of FACTS) {
    const t0 = performance.now();
    writeFact(cortex, {
      subject: fact.subject,
      predicate: fact.predicate,
      objectLiteral: valueAt(fact, passNo - 1),
      text: `${fact.subject}${fact.question}：${valueAt(fact, passNo - 1)}`,
      operationId: `gov:p${passNo}:${fact.id}`,
    });
    let landed = false;
    while (performance.now() - t0 < CAP_MS) {
      if (hitValue(search(cortex, fact.probe), valueAt(fact, passNo - 1))) { landed = true; break; }
      await sleep(20);
    }
    lags.push(landed ? performance.now() - t0 : CAP_MS);
    if (!landed) misses.push(fact.id);
  }

  // 阶段 2：干净召回（没被覆盖的 20 条）
  let cleanOk = 0;
  for (const fact of FACTS.filter((f) => !OVERWRITE_IDS.has(f.id))) {
    const items = search(cortex, fact.probe);
    if (topValue(items).includes(valueAt(fact, passNo - 1))) cleanOk += 1;
  }

  // 阶段 3：覆盖 —— 同 subject+predicate 写新值，看旧值退不退役
  let retired = 0;
  let staleFact = 0;
  let staleHits = 0;
  const oldValues = [];
  for (const fact of FACTS.filter((f) => OVERWRITE_IDS.has(f.id))) {
    const oldValue = valueAt(fact, passNo - 1);
    const newValue = valueAt(fact, passNo);
    oldValues.push(oldValue);
    writeFact(cortex, {
      subject: fact.subject,
      predicate: fact.predicate,
      objectLiteral: newValue,
      text: `${fact.subject}${fact.question}：${newValue}`,
      operationId: `gov:ov:p${passNo}:${fact.id}`,
    });
    const now = currentFact(cortex, fact.subject, fact.predicate);
    if (now === newValue) retired += 1;
    if (now === oldValue) staleFact += 1;
    if (hitRetired(search(cortex, fact.probe), fact, oldValue)) staleHits += 1;
  }

  const size = (() => {
    try { return statSync(dbFile).size; } catch { return null; }
  })();

  return {
    pass: passNo,
    lagP50s: round3(median(lags) / 1000),
    lagP95s: round3(p95(lags) / 1000),
    timeouts: misses.length,
    timeoutIds: misses,
    cleanRecallAt1: round3(cleanOk / 20),
    factRetired: `${retired}/10`,
    factStale: `${staleFact}/10`,
    staleHits: `${staleHits}/10`,
    storeBytes: size,
    traceCount: cortex.repos.traces.count(),
    factActive: cortex.repos.facts.list({ scopeId: 'global', status: 'active', limit: 1000 }).length,
  };
}

// ---- 主流程 ----
const cortex = createCortex({ config: { dataRoot: dir, dbFile } });
const rows = [];
try {
  console.log(`governance bench | facts=${FACTS.length} overwrites=10 passes=${PASSES} topk=${TOPK} cap=${CAP_MS / 1000}s`);
  for (let p = 1; p <= PASSES; p++) {
    const r = await runPass(cortex, p);
    rows.push(r);
    console.log(`  pass${p}: p50=${r.lagP50s}s p95=${r.lagP95s}s clean@1=${r.cleanRecallAt1} retired=${r.factRetired} stale=${r.factStale} staleHits=${r.staleHits} rows=${r.factActive} active`);
  }
} finally {
  cortex.close();
  rmSync(dir, { recursive: true, force: true });
}

const agg = (k) => {
  const xs = rows.map((r) => r[k]).filter((x) => typeof x === 'number');
  return xs.length ? round3(median(xs)) : null;
};
const fmt = (x) => (x === null || x === undefined ? 'n/a' : String(x));

const report = {
  bench: 'governance',
  engine: 'dsh-cortex',
  generatedAt: new Date().toISOString(),
  protocol: { facts: FACTS.length, overwrites: 10, passes: PASSES, topk: TOPK, capMs: CAP_MS },
  passes: rows,
  median: {
    lagP50s: agg('lagP50s'),
    lagP95s: agg('lagP95s'),
    cleanRecallAt1: agg('cleanRecallAt1'),
    storeBytes: agg('storeBytes'),
  },
  note: '只测库的治理行为（写入可见、覆盖退役、干净召回），不含 LLM 作答，不构成 LoCoMo / LongMemEval 分数。',
};

const md = [
  `### governance bench — ${new Date().toISOString().slice(0, 10)}`,
  '',
  '| 指标 | 定义 | 结果 |',
  '| --- | --- | --- |',
  `| 写后可召回 p50 | 写入完成 → 该事实能被召回 | ${fmt(report.median.lagP50s)} s |`,
  `| 写后可召回 p95 | 同上，p95 | ${fmt(report.median.lagP95s)} s |`,
  `| 超时未召回 | 超过 ${CAP_MS / 1000}s 仍召不回的条数 | ${rows.reduce((a, r) => a + r.timeouts, 0)} / ${FACTS.length * PASSES} |`,
  `| 干净召回 @1 | 未被覆盖的 20 条，top1 正确 | ${fmt(report.median.cleanRecallAt1)} |`,
  `| 旧值退役 | 覆盖后当前事实 = 新值 | ${rows.map((r) => r.factRetired).join(' / ')} |`,
  `| 旧值仍为当前 | 覆盖后当前事实 = 旧值 | ${rows.map((r) => r.factStale).join(' / ')} |`,
  `| 旧值仍在检索 top-${TOPK} | 覆盖后旧值文本仍可检索到 | ${rows.map((r) => r.staleHits).join(' / ')} |`,
  `| 活跃事实数 | active facts | ${rows.map((r) => r.factActive).join(' / ')} |`,
  `| 库大小 | bytes | ${rows.map((r) => (r.storeBytes === null ? 'n/a' : r.storeBytes)).join(' / ')} |`,
  '',
  '> 只测库的行为，不含 LLM 作答，不构成 LoCoMo / LongMemEval 分数。',
].join('\n');

console.log('\n' + md);
if (OUT) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(`${OUT}.md`, md + '\n', 'utf8');
  console.log(`\nwritten: ${OUT}.json / ${OUT}.md`);
}
