import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createJobRepository } from '../../src/store/repositories/jobs.js';
import { createJobRunner } from '../../src/engines/jobs.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-jobs-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db, queue: createJobRepository(db) };
}

test('jobs are idempotent by operationId and can be claimed/completed', () => {
  const { dir, db, queue } = setup();
  try {
    const first = queue.enqueue({ kind: 'extract', payload: { text: '米食' }, operationId: 'op-1' });
    const replay = queue.enqueue({ kind: 'extract', payload: { text: '米食' }, operationId: 'op-1' });
    assert.equal(replay.id, first.id);
    assert.equal(queue.counts().pending, 1);
    const claimed = queue.claimNext({ now: Date.now() + 1000 });
    assert.equal(claimed.id, first.id);
    assert.equal(claimed.status, 'running');
    assert.equal(claimed.attempts, 1);
    const done = queue.complete(claimed.id, { ok: true });
    assert.equal(done.status, 'done');
    assert.deepEqual(done.result, { ok: true });
    assert.equal(queue.counts().done, 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed job retries and eventually becomes failed', () => {
  const { dir, db, queue } = setup();
  try {
    const now = Date.now();
    const job = queue.enqueue({ kind: 'extract', payload: {}, maxAttempts: 2 });
    const first = queue.claimNext({ now });
    const retry = queue.fail(first.id, 'boom', { now, retryAfterMs: 60_000 });
    assert.equal(retry.status, 'pending');
    assert.ok(retry.runAfter > new Date(now).toISOString());
    assert.equal(queue.claimNext({ now }), null);
    const second = queue.claimNext({ now: now + 61_000 });
    assert.equal(second.id, job.id);
    const failed = queue.fail(second.id, 'boom again', { now: now + 61_000 });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'boom again');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner executes a handler and records the result', async () => {
  const { dir, db, queue } = setup();
  try {
    queue.enqueue({ kind: 'echo', payload: { text: '米食' } });
    const runner = createJobRunner({ queue, handlers: { echo: async (payload) => ({ echoed: payload.text }) } });
    const result = await runner.runUntilIdle();
    assert.equal(result.ran, 1);
    assert.equal(result.results[0].ok, true);
    assert.equal(queue.list({ status: 'done' })[0].result.echoed, '米食');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner marks an exception as a retry/failure', async () => {
  const { dir, db, queue } = setup();
  try {
    queue.enqueue({ kind: 'explode', payload: {}, maxAttempts: 1 });
    const runner = createJobRunner({ queue, handlers: { explode: async () => { throw new Error('nope'); } } });
    const result = await runner.runOne();
    assert.equal(result.ok, false);
    assert.equal(queue.list({ status: 'failed' })[0].error, 'nope');
    const missing = createJobRunner({ queue });
    queue.enqueue({ kind: 'missing', payload: {} });
    const missingResult = await missing.runOne();
    assert.equal(missingResult.ok, false);
    assert.match(missingResult.error, /no handler/);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
