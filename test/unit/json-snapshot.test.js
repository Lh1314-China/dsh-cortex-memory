import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { exportSnapshot, validateSnapshot, importSnapshot } from '../../src/adapters/json.js';

test('snapshot export validates and imports idempotently', () => {
  const sourceDir = mkdtempSync(path.join(os.tmpdir(), 'cortex-json-src-'));
  const targetDir = mkdtempSync(path.join(os.tmpdir(), 'cortex-json-dst-'));
  const source = createCortex({ config: { dataRoot: sourceDir, dbFile: path.join(sourceDir, 'cortex.sqlite') } });
  const target = createCortex({ config: { dataRoot: targetDir, dbFile: path.join(targetDir, 'cortex.sqlite') } });
  try {
    source.write({ text: '用户说会买白饭。', explicit: true, tags: ['白饭'] });
    const snapshot = exportSnapshot(source);
    assert.equal(validateSnapshot(snapshot).ok, true);
    const dry = importSnapshot(target, snapshot, { dryRun: true });
    assert.equal(dry.imported, false);
    assert.equal(target.repos.traces.count(), 0);
    const imported = importSnapshot(target, snapshot);
    assert.equal(imported.imported, true);
    assert.equal(imported.traces, 1);
    assert.equal(target.repos.traces.count(), 1);
    const again = importSnapshot(target, snapshot);
    assert.equal(again.items[0].skipped, true);
    assert.equal(target.repos.traces.count(), 1);
  } finally {
    source.close();
    target.close();
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('invalid snapshots are rejected', () => {
  assert.equal(validateSnapshot(null).ok, false);
  assert.equal(validateSnapshot({ format: 'other', version: 1 }).ok, false);
  assert.equal(validateSnapshot({ format: 'dsh-cortex-snapshot', version: 99, traces: [], facts: [], entities: [] }).ok, false);
});

test('snapshot export is not silently capped at 500 traces', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-json-cap-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const inputs = Array.from({ length: 501 }, (_, i) => ({ text: `第 ${i} 条记忆。`, explicit: true, operationId: `cap:${i}` }));
    cortex.writeMany(inputs, { chunkSize: 200 });
    assert.equal(cortex.repos.traces.count(), 501);
    const snapshot = exportSnapshot(cortex);
    assert.equal(snapshot.traces.length, 501);
    const plan = cortex.retention.plan({ maxAgeDays: 3650, minImportance: 0.5 });
    assert.equal(plan.active, 501);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
