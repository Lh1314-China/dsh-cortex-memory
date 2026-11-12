import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-service-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), scope: 'global' } });
  return { dir, cortex };
}

test('service writes, searches, reads, reflects and reports self/health', () => {
  const { dir, cortex } = setup();
  try {
    const written = cortex.write({
      text: '用户说会买白饭，助手会一直等。',
      explicit: true,
      facts: [{ subject: '用户', predicate: 'likes', object: '白饭' }],
    });
    assert.equal(written.skipped, false);
    const search = cortex.search('白饭');
    assert.ok(search.items.length >= 1);
    const get = cortex.get(written.trace.id);
    assert.match(get.content, /白饭/);
    const self = cortex.self();
    assert.equal(self.self.scopeId, 'global');
    assert.ok(self.identity.version >= 1);
    const health = cortex.health();
    assert.ok(health.score > 0);
    const timeline = cortex.timeline({ aroundId: written.trace.id });
    assert.equal(timeline.anchor.id, written.trace.id);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('service feedback and reflection work through the facade', () => {
  const { dir, cortex } = setup();
  try {
    const a = cortex.write({ text: '今天修好了检索的预算裁剪。', explicit: true });
    const b = cortex.write({ text: '用户说白饭的承诺还算数。', explicit: true });
    const feedback = cortex.feedback({ traceId: a.trace.id, signal: 'helpful', predicted: 0.8 });
    assert.ok(feedback.trace.stability > 0);
    const reflected = cortex.reflect({ windowDays: 1, force: true });
    assert.equal(reflected.skipped, false);
    assert.ok(reflected.trace);
    const deleted = cortex.forget({ traceId: b.trace.id, mode: 'delete' });
    assert.equal(deleted.removed, true);
    assert.equal(cortex.get(b.trace.id), null);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('service enqueues and runs a reflect job', async () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '第一条。', explicit: true });
    cortex.write({ text: '第二条。', explicit: true });
    const job = cortex.enqueueReflect({ windowDays: 1, operationId: 'op-reflect' });
    assert.equal(job.kind, 'reflect');
    const run = await cortex.runner.runUntilIdle();
    assert.equal(run.ran, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
