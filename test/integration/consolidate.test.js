import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function withCortex(reply, fn) {
  return async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-'));
    const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') }, llm: reply ? { complete: async () => reply } : null });
    try {
      await fn(cortex);
    } finally {
      cortex.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seed(cortex) {
  const at = Date.parse('2026-11-11T10:00:00+08:00');
  const a = cortex.write({ text: '旧的低价值记忆 A。', explicit: true, importance: 0.3, now: at });
  const b = cortex.write({ text: '要保留的记忆 B。', explicit: true, importance: 0.6, now: at + 1000 });
  const c = cortex.write({ text: '要合并的记忆 C。', explicit: true, importance: 0.5, now: at + 2000 });
  const d = cortex.write({ text: '重要记忆 D，不能归档。', explicit: true, importance: 0.95, now: at + 3000 });
  return { a: a.trace.id, b: b.trace.id, c: c.trace.id, d: d.trace.id };
}

test('consolidation applies validated archive/merge and records a replayable run', withCortex(null, async (cortex) => {
  const ids = seed(cortex);
  const reply = JSON.stringify([
    { action: 'archive', ids: [ids.a], reason: 'low value' },
    { action: 'merge', ids: [ids.b, ids.c], targetId: ids.b, reason: 'same topic' },
  ]);
  cortex.llm = { complete: async () => reply };
  // Inject through a fresh engine so the same service can use the reply adapter.
  const { createConsolidationEngine } = await import('../../src/engines/consolidate.js');
  const engine = createConsolidationEngine({ db: cortex.db, traces: cortex.repos.traces, summaries: cortex.repos.summaries, audit: cortex.repos.audit, llm: cortex.llm });
  const result = await engine.run({ scopeId: 'global', now: Date.parse('2026-11-11T12:00:00+08:00'), limit: 20 });
  assert.equal(result.run.status, 'applied');
  assert.equal(result.applied.length, 2);
  assert.equal(cortex.get(ids.a).state, 'archived');
  assert.equal(cortex.get(ids.c).state, 'archived');
  assert.equal(cortex.get(ids.b).state, 'active');
  assert.equal(cortex.get(ids.d).state, 'active');
  assert.equal(engine.list({ scopeId: 'global' }).length, 1);
  assert.equal(engine.list({ scopeId: 'global' })[0].inputDigest.length, 64);
}));

test('consolidation dry-run and invalid/protected decisions do not mutate', withCortex(null, async (cortex) => {
  const ids = seed(cortex);
  cortex.llm = { complete: async () => JSON.stringify([
    { action: 'archive', ids: [ids.d] },
    { action: 'archive', ids: ['trc_missing'] },
    { action: 'nonsense', ids: [ids.a] },
  ]) };
  const { createConsolidationEngine } = await import('../../src/engines/consolidate.js');
  const engine = createConsolidationEngine({ db: cortex.db, traces: cortex.repos.traces, summaries: cortex.repos.summaries, audit: cortex.repos.audit, llm: cortex.llm });
  const result = await engine.run({ scopeId: 'global', dryRun: true });
  assert.equal(result.run.status, 'rejected');
  assert.equal(result.applied.length, 0);
  assert.equal(cortex.get(ids.d).state, 'active');
  assert.equal(cortex.get(ids.a).state, 'active');
}));

test('consolidation without an LLM records skipped and changes nothing', withCortex(null, async (cortex) => {
  const ids = seed(cortex);
  const result = await cortex.consolidation.run({ scopeId: 'global' });
  assert.equal(result.run.status, 'skipped');
  assert.equal(result.run.error, 'no-llm');
  assert.equal(result.applied.length, 0);
  assert.equal(cortex.get(ids.a).state, 'active');
  assert.equal(cortex.consolidation.list({ scopeId: 'global' }).length, 1);
}));
