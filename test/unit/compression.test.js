import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { extractFactCandidates } from '../../src/engines/extract.js';
import { coverageOf } from '../../src/engines/compression.js';

test('fact extraction finds preferences, states and plans', () => {
  const candidates = extractFactCandidates('用户喜欢米食，助手会在明天继续修插件，米食是主食。');
  assert.ok(candidates.some((item) => item.predicate === 'likes' && item.object.includes('米食')));
  assert.ok(candidates.some((item) => item.predicate === 'will'));
  assert.ok(candidates.some((item) => item.predicate === 'is'));
});

test('coverage prefers source pointers over token overlap', () => {
  const trace = { id: 't1', eventId: 'e1', content: '米食 承诺 用户' };
  const bySource = coverageOf(trace, { summaries: [{ id: 's1', sourceIds: ['t1'], content: '完全不同的摘要' }], facts: [] });
  assert.equal(bySource.coverage, 1);
  assert.equal(bySource.by, 'summary-source');
  const byFact = coverageOf(trace, { summaries: [], facts: [{ sourceEventId: 'e1' }] });
  assert.equal(byFact.coverage, 0.6);
});

test('compression archives covered old traces and revive brings them back', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-compress-'));
  const cortex = createCortex({
    config: {
      dataRoot: dir,
      dbFile: path.join(dir, 'cortex.sqlite'),
      compression: { minAgeDays: 0, retrievability: 1, importance: 1, coverageThreshold: 0 },
    },
  });
  try {
    const written = cortex.write({ text: '一条会被压缩的旧记忆。', explicit: true, importance: 0.1, now: Date.now() - 30 * 86400000 });
    cortex.repos.summaries.insert({ content: '摘要', sourceIds: [written.trace.id], coverage: 1 });
    const evaluated = cortex.compression.evaluate();
    assert.ok(evaluated.some((row) => row.trace.id === written.trace.id && row.eligible));
    const compressed = cortex.compression.compress();
    assert.ok(compressed.archived >= 1);
    assert.equal(cortex.get(written.trace.id).state, 'archived');
    const revived = cortex.compression.revive(written.trace.id);
    assert.equal(revived.revived, true);
    assert.equal(cortex.get(written.trace.id).state, 'active');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('autoFacts writes semantic facts when enabled', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-autofacts-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { autoFacts: true } },
  });
  try {
    const result = cortex.write({ text: '用户喜欢米食。', explicit: true });
    assert.ok(result.autoFacts);
    assert.ok(result.autoFacts.resolved.length >= 1);
    assert.ok(cortex.repos.facts.list({ limit: 10 }).length >= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
