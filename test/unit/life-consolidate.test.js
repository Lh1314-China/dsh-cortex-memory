import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createLifeEngine } from '../../src/engines/life.js';

test('sleep runs consolidation when LLM is enabled, and records its status', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-sleep-consolidate-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    let called = 0;
    const life = createLifeEngine({
      db: cortex.db, traces: cortex.repos.traces, scopeId: 'global',
      consolidation: { run: async () => { called += 1; return { run: { status: 'applied' }, applied: [{ id: 'a' }, { id: 'b' }] }; } },
      features: { llm: true, consolidateOnSleep: true },
    });
    const report = await life.sleep({ at: Date.parse('2026-11-11T12:00:00+08:00') });
    assert.equal(called, 1);
    assert.equal(report.consolidation, 'applied');
    assert.equal(report.consolidated, 2);
    const again = await createLifeEngine({
      db: cortex.db, traces: cortex.repos.traces, scopeId: 'global',
      consolidation: { run: async () => { called += 1; } },
      features: { llm: false },
    }).sleep({ at: Date.parse('2026-11-11T12:01:00+08:00') });
    assert.equal(again.consolidation, null);
    assert.equal(called, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
