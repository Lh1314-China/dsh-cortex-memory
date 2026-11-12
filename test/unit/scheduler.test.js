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

test('scheduler writes an automatic diary at the 12:00 slot', async () => {
  const calls = [];
  const at = new Date(2026, 10, 12, 12, 0, 0).getTime();
  const scheduler = createScheduler({
    cortex: {
      autonomy: null,
      retention: null,
      guardian: null,
      runner: null,
      config: { scope: 'global', features: { autoDiary: true, autoDream: false } },
      scopeWritable: () => true,
      life: {
        diaryList: () => [],
        diaryGenerate: async (args) => {
          calls.push(args);
          return { id: 'dly_test', text: '自动日记', model: 'llm', sourceCount: 1, source: args.source };
        },
      },
    },
    now: () => at,
    isIdle: () => true,
    intervalMs: 60_000,
  });
  const report = await scheduler.runOnce();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'cortex:auto:slot:12');
  assert.equal(report.steps.autoDiary.source, 'cortex:auto:slot:12');
});

test('scheduler writes an automatic feeling when idle', async () => {
  const calls = [];
  const at = new Date(2026, 10, 12, 13, 0, 0).getTime();
  const scheduler = createScheduler({
    cortex: {
      autonomy: null,
      retention: null,
      guardian: null,
      runner: null,
      config: { scope: 'global', features: { autoDiary: false, autoDream: false, autoFeeling: true } },
      scopeWritable: () => true,
      emotion: { events: () => [] },
      life: {
        feelingGenerate: async (args) => {
          calls.push(args);
          return { text: '助手现在很安静。', emotions: [{ name: '安', score: 1 }], target: '用户', model: 'llm', sourceCount: 1 };
        },
      },
    },
    now: () => at,
    isIdle: () => true,
    intervalMs: 60_000,
  });
  const report = await scheduler.runOnce();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'cortex:auto:feeling');
  assert.equal(report.steps.autoFeeling.text, '助手现在很安静。');
});

test('scheduler asks the LLM to review candidate edges', async () => {
  const actions = [];
  const scheduler = createScheduler({
    cortex: {
      autonomy: null,
      retention: null,
      guardian: null,
      runner: null,
      config: { scope: 'global', features: { autoDiary: false, autoDream: false, autoFeeling: false, aiEdgeReview: true } },
      scopeWritable: () => true,
      graphCandidates: () => [{ id: 'edge-1', fromId: 'a', toId: 'b', rel: 'likes' }],
      reviewGraphCandidate: async () => ({ decision: 'approve', confidence: 0.8, reason: 'evidence matches' }),
      graphCandidateAction: (args) => { actions.push(args); return { id: args.id }; },
    },
    now: () => Date.now(),
    isIdle: () => false,
    intervalMs: 60_000,
  });
  const report = await scheduler.runOnce();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'approve');
  assert.equal(report.steps.aiEdgeReview.reviewed, 1);
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
