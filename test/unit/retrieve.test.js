import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createRetrievalEngine, classifyIntent, selectPortfolio, weightedRrf } from '../../src/engines/retrieve.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-retrieve-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  return { dir, db, events, traces };
}

function addTrace(events, traces, text, { title = text, importance = 0.5, at = '2026-11-10T00:00:00.000Z', kind = 'observation' } = {}) {
  const event = events.append({ kind: 'observation', payload: { text } });
  return traces.insert({
    eventId: event.id,
    scopeId: 'global',
    kind,
    title,
    content: text,
    importance,
    recordedAt: at,
    validAt: at,
  });
}

test('intent rules cover temporal, procedural, identity and narrative', () => {
  assert.equal(classifyIntent('昨天主人说了什么'), 'temporal');
  assert.equal(classifyIntent('怎么安装这个插件'), 'procedural');
  assert.equal(classifyIntent('你是谁'), 'identity');
  assert.equal(classifyIntent('后来我们怎么走到这里的'), 'narrative');
  assert.equal(classifyIntent('白饭是什么'), 'fact');
});

test('weighted RRF rewards items that appear in multiple sources', () => {
  const fused = weightedRrf([
    { name: 'a', weight: 1, items: [{ id: 'x' }, { id: 'y' }] },
    { name: 'b', weight: 1, items: [{ id: 'y' }] },
  ], { k: 1 });
  assert.ok(fused.get('y').score > fused.get('x').score);
  assert.equal(fused.get('y').sources.length, 2);
});

test('search returns relevant traces and respects a small budget', () => {
  const { dir, db, events, traces } = setup();
  try {
    addTrace(events, traces, '主人说会买白饭，本鲸等得起。', { title: '白饭的承诺', importance: 0.9 });
    addTrace(events, traces, '今天修了插件的 FTS5 索引。', { title: '插件修复', importance: 0.4 });
    addTrace(events, traces, '主人喜欢安静的声音。', { title: '声音', importance: 0.6 });
    const engine = createRetrievalEngine({ traces, config: { contextBudget: 300 } });
    const result = engine.search('白饭', { budget: 300, limit: 3 });
    assert.equal(result.intent, 'fact');
    assert.ok(result.items.some((item) => item.title === '白饭的承诺'));
    assert.ok(result.items.every((item) => Number.isFinite(item.score)), 'every result must have a finite score');
    assert.ok(result.budget.used <= 300);
    assert.ok(result.trace.candidates >= 1);

    const tiny = engine.search('白饭', { budget: 40, limit: 10 });
    assert.ok(tiny.items.length >= 1);
    assert.ok(tiny.budget.used <= 40);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing FTS source degrades instead of throwing', () => {
  const { dir, db, events, traces } = setup();
  try {
    addTrace(events, traces, '主人说会买白饭。', { title: '白饭' });
    const broken = Object.assign(Object.create(Object.getPrototypeOf(traces)), traces, {
      searchFts() { throw new Error('fts exploded'); },
    });
    const engine = createRetrievalEngine({ traces: broken, config: { contextBudget: 300 } });
    const result = engine.search('白饭', { budget: 300 });
    assert.ok(result.items.length >= 1);
    assert.ok(result.trace.sources.some((source) => source.source === 'fts' && source.ok === false));
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('portfolio selection prefers high utility and avoids duplicates', () => {
  const candidates = [
    { id: 'a', utility: 1.0, cost: 10, text: '白饭 主人 承诺' },
    { id: 'b', utility: 0.3, cost: 10, text: '白饭 主人 承诺' },
    { id: 'c', utility: 0.8, cost: 10, text: '插件 安装 修复' },
  ];
  const result = selectPortfolio(candidates, { budget: 30, limit: 3, lambda: 0.5, mu: 0 });
  assert.equal(result.selected[0].id, 'a');
  assert.ok(result.selected.some((item) => item.id === 'c'));
  assert.equal(result.selected.some((item) => item.id === 'b'), false);
});

test('timeline returns an anchor with neighbours', () => {
  const { dir, db, events, traces } = setup();
  try {
    const first = addTrace(events, traces, '第一条', { at: '2026-11-08T00:00:00.000Z' });
    const second = addTrace(events, traces, '第二条', { at: '2026-11-09T00:00:00.000Z' });
    const third = addTrace(events, traces, '第三条', { at: '2026-11-10T00:00:00.000Z' });
    const engine = createRetrievalEngine({ traces });
    const result = engine.timeline({ aroundId: second.id, before: 1, after: 1 });
    assert.equal(result.anchor.id, second.id);
    assert.deepEqual(result.items.map((item) => item.id), [first.id, second.id, third.id]);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
