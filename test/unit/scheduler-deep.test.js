import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../src/host/scheduler.js';

const NOW = Date.parse('2026-11-18T10:00:00+08:00');

function fakeCortex({ config = {} } = {}) {
  const runs = [];
  return {
    runs,
    config: { scope: 'global', ...config },
    consolidation: {
      list: () => [],
      run: async (args) => {
        runs.push(args);
        return { run: { status: 'applied' }, decisions: [{}], applied: [{ action: 'merge' }] };
      },
    },
  };
}

test('过了深整理时间点会跑一趟，caller 是 deep-daily', async () => {
  const cortex = fakeCortex({ config: { deepConsolidateHour: 4 } });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 1);
  assert.equal(cortex.runs[0].caller, 'deep-daily');
  assert.equal(cortex.runs[0].limit, 60);
  assert.equal(report.steps.deepConsolidate.applied, 1);
  await scheduler.runOnce();
  assert.equal(cortex.runs.length, 1, '同一进程内一天只跑一趟');
});

test('没到时间点不跑', async () => {
  const cortex = fakeCortex({ config: { deepConsolidateHour: 23 } });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  const report = await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0);
  assert.equal(report.steps.deepConsolidate, undefined);
});

test('audit 里今天已经跑过时，重启后也不重复', async () => {
  const cortex = fakeCortex({ config: { deepConsolidateHour: 4 } });
  cortex.db = { prepare: () => ({ get: () => ({ at: new Date(NOW).toISOString() }) }) };
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0, '同一天已跑过就不该再跑');
});

test('deepConsolidateOnSchedule:false 时完全不动', async () => {
  const cortex = fakeCortex({ config: { deepConsolidateHour: 4, deepConsolidateOnSchedule: false } });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.runs.length, 0);
});

test('深整理使用更大的候选窗口', async () => {
  const cortex = fakeCortex({ config: { deepConsolidateHour: 4, deepConsolidateLimit: 70 } });
  const scheduler = createScheduler({ cortex, now: () => NOW, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.runs[0].limit, 70);
});
