import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-auto-reflect-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

function fill(cortex, count, now, prefix = '日常') {
  for (let i = 0; i < count; i += 1) {
    cortex.write({ text: `用户：${prefix}第 ${i} 条，记录一下天气和心情。`, kind: 'utterance', title: `${prefix} ${i}`, explicit: true, now });
  }
}

test('材料够时自动写一条 episode，同一窗口内不再写第二条', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    fill(cortex, 60, now);
    const first = cortex.maintain({ now });
    assert.equal(first.reflection?.created, true, '材料够时应该生成摘要');
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length, 1);

    const second = cortex.maintain({ now: now + 60_000 });
    assert.equal(second.reflection?.skipped, 'covered', '同一 24h 窗口只写一条');
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('材料不足以下界时不写，并报出下界', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    fill(cortex, 40, now, '稀疏');
    const report = cortex.maintain({ now });
    assert.equal(report.reflection?.skipped, 'few-traces');
    assert.equal(report.reflection?.minMaterial, 50);
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('真实形态：痕迹铺满 24 小时时，7 小时后仍判为已覆盖', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    // 铺满整整一天：periodStart 会落在 now-24h 附近，这正是线上真实数据的形状。
    for (let i = 0; i < 60; i += 1) {
      cortex.write({ text: `用户：铺满窗口的第 ${i} 条记录，间隔二十四分钟。`, kind: 'utterance', title: `铺满 ${i}`, explicit: true, now: now - i * 24 * 60_000 });
    }
    assert.equal(cortex.maintain({ now }).reflection?.created, true);
    const later = cortex.maintain({ now: now + 7 * 3_600_000 });
    assert.equal(later.reflection?.skipped, 'covered', '铺满窗口时也必须按写入时间去重');
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('跨过 24 小时之后可以再写一条', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    fill(cortex, 60, now, '跨天');
    assert.equal(cortex.maintain({ now }).reflection?.created, true);
    fill(cortex, 60, now + 25 * 3_600_000, '第二天');
    const nextDay = cortex.maintain({ now: now + 25 * 3_600_000 });
    assert.equal(nextDay.reflection?.created, true, '第二天应该允许再写一条');
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length, 2);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('窗口已覆盖但新增材料 ≥150 且距上次 ≥6h，可以再写一段不重叠的', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    fill(cortex, 60, now, '第一段');
    assert.equal(cortex.maintain({ now }).reflection?.created, true);
    const first = cortex.repos.summaries.list('global', { level: 'episode', limit: 5 })[0];

    const later = now + 7 * 3_600_000;
    fill(cortex, 160, later, '第二段');
    const report = cortex.maintain({ now: later });
    assert.equal(report.reflection?.created, true, '材料够就该写第二段');
    const episodes = cortex.repos.summaries.list('global', { level: 'episode', limit: 5 });
    assert.equal(episodes.length, 2);
    const second = episodes[0];
    assert.ok(Date.parse(second.periodStart) > Date.parse(first.periodEnd), '第二段必须接在第一段结束之后，不重叠');
    assert.equal(second.model, 'extractive-v2-segment', '分段摘要要打上标记');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('新增材料不够 150 时仍是 covered，不写第二段', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    fill(cortex, 60, now, '第一段');
    assert.equal(cortex.maintain({ now }).reflection?.created, true);
    const later = now + 7 * 3_600_000;
    fill(cortex, 60, later, '第二段');
    const report = cortex.maintain({ now: later });
    assert.equal(report.reflection?.skipped, 'covered');
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('材料极少时一条都不写', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      cortex.write({ text: `用户：只有第 ${i} 条。`, kind: 'utterance', title: `少量 ${i}`, explicit: true, now });
    }
    const report = cortex.maintain({ now });
    assert.equal(report.reflection?.skipped, 'few-traces');
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
