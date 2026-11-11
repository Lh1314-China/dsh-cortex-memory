import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('retention plan only archives old, low-value, non-reflection traces', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-retention-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const old = Date.now() - 400 * 86400000;
    const low = cortex.write({ text: '很久以前的普通记忆。', explicit: true, importance: 0.1, now: old });
    const high = cortex.write({ text: '很久以前但很重要的记忆。', explicit: true, importance: 0.9, now: old });
    const fresh = cortex.write({ text: '新记忆。', explicit: true, importance: 0.1, now: Date.now() });
    const plan = cortex.retention.plan({ maxAgeDays: 365, minImportance: 0.2 });
    assert.ok(plan.candidates.some((item) => item.id === low.trace.id));
    assert.equal(plan.candidates.some((item) => item.id === high.trace.id), false);
    assert.equal(plan.candidates.some((item) => item.id === fresh.trace.id), false);
    const dry = cortex.retention.apply(plan, { dryRun: true });
    assert.ok(dry.archived >= 1);
    assert.equal(cortex.get(low.trace.id).state, 'active');
    const applied = cortex.retention.apply(plan);
    assert.ok(applied.archived >= 1);
    assert.equal(cortex.get(low.trace.id).state, 'archived');
    assert.equal(cortex.get(high.trace.id).state, 'active');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
