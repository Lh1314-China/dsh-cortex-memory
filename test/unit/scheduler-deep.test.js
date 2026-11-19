import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../src/host/scheduler.js';

// Local wall-clock 10:00, not a fixed UTC instant: the scheduler compares
// `getHours()` in the host's local timezone, so a literal "+08:00" timestamp
// reads as 02:00 on a UTC CI runner and the deep pass silently never fires.
const NOW = new Date(2026, 10, 18, 10, 0, 0).getTime();

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
