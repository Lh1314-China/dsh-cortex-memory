import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('search budget blocks after the configured call limit', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-budget-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), maxCallsPerHour: 1 } });
  try {
    cortex.write({ text: '一条记忆。', explicit: true });
    const first = cortex.search('记忆');
    assert.equal(first.items.length, 1);
    const second = cortex.search('记忆');
    assert.equal(second.items.length, 0);
    assert.equal(second.trace.blocked, 'budget');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search circuit opens after repeated retrieval failures and fails open with a reason', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-circuit-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), circuitThreshold: 2, circuitCooldownMs: 60_000 } });
  try {
    const original = cortex.engines.retrieve.search;
    cortex.engines.retrieve.search = () => { throw new Error('boom'); };
    assert.throws(() => cortex.search('x'));
    assert.throws(() => cortex.search('x'));
    const blocked = cortex.search('x');
    assert.equal(blocked.items.length, 0);
    assert.equal(blocked.trace.blocked, 'circuit');
    cortex.engines.retrieve.search = original;
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
