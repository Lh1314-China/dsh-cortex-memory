import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createSummaryRepository } from '../../src/store/repositories/summaries.js';
import { createEncodeEngine } from '../../src/engines/encode.js';
import { createNarrativeEngine } from '../../src/engines/narrative.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-narrative-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const summaries = createSummaryRepository(db);
  const encode = createEncodeEngine({ events, traces, config: { minCompressionValue: 0.01 } });
  const narrative = createNarrativeEngine({ traces, summaries });
  return { dir, db, encode, traces, summaries, narrative };
}

test('narrative thread links nearby episodes into one summary', () => {
  const { dir, db, encode, summaries, narrative } = setup();
  try {
    const base = Date.parse('2026-11-11T12:00:00+08:00');
    const a = encode.encode({ text: '今天开始修记忆引擎的图检索。', explicit: true, tags: ['记忆引擎', '图'], now: base });
    encode.encode({ text: '图检索接上了 PPR，实体扩展能跑。', explicit: true, tags: ['记忆引擎', '图'], now: base + 3600_000 });
    encode.encode({ text: 'PPR 结果映射回 trace，检索多了一路。', explicit: true, tags: ['记忆引擎', '图'], now: base + 7200_000 });
    const result = narrative.buildThread({ seedTraceId: a.trace.id, at: base + 8000_000 });
    assert.equal(result.skipped, false);
    assert.equal(result.summary.level, 'thread');
    assert.ok(result.summary.sourceIds.includes(a.trace.id));
    assert.match(result.summary.content, /一段关于/);
    assert.ok(result.coverage > 0);
    const recalled = narrative.recallThreads('图检索', { limit: 3 });
    assert.ok(recalled.length >= 1);
    assert.equal(recalled[0].thread.id, result.summary.id);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('weave creates at most maxThreads and skips already-woven seeds', () => {
  const { dir, db, encode, narrative } = setup();
  try {
    const base = Date.parse('2026-11-11T12:00:00+08:00');
    for (let i = 0; i < 4; i += 1) {
      encode.encode({ text: `第 ${i} 条关于插件的经历。`, explicit: true, tags: ['插件'], now: base + i * 3600_000 });
    }
    const first = narrative.weave({ maxThreads: 2, at: base + 5 * 3600_000 });
    assert.ok(first.built >= 1 && first.built <= 2);
    const second = narrative.weave({ maxThreads: 2, at: base + 6 * 3600_000 });
    assert.ok(second.built >= 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
