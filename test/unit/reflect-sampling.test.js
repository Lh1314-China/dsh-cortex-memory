import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function writeWithImportance(cortex, { text, title, now, importance }) {
  const result = cortex.write({ text, kind: 'utterance', title, explicit: true, now });
  const id = result.trace?.id;
  if (id) cortex.repos.traces.update(id, { importance });
  return result;
}

function setupTraces(cortex, { hot = 30, cold = 30, now } = {}) {
  for (let i = 0; i < hot; i += 1) {
    writeWithImportance(cortex, { text: `alpha${i} bravo${i} charlie hot`, title: `hot alpha${i} bravo${i} charlie`, now, importance: 0.95 });
  }
  for (let i = 0; i < cold; i += 1) {
    writeWithImportance(cortex, { text: `delta${i} echo${i} foxtrot cold`, title: `cold delta${i} echo${i} foxtrot`, now, importance: 0.5 });
  }
}

test('分层：高热话题占不满名额，冷话题拿到接近剩余名额的条数', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reflect-sampling-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    // 少量高热 + 大量冷门：60 条候选择分段预算 15（25%），topSlots=9，剩余 6 个名额
    // 应主要给冷话题（rest 里只剩 1 条热）。
    setupTraces(cortex, { hot: 10, cold: 50, now });
    const result = cortex.engines.reflect.reflect({ scopeId: 'global', now, segment: true, since: new Date(now - 3600000).toISOString(), force: true });
    assert.equal(result.skipped, false);
    const bullets = result.summary.content.split('\n').filter((line) => line.startsWith('· '));
    const cold = bullets.filter((line) => /delta|echo|foxtrot/.test(line));
    const hot = bullets.filter((line) => /alpha|bravo|charlie/.test(line));
    assert.ok(cold.length >= 5, `冷话题应拿到剩余名额的大部分（实际 ${cold.length}）`);
    assert.ok(hot.length >= 9, `高位名额应该被高热话题占满（实际 ${hot.length}）`);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('分层能取到列表尾部：最后四分之一的痕迹也会出现', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reflect-tail-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    setupTraces(cortex, { now });
    const result = cortex.engines.reflect.reflect({ scopeId: 'global', now, segment: true, since: new Date(now - 3600000).toISOString(), force: true });
    const bullets = result.summary.content.split('\n').filter((line) => line.startsWith('· '));
    // 排名最后四分之一的冷痕迹编号 23–29；按中心取样应该能摸到尾部。
    const tail = bullets.filter((line) => /cold delta(2[3-9]) /.test(line));
    assert.ok(tail.length > 0, `尾部痕迹应被取到（实际 ${tail.length} 条，子弹总数 ${bullets.length}）`);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('500 条候选时去重只在头部进行，整体耗时可控', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reflect-perf-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    for (let i = 0; i < 500; i += 1) {
      cortex.write({ text: `word${i} another${i} topic${i % 7}`, kind: 'utterance', title: `trace ${i} word${i}`, explicit: true, now, importance: 0.5 + (i % 5) / 10 });
    }
    const started = Date.now();
    const result = cortex.engines.reflect.reflect({ scopeId: 'global', now, segment: true, since: new Date(now - 3600000).toISOString(), force: true });
    const elapsed = Date.now() - started;
    assert.equal(result.skipped, false);
    assert.ok(result.sources.length <= 24, '名额不应超过分段上限');
    assert.ok(elapsed < 3000, `500 条候选的摘要不应卡住维护（实测 ${elapsed}ms）`);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
