import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readOverrides, writeOverride, rollbackOverride, effectiveFeatures, overridesPath } from '../../src/core/feature-overrides.js';

test('feature overrides persist, merge and roll back', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-overrides-'));
  try {
    const first = writeOverride(dir, 'llm', true);
    assert.equal(first.to, true);
    writeOverride(dir, 'vector', true);
    writeOverride(dir, 'autoFacts', true);
    const file = overridesPath(dir);
    assert.match(readFileSync(file, 'utf8'), /"llm": true/);
    const merged = effectiveFeatures({ dataRoot: dir, features: { llm: false, capture: true } });
    assert.equal(merged.features.llm, true);
    assert.equal(merged.features.vector, true);
    assert.equal(merged.features.autoFacts, true);
    assert.equal(merged.features.capture, true);
    assert.equal(merged.overrides.llm, true);
    const back = rollbackOverride(dir);
    assert.equal(back.rolledBack, true);
    assert.equal(back.key, 'autoFacts');
    assert.equal(back.value, null);
    assert.equal(merged.overrides.llm, true);
    assert.deepEqual(readOverrides(dir).current, { llm: true, vector: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feature overrides reject unknown keys and bad values', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-overrides-bad-'));
  try {
    assert.throws(() => writeOverride(dir, 'network', true), /not allowed/);
    assert.throws(() => writeOverride(dir, 'llm', 'yes'), /boolean/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
