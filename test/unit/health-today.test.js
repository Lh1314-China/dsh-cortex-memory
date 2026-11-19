import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('health 的今日整理统计当天归档/合并数', async () => {
  let traceIds = [];
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-health-today-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      complete: async () => JSON.stringify([{ action: 'merge', ids: traceIds, targetId: traceIds[0] }]),
    },
  });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：重复的碎片甲，内容一样。', kind: 'utterance', title: '重复甲', importance: 0.6, explicit: true, now });
    cortex.write({ text: '用户：重复的碎片乙，内容一样。', kind: 'utterance', title: '重复乙', importance: 0.6, explicit: true, now: now + 1000 });
    traceIds = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).map((trace) => trace.id);
    const run = await cortex.consolidation.run({ scopeId: 'global' });
    assert.equal(run.applied.length, 1);
    const health = cortex.health({ scopeId: 'global' });
    assert.equal(health.consolidation.today.runs, 1);
    assert.equal(health.consolidation.today.merged, 1);
    assert.equal(health.consolidation.today.archived, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('没有整理改动时今日整理显示为零', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-health-today-zero-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const health = cortex.health({ scopeId: 'global' });
    assert.deepEqual(health.consolidation.today, { runs: 0, archived: 0, merged: 0 });
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
