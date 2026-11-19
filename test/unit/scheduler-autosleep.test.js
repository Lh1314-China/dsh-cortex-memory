import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../src/host/scheduler.js';

function fakeCortex({ sleepRunsAt = null, features = { autoSleep: true } } = {}) {
  const calls = { sleep: 0 };
  return {
    calls,
    config: { scope: 'global', features },
    scopeWritable: () => true,
    autonomy: null,
    maintain: () => ({ disputes: 0 }),
    vectorMaintain: async () => ({ queued: 0, pending: 0, ok: 0 }),
    vector: null,
    life: {
      diaryList: () => [],
      dreamList: () => [],
      sleepRuns: () => (sleepRunsAt ? [{ at: sleepRunsAt }] : []),
      sleep: async () => { calls.sleep += 1; return { ok: true }; },
    },
  };
}

test('autoSleep 打开且从没睡过时，会安排一次睡眠', async () => {
  const cortex = fakeCortex();
  const scheduler = createScheduler({ cortex, intervalMs: 60_000, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.calls.sleep, 1, '空闲时应该睡一次');
});

test('距上次睡眠不足 20 小时不重复睡', async () => {
  const cortex = fakeCortex({ sleepRunsAt: new Date(Date.now() - 3 * 3_600_000).toISOString() });
  const scheduler = createScheduler({ cortex, intervalMs: 60_000, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.calls.sleep, 0, '3 小时前刚睡过，不该再睡');
});

test('距上次睡眠超过 20 小时会再睡一次', async () => {
  const cortex = fakeCortex({ sleepRunsAt: new Date(Date.now() - 21 * 3_600_000).toISOString() });
  const scheduler = createScheduler({ cortex, intervalMs: 60_000, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.calls.sleep, 1);
});

test('autoSleep 关闭时完全不调用 sleep', async () => {
  const cortex = fakeCortex({ features: { autoSleep: false } });
  const scheduler = createScheduler({ cortex, intervalMs: 60_000, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.calls.sleep, 0);
});
