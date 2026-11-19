import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../src/host/scheduler.js';

function fakeCortex(vectorResult, calls = { maintain: 0, vector: 0, budget: null }) {
  return {
    calls,
    config: { scope: 'global' },
    scopeWritable: () => true,
    autonomy: null,
    maintain: () => { calls.maintain += 1; return { disputes: 0 }; },
    vectorMaintain: async (options) => { calls.vector += 1; calls.budget = options?.budgetMs; return vectorResult; },
    vector: null,
  };
}

test('a pending queue switches maintenance to the two-minute cadence', async () => {
  const cortex = fakeCortex({ queued: 200, pending: 120, ok: 45 });
  const scheduler = createScheduler({ cortex, intervalMs: 60_000, logger: null });
  await scheduler.runOnce();
  assert.equal(cortex.calls.vector, 1);
  assert.equal(cortex.calls.budget, 45000, 'default drain budget should be 45s');
  assert.equal(scheduler.status().maintenanceGapMs, 120000);
});

test('an empty queue keeps the ten-minute cadence', async () => {
  const cortex = fakeCortex({ queued: 0, pending: 0, ok: 0 });
  const scheduler = createScheduler({ cortex, intervalMs: 60_000, logger: null });
  await scheduler.runOnce();
  assert.equal(scheduler.status().maintenanceGapMs, 600000);
  await scheduler.runOnce();
  assert.equal(cortex.calls.vector, 1, 'the second immediate pass is gated');
});
