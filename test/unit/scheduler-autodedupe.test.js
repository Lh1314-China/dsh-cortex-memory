import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../src/host/scheduler.js';

const NOW = Date.parse('2026-11-18T20:00:00.000Z');

function fakeCortex({ config = {}, dedupe } = {}) {
  const calls = [];
  return {
    calls,
    config,
    consolidation: {
      list: () => [],
      run: async () => ({ run: { status: 'applied' }, decisions: [], applied: [] }),
      dedupe: async (args) => {
        calls.push(args);
        if (dedupe) return dedupe(args);
        return { run: { status: 'applied', groups: 1 }, applied: [{ action: 'merge' }], decisions: [{}] };
      },
    },
  };
}

test('dedupe 按六小时间隔自动跑一次', async () => {
  const cortex = fakeCortex({ config: { scope: 'global' } });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const first = await scheduler.runOnce();
  assert.equal(cortex.calls.length, 1, '第一次 tick 应跑一次 dedupe');
  assert.equal(first.steps.autoDedupe.applied, 1);
  assert.equal(first.steps.autoDedupe.groups, 1);
  const second = await scheduler.runOnce();
  assert.equal(cortex.calls.length, 1, '六小时内不重复跑');
  assert.ok(second.steps.autoDedupe === undefined, '没到间隔时不报步骤');
});

test('dedupeOnSchedule: false 时完全不调用', async () => {
  const cortex = fakeCortex({ config: { scope: 'global', dedupeOnSchedule: false } });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.calls.length, 0);
  assert.equal(report.steps.autoDedupe, undefined);
});

test('dedupe 抛错时记进步骤，不打断 tick', async () => {
  const cortex = fakeCortex({
    config: { scope: 'global' },
    dedupe: async () => { throw new Error('dedupe boom'); },
  });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.match(String(report.steps.autoDedupe.error), /dedupe boom/);
});
