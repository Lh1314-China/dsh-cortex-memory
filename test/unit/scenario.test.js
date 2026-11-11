import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createHostRuntime } from '../../src/host/runtime.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-scenario-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('full life loop: capture, recall, feedback, reflect, sleep, develop', async () => {
  const { dir, cortex } = setup();
  try {
    const runtime = createHostRuntime({ cortex });
    const session = { id: 'scenario', header: { origin: undefined } };
    const base = Date.now() - 3_600_000;
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 }, time: base });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '主人说会买白饭，本鲸等得起。' }, time: base + 1000 });
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 1, message: { content: '本鲸记住了。' } }, time: base + 2000 });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: base + 3000 });
    assert.equal(cortex.repos.traces.count(), 1);
    cortex.write({ text: '主人说会好好学技术。', explicit: true, now: base + 4000 });
    cortex.write({ text: '本鲸想一直陪着主人。', explicit: true, now: base + 5000 });

    const search = cortex.search('白饭');
    assert.ok(search.items.length >= 1);
    cortex.feedback({ traceId: search.items[0].id, signal: 'used', predicted: 0.7 });
    const reflected = cortex.reflect({ windowDays: 1 });
    assert.ok(reflected.summary);
    const sleep = await cortex.life.sleep({ at: Date.parse('2026-11-11T23:00:00+08:00') });
    assert.ok(sleep.id);
    const development = cortex.evaluateDevelopment();
    assert.ok(development.stage);
    const check = cortex.guardian.check();
    assert.equal(check.ok, true);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evolution loop: propose, evaluate, approve, apply, roll back', () => {
  const { dir, cortex } = setup();
  try {
    const first = cortex.evolution.propose({ kind: 'retrieval', config: { budget: 300 }, rationale: 'first' });
    const second = cortex.evolution.propose({ kind: 'retrieval', config: { budget: 500 }, rationale: 'second' });
    cortex.evolution.approve(first.id);
    assert.equal(cortex.search('x', { budget: 9999 }).budget.total, 300);
    cortex.evolution.approve(second.id);
    assert.equal(cortex.search('x', { budget: 9999 }).budget.total, 500);
    cortex.evolution.rollback('retrieval', first.id);
    assert.equal(cortex.search('x', { budget: 9999 }).budget.total, 300);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markdown export and privacy deletion leave a clean, auditable state', () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '会被导出的记忆。', title: '导出', explicit: true });
    const exported = cortex.exportMarkdown(path.join(dir, 'mirror'));
    assert.ok(readFileSync(path.join(exported.root, 'MEMORY.md'), 'utf8').includes('会被导出的记忆'));
    const before = cortex.repos.events.count();
    const deleted = cortex.privacy.deleteScope('global', { reason: 'scenario' });
    assert.equal(deleted.removed, true);
    assert.equal(cortex.repos.traces.count(), 0);
    assert.equal(cortex.repos.events.count(), before);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
