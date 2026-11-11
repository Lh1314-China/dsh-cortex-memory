import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('writeMany rolls back the whole chunk and does not count rolled-back writes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-batch-rollback-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({ text: '原始记忆。', explicit: true, operationId: 'dup' });
    const before = cortex.metrics().counters['writes.created'] ?? 0;
    assert.throws(() => cortex.writeMany([
      { text: '冲突记忆。', explicit: true, operationId: 'dup' },
      { text: '同批另一条。', explicit: true, operationId: 'other' },
    ], { chunkSize: 10 }));
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.metrics().counters['writes.created'] ?? 0, before);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeMany commits a batch and is idempotent per operationId', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-batch-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const inputs = Array.from({ length: 25 }, (_, i) => ({
      text: `批量记忆 ${i}：用户和助手在写模块。`,
      explicit: true,
      operationId: `batch:${i}`,
    }));
    const first = cortex.writeMany(inputs, { chunkSize: 10 });
    assert.equal(first.length, 25);
    assert.equal(first.filter((item) => item.trace).length, 25);
    assert.equal(cortex.repos.traces.count(), 25);
    const second = cortex.writeMany(inputs, { chunkSize: 10 });
    assert.equal(second.filter((item) => item.skipped).length, 25);
    assert.equal(cortex.repos.traces.count(), 25);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
