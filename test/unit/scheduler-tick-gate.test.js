import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../src/host/scheduler.js';

const NOW = Date.parse('2026-11-16T08:00:00.000Z');

function fakeCortex(lastRunAt) {
  const runs = [];
  return {
    runs,
    config: { scope: 'global', deepConsolidateOnSchedule: false, features: { llm: true, consolidateOnTick: true, consolidateTraceGapMinutes: 30 } },
    repos: { traces: { listSince: () => [] } },
    consolidation: {
      list: () => (lastRunAt ? [{ at: new Date(lastRunAt).toISOString() }] : []),
      run: async () => {
        runs.push(1);
        return { run: { status: 'applied', model: 'llm-bounded', error: null }, decisions: [{ action: 'keep' }], applied: [] };
      },
    },
  };
}

test('tick 开着也不会一分钟一次：间隔不够就跳过', async () => {
  const cortex = fakeCortex(NOW - 5 * 60_000);
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null, consolidateOnTick: true });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0);
  assert.equal(report.steps.consolidation.skipped, 'too-soon');
  assert.equal(report.steps.consolidation.minutesSinceLast, 5);
});

test('tick 开着且间隔已过，才真的跑一次', async () => {
  const cortex = fakeCortex(NOW - 40 * 60_000);
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null, consolidateOnTick: true });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 1);
  assert.equal(report.steps.consolidation.run.status, 'applied');
});
