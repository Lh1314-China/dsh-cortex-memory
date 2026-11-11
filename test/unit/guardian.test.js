import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createCircuitBreaker, createBudgetGuard } from '../../src/guardian/circuit.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-guardian-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('guardian checks invariants and repairs FTS drift', () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '主人说会买白饭。', explicit: true });
    const clean = cortex.guardian.check();
    assert.equal(clean.ok, true);
    cortex.db.exec('DELETE FROM traces_fts_index');
    const drifted = cortex.guardian.check();
    assert.equal(drifted.ok, false);
    assert.ok(drifted.issues.some((issue) => issue.code === 'FTS_DRIFT'));
    const repaired = cortex.guardian.repairFts();
    assert.equal(repaired.after, 1);
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guardian backup is readable and validated', () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '备份前的记忆。', explicit: true });
    const backup = cortex.guardian.backup(path.join(dir, 'backup.sqlite'));
    assert.ok(backup.bytes > 0);
    const valid = cortex.guardian.validateBackup(backup.path);
    assert.equal(valid.ok, true);
    assert.equal(valid.integrity, 'ok');
    const restored = cortex.guardian.restore(backup.path, path.join(dir, 'restored.sqlite'));
    assert.equal(restored.restored, true);
    assert.equal(cortex.guardian.validateBackup(restored.target).ok, true);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt backups fail open instead of throwing', () => {
  const { dir, cortex } = setup();
  try {
    const corrupt = path.join(dir, 'corrupt.sqlite');
    writeFileSync(corrupt, 'not a database', 'utf8');
    const validation = cortex.guardian.validateBackup(corrupt);
    assert.equal(validation.ok, false);
    assert.equal(validation.reason, 'corrupt-or-unreadable');
    const restored = cortex.guardian.restore(corrupt, path.join(dir, 'should-not-exist.sqlite'));
    assert.equal(restored.restored, false);
    assert.equal(restored.reason, 'invalid-backup');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('circuit breaker opens, cools down and resets on success', () => {
  let now = 0;
  const breaker = createCircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => now });
  assert.equal(breaker.allow(), true);
  breaker.failure();
  breaker.failure();
  assert.equal(breaker.snapshot().state, 'open');
  assert.equal(breaker.allow(), false);
  now = 1001;
  assert.equal(breaker.allow(), true);
  breaker.success();
  assert.equal(breaker.snapshot().failures, 0);
});

test('budget guard enforces call and token limits', () => {
  let now = 0;
  const guard = createBudgetGuard({ maxCallsPerHour: 2, maxTokensPerHour: 10, now: () => now });
  assert.equal(guard.spend(4).ok, true);
  assert.equal(guard.spend(4).ok, true);
  assert.equal(guard.spend(1).ok, false);
  now = 3_600_001;
  assert.equal(guard.spend(10).ok, true);
});
