import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listBackups, pruneBackups } from '../../src/guardian/rotation.js';

test('backup rotation lists and prunes only cortex sqlite files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-rotate-'));
  try {
    for (const name of ['cortex-1.sqlite', 'cortex-2.sqlite', 'cortex-3.sqlite', 'notes.txt', 'other.sqlite']) writeFileSync(path.join(dir, name), 'x');
    const listed = listBackups(dir);
    assert.deepEqual(listed.map((entry) => entry.name).sort(), ['cortex-1.sqlite', 'cortex-2.sqlite', 'cortex-3.sqlite']);
    const dry = pruneBackups(dir, { retain: 2, dryRun: true });
    assert.equal(dry.total, 3);
    assert.equal(dry.candidates.length, 1);
    assert.equal(dry.removed.length, 0);
    const applied = pruneBackups(dir, { retain: 2 });
    assert.equal(applied.removed.length, 1);
    assert.equal(listBackups(dir).length, 2);
    assert.ok(pruneBackups(dir, { retain: 0 }).retain >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
