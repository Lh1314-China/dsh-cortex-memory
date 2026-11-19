import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup(overrides) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-vector-override-'));
  if (overrides) {
    writeFileSync(path.join(dir, 'feature-overrides.json'), JSON.stringify({ version: 1, current: overrides, history: [] }));
  }
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('the settings-panel vector override actually enables the vector engine', () => {
  const { dir, cortex } = setup({ vector: true });
  try {
    assert.ok(cortex.vector, 'vector engine should exist when overrides say vector: true');
    assert.equal(typeof cortex.vector.backfillMissing, 'function');
    assert.equal(typeof cortex.vectorMaintain, 'function');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without the override and without config, vector stays off', () => {
  const { dir, cortex } = setup(null);
  try {
    assert.equal(cortex.vector, null);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
