import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-backfill-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { cortex, dir };
}

let counter = 0;
function seed(cortex, count) {
  const base = Date.parse('2026-11-10T00:00:00.000Z');
  for (let i = 0; i < count; i += 1) {
    const at = base + i * 60_000;
    counter += 1;
    cortex.write({
      text: `用户：样本号 ${i}，token-${counter}-${(i * 7919) % 1000}，主题与号细节。`,
      kind: 'utterance',
      title: `样本 ${i}`,
      importance: 0.7,
      explicit: true,
      now: at,
    });
  }
}

test('窗口补齐：预演只出计划，不写摘要', async () => {
  const { cortex, dir } = setup();
  try {
    seed(cortex, 100);
    const before = cortex.repos.summaries.list('global', { limit: 50 }).length;
    const report = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 2, dryRun: true });
    const after = cortex.repos.summaries.list('global', { limit: 50 }).length;
    assert.equal(report.windowSize, 40);
    assert.ok(report.planned >= 2, `应计划至少 2 段，实际 ${report.planned}`);
    assert.equal(report.results.length, 0);
    assert.equal(before, after, '预演不能写库');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('窗口补齐：真跑按窗口写 episode，且每段不超过预算', async () => {
  const { cortex, dir } = setup();
  try {
    seed(cortex, 120);
    const report = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 2, dryRun: false });
    assert.equal(report.dryRun, false);
    const made = report.results.filter((row) => row.summaryId);
    assert.ok(made.length >= 1, '至少应写出一条 episode');
    // 0.4.129 起每窗口取 80%（40 条窗口 → 32），不再是 24。
    for (const row of made) assert.ok(row.sources <= 32, `sourceIds 预算超了：${row.sources}`);
    const summaries = cortex.repos.summaries.list('global', { limit: 50 });
    assert.ok(summaries.length >= 1);
    const periods = summaries.map((item) => `${item.periodStart}|${item.periodEnd}`);
    assert.equal(new Set(periods).size, periods.length, '同一时间窗不能重复写');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('窗口数被夹住：windowSize 小于 32 时按 32 跑', async () => {
  const { cortex, dir } = setup();
  try {
    seed(cortex, 40);
    const report = await cortex.reflectBackfill({ windowSize: 5, maxWindows: 1, dryRun: true });
    assert.equal(report.windowSize, 32);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('同一窗口重跑不会写第二条（幂等）', async () => {
  const { cortex, dir } = setup();
  try {
    seed(cortex, 100);
    const first = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 2, dryRun: false });
    const countAfterFirst = cortex.repos.summaries.list('global', { limit: 50 }).length;
    assert.ok(first.results.some((row) => row.summaryId), '首跑应写摘要');
    const second = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 2, dryRun: false });
    const countAfterSecond = cortex.repos.summaries.list('global', { limit: 50 }).length;
    assert.equal(countAfterSecond, countAfterFirst, '重跑不应新增摘要');
    assert.ok(second.results.every((row) => row.skipped === 'already-reflected'), '重跑都应跳过');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('边界同一毫秒的多条痕迹不会被切掉', async () => {
  const { cortex, dir } = setup();
  try {
    const base = Date.parse('2026-11-10T00:00:00.000Z');
    for (let i = 0; i < 40; i += 1) {
      cortex.write({ text: `用户：窗口内样本 ${i}。`, kind: 'utterance', title: `样本 ${i}`, importance: 0.7, explicit: true, now: base + i * 60_000 });
    }
    const edge = base + 39 * 60_000;
    for (let i = 0; i < 3; i += 1) {
      cortex.write({ text: `用户：同毫秒样本 ${i}。`, kind: 'utterance', title: `同刻 ${i}`, importance: 0.7, explicit: true, now: edge });
    }
    const report = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 1, dryRun: true });
    const planned = report.plan.find((row) => row.count);
    assert.equal(planned.count, 43, '同毫秒的 3 条必须并进同一窗口');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('换 windowSize 重跑不会铺重叠摘要（区间重叠视为已覆盖）', async () => {
  const { cortex, dir } = setup();
  try {
    seed(cortex, 120);
    const first = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 3, dryRun: false });
    assert.ok(first.results.some((row) => row.summaryId), '首跑应写摘要');
    const before = cortex.repos.summaries.list('global', { limit: 50 }).length;
    const second = await cortex.reflectBackfill({ windowSize: 32, maxWindows: 3, dryRun: false });
    const after = cortex.repos.summaries.list('global', { limit: 50 }).length;
    const skipped = second.results.filter((row) => row.skipped === 'already-reflected').length;
    const added = second.results.filter((row) => row.summaryId && row.skipped !== 'already-reflected').length;
    // The first windows overlap what was already written and must be skipped; at most
    // the tail beyond the old coverage is a genuinely new stretch.
    assert.ok(skipped >= 1, `至少第一段应因痕迹重叠跳过，实际跳过 ${skipped}`);
    assert.ok(added <= 2, `最多只该补写尾部缺口，实际新增 ${added}`);
    assert.ok(after <= before + 2, '不该铺出第二套完整重叠摘要');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('since 续跑：第二批从上一批 until 开始，不重复写第一段', async () => {
  const { cortex, dir } = setup();
  try {
    seed(cortex, 120);
    const first = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 1, dryRun: false });
    assert.ok(first.results[0]?.summaryId, '第一批应写一条');
    const until = first.plan[0].until;
    const second = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 1, dryRun: false, since: until });
    assert.ok(second.results[0]?.summaryId, '续跑应写第二段');
    assert.notEqual(second.results[0].summaryId, first.results[0].summaryId);
    const before = cortex.repos.summaries.list('global', { limit: 50 }).length;
    const again = await cortex.reflectBackfill({ windowSize: 40, maxWindows: 1, dryRun: false, since: until });
    const after = cortex.repos.summaries.list('global', { limit: 50 }).length;
    assert.equal(after, before, '同一 since 重跑不应新增');
    assert.equal(again.results[0].skipped, 'already-reflected');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
