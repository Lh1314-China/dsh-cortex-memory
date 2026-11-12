import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createEntityRepository } from '../../src/store/repositories/entities.js';
import { createFactRepository } from '../../src/store/repositories/facts.js';
import { createFeedbackRepository } from '../../src/store/repositories/feedback.js';
import { createSummaryRepository } from '../../src/store/repositories/summaries.js';
import { createSelfStore } from '../../src/self/state.js';
import { createRelationshipStore } from '../../src/self/relationship.js';
import { createEncodeEngine } from '../../src/engines/encode.js';
import { createGrowthEngine } from '../../src/engines/growth.js';
import { createReflectEngine } from '../../src/engines/reflect.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-growth-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const entities = createEntityRepository(db);
  const facts = createFactRepository(db);
  const feedback = createFeedbackRepository(db);
  const summaries = createSummaryRepository(db);
  const selfStore = createSelfStore(db);
  const relationshipStore = createRelationshipStore(db);
  const encode = createEncodeEngine({ events, traces, entities, facts, config: { minCompressionValue: 0.01 } });
  const growth = createGrowthEngine({ traces, feedback, selfStore, relationshipStore });
  const reflect = createReflectEngine({ traces, summaries, encode });
  return { dir, db, events, traces, feedback, summaries, selfStore, relationshipStore, encode, growth, reflect };
}

function add(encode, text, now) {
  return encode.encode({ text, explicit: true, now }).trace;
}

test('positive feedback raises stability and confidence', () => {
  const { dir, db, encode, traces, growth, selfStore } = setup();
  try {
    const trace = add(encode, '用户说会买白饭，助手很开心。', Date.parse('2026-11-11T12:00:00+08:00'));
    const before = traces.get(trace.id);
    const result = growth.applyFeedback({ traceId: trace.id, signal: 'helpful', predicted: 0.8, now: Date.parse('2026-11-11T13:00:00+08:00') });
    assert.ok(result.trace.stability > before.stability);
    assert.ok(result.trace.confidence > before.confidence);
    assert.equal(result.grade, 4);
    assert.ok(result.self.drives.care > 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('negative feedback lowers confidence and adds a lapse', () => {
  const { dir, db, encode, traces, growth } = setup();
  try {
    const trace = add(encode, '用户今天很开心。', Date.parse('2026-11-11T12:00:00+08:00'));
    const before = traces.get(trace.id);
    const result = growth.applyFeedback({ traceId: trace.id, signal: 'incorrect', predicted: 0.8, now: Date.parse('2026-11-11T13:00:00+08:00') });
    assert.ok(result.trace.stability < before.stability);
    assert.ok(result.trace.confidence < before.confidence);
    assert.equal(result.trace.lapseCount, 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('calibration computes Brier and ECE from feedback', () => {
  const { dir, db, encode, growth } = setup();
  try {
    const a = add(encode, '第一条测试记忆。');
    const b = add(encode, '第二条测试记忆。');
    growth.applyFeedback({ traceId: a.id, signal: 'helpful', predicted: 0.9 });
    growth.applyFeedback({ traceId: b.id, signal: 'incorrect', predicted: 0.8 });
    const cal = growth.calibration();
    assert.equal(cal.n, 2);
    assert.ok(cal.brier > 0 && cal.brier < 1);
    assert.equal(cal.accuracy, 0.5);
    assert.ok(cal.ece >= 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reflection creates a summary and a reflective trace, then de-duplicates', () => {
  const { dir, db, encode, reflect, summaries } = setup();
  try {
    const now = Date.parse('2026-11-11T20:00:00+08:00');
    add(encode, '今天修好了检索的预算裁剪。', now - 3 * 3600_000);
    add(encode, '用户说白饭的承诺还算数。', now - 2 * 3600_000);
    add(encode, '助手发现自己有点焦虑，但还能继续。', now - 3600_000);
    const result = reflect.reflect({ now, windowDays: 1 });
    assert.equal(result.skipped, false);
    assert.ok(result.summary.content.includes('记住了'));
    assert.equal(result.trace.kind, 'reflection');
    assert.ok(result.coverage > 0 && result.coverage <= 1);
    assert.equal(summaries.list().length, 1);
    const again = reflect.reflect({ now, windowDays: 1 });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, 'already-reflected');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reflection needs at least two traces', () => {
  const { dir, db, encode, reflect } = setup();
  try {
    add(encode, '只有一条记忆。');
    const result = reflect.reflect({ now: Date.parse('2026-11-11T20:00:00+08:00') });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not-enough-traces');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
