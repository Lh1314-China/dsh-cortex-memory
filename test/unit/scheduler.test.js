import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createScheduler } from '../../src/host/scheduler.js';

test('scheduler runOnce is safe and reports steps', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-scheduler-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({ text: '一条记忆。', explicit: true });
    const scheduler = createScheduler({ cortex, intervalMs: 60_000 });
    const report = await scheduler.runOnce();
    assert.ok(report.steps.autonomy);
    assert.ok(report.steps.guardian);
    assert.equal(report.steps.guardian.ok, true);
    assert.equal(scheduler.status().running, false);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scheduler can run consolidation on a tick when explicitly enabled', async () => {
  let called = 0;
  const scheduler = createScheduler({
    cortex: { autonomy: null, retention: null, guardian: null, runner: null, config: { scope: 'global' }, consolidation: { run: async () => { called += 1; return { run: { status: 'applied' } }; } } },
    consolidateOnTick: true,
    intervalMs: 60_000,
  });
  const report = await scheduler.runOnce();
  assert.equal(called, 1);
  assert.equal(report.steps.consolidation.run.status, 'applied');
});

test('scheduler start/stop uses an unref timer and does not double start', () => {
  const timers = [];
  const cleared = [];
  const scheduler = createScheduler({
    cortex: { autonomy: null, retention: null, guardian: null, runner: null },
    intervalMs: 5000,
    setIntervalImpl: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearIntervalImpl: (timer) => { cleared.push(timer); },
  });
  assert.equal(scheduler.start(), true);
  assert.equal(scheduler.start(), false);
  assert.equal(timers.length, 1);
  assert.equal(scheduler.status().running, true);
  assert.equal(scheduler.stop(), true);
  assert.equal(cleared.length, 1);
  assert.equal(scheduler.status().running, false);
});
