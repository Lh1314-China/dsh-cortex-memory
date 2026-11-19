import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../src/host/scheduler.js';

function fakeCortex({ features = {}, lastRunAt = null, fresh = 0 }) {
  const runs = [];
  return {
    runs,
    config: { scope: 'global', features, deepConsolidateOnSchedule: false },
    repos: { traces: { listSince: (scopeId, since, options) => Array.from({ length: fresh }, (_, i) => ({ id: `t${i}`, scopeId, since, limit: options?.limit })) } },
    consolidation: {
      list: () => (lastRunAt ? [{ at: new Date(lastRunAt).toISOString() }] : []),
      run: async () => {
        runs.push(1);
        return { run: { status: 'applied', model: 'llm-bounded', error: null }, decisions: [{ action: 'keep' }], applied: [] };
      },
    },
  };
}

const NOW = Date.parse('2026-11-16T12:00:00.000Z');

test('新增痕迹够多且间隔够久时，自动巩固一次', async () => {
  const cortex = fakeCortex({
    features: { consolidateOnTraceDelta: true, consolidateTraceDelta: 20, consolidateTraceGapMinutes: 30 },
    lastRunAt: NOW - 40 * 60_000,
    fresh: 25,
  });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 1, '应自动跑一次巩固');
  assert.equal(report.steps.autoConsolidate.fresh, 25);
  assert.equal(report.steps.autoConsolidate.status, 'applied');
  assert.equal(report.steps.autoConsolidate.applied, 0);
});

test('新增痕迹不够时不自动巩固，并说明原因', async () => {
  const cortex = fakeCortex({
    features: { consolidateOnTraceDelta: true, consolidateTraceDelta: 20 },
    lastRunAt: NOW - 40 * 60_000,
    fresh: 5,
  });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0);
  assert.equal(report.steps.autoConsolidate.skipped, 'not-enough-new-traces');
  assert.equal(report.steps.autoConsolidate.fresh, 5);
});

test('距上次巩固太近时不跑，避免每 tick 都调一次', async () => {
  const cortex = fakeCortex({
    features: { consolidateOnTraceDelta: true, consolidateTraceDelta: 20, consolidateTraceGapMinutes: 30 },
    lastRunAt: NOW - 5 * 60_000,
    fresh: 99,
  });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0);
  assert.equal(report.steps.autoConsolidate.skipped, 'too-soon');
});

test('开关没开时完全不动', async () => {
  const cortex = fakeCortex({ features: {}, lastRunAt: NOW - 40 * 60_000, fresh: 99 });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0);
  assert.equal(report.steps.autoConsolidate, undefined);
});

test('tick 每分钟写记录时，自动巩固仍按「上一次非 tick」的间隔判断', async () => {
  const iso = new Date(NOW - 10 * 60_000).toISOString();
  const cortex = fakeCortex({
    features: { consolidateOnTraceDelta: true, consolidateTraceDelta: 20, consolidateTraceGapMinutes: 30 },
    lastRunAt: NOW - 40 * 60_000,
    fresh: 99,
  });
  cortex.db = { prepare: () => ({ get: () => ({ at: iso }) }) };
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0, '10 分钟前刚真巩固过，不该再跑');
  assert.equal(report.steps.autoConsolidate.skipped, 'too-soon');
});

test('审计查不到时退回 dream_runs 的最后一条', async () => {
  const cortex = fakeCortex({
    features: { consolidateOnTraceDelta: true, consolidateTraceDelta: 20, consolidateTraceGapMinutes: 30 },
    lastRunAt: NOW - 40 * 60_000,
    fresh: 25,
  });
  cortex.db = { prepare: () => ({ get: () => undefined }) };
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 1);
  assert.equal(report.steps.autoConsolidate.fresh, 25);
});
