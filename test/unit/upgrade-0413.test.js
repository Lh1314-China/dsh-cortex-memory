import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createHostRuntime } from '../../src/host/runtime.js';
import { extractFactCandidates } from '../../src/engines/extract.js';

function setup(extra = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-0413-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), ...extra } });
  return { dir, cortex };
}

function teardown({ dir, cortex }) {
  try { cortex.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
}

test('evolution guard is configurable through the normalized config', () => {
  const ctx = setup({ evolution: { maxPerDay: 1, canaryTicks: 2, minIntervalMs: 0 } });
  try {
    const guard = ctx.cortex.evolution.status().guard;
    assert.equal(guard.maxPerDay, 1);
    assert.equal(guard.canaryTicks, 2);
    assert.equal(guard.minIntervalMs, 0);
  } finally {
    teardown(ctx);
  }
});

test('canaries survive a restart and still roll back an active policy', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-0413-restart-'));
  const dbFile = path.join(dir, 'cortex.sqlite');
  let first = createCortex({ config: { dataRoot: dir, dbFile } });
  try {
    const skill = first.engines.skills.create({ name: 'restart-canary', steps: ['a'], state: 'active' });
    for (let i = 0; i < 3; i += 1) first.engines.skills.record(skill.id, false);
    const evolved = first.evolution.autoEvolve();
    assert.ok(evolved.activated.length >= 1);
    assert.ok(first.evolution.status().guard.pendingCanaries >= 1);
  } finally {
    first.close();
  }

  let second = createCortex({ config: { dataRoot: dir, dbFile } });
  try {
    assert.ok(second.evolution.status().guard.pendingCanaries >= 1);
    const rolled = second.evolution.observeHealth({ ok: false, issues: [{ code: 'FTS_DRIFT' }] });
    assert.ok(rolled.rolledBack.length >= 1);
    assert.equal(second.policies.active('skill'), null);
  } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recallSharing is opt-in and shares the block across sessions', () => {
  const ctx = setup();
  try {
    ctx.cortex.write({ text: '主人说会买白饭。', explicit: true });
    const runtime = createHostRuntime({ cortex: ctx.cortex, config: { recallSharing: true } });
    const s1 = { id: 's1', header: {} };
    const s2 = { id: 's2', header: {} };
    runtime.onSessionEvent(s1, { type: 'turn/start', data: { turn: 1 }, time: Date.now() });
    runtime.onSessionEvent(s1, { type: 'user/message', data: { content: '白饭还算数吗？' }, time: Date.now() });
    assert.match(runtime.recallText({ session: s1 }), /白饭/);
    assert.equal(runtime.recallText({ session: s1 }), runtime.recallText({ session: s2 }));
  } finally {
    teardown(ctx);
  }
});

test('first-person extraction follows persona names while keeping markdown rejection', () => {
  const custom = extractFactCandidates('本鲸喜欢安静', { selfName: '小鲸', userAddress: '主人' });
  assert.equal(custom[0].subject, '小鲸');
  assert.equal(custom[0].predicate, 'likes');

  const neutral = extractFactCandidates('我喜欢便宜平替', { selfName: '助手', userAddress: '用户' });
  assert.equal(neutral[0].subject, '用户');

  assert.deepEqual(extractFactCandidates('**我喜欢便宜平替**', { selfName: '助手', userAddress: '用户' }), []);
});
