import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createWorkingStore, createGoalStore, renderWorkingMemory } from '../../src/self/working.js';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-working-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db, working: createWorkingStore(db), goals: createGoalStore(db) };
}

test('working memory orders pinned/high-priority and purges expired', () => {
  const { dir, db, working } = setup();
  try {
    const now = Date.parse('2026-11-11T12:00:00+08:00');
    const a = working.add({ text: '普通焦点', priority: 0.3, at: now });
    const b = working.add({ text: '重要焦点', priority: 0.9, at: now });
    const c = working.add({ text: '置顶焦点', priority: 0.1, pinned: true, at: now });
    const expired = working.add({ text: '会过期的焦点', priority: 1, ttlMs: 1000, at: now });
    const list = working.list({ at: now + 500 });
    assert.equal(list[0].id, c.id);
    assert.ok(list.some((item) => item.id === b.id));
    assert.equal(working.list({ at: now + 2000 }).some((item) => item.id === expired.id), false);
    assert.equal(working.purgeExpired({ at: now + 2000 }), 1);
    assert.equal(working.remove(a.id), true);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a near-duplicate working item refreshes instead of piling up', () => {
  const { dir, db, working } = setup();
  try {
    const now = Date.parse('2026-11-15T12:00:00+08:00');
    const first = working.add({ text: '创造模式待办：①鱼塘 caps 放开；②shiori 残留清理', priority: 0.6, at: now });
    const second = working.add({ text: '创造模式待办：①鱼塘 caps 放开；②shiori 残留清理。', priority: 0.9, at: now + 1000 });
    assert.equal(second.id, first.id, 'the same todo must not be stored twice');
    assert.equal(working.list({ at: now + 2000 }).length, 1);
    assert.equal(working.get(first.id).priority, 0.9, 'priority is refreshed to the higher value');
    const distinct = working.add({ text: '完全不同的另一件事：给 agency 加抑制实验。', priority: 0.5, at: now + 2000 });
    assert.notEqual(distinct.id, first.id);
    const forced = working.add({ text: '创造模式待办：①鱼塘 caps 放开；②shiori 残留清理', priority: 0.4, at: now + 3000, dedupe: false });
    assert.notEqual(forced.id, first.id, 'dedupe:false still allows an explicit duplicate');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('working memory render respects the token budget', () => {
  const { dir, db, working } = setup();
  try {
    for (let i = 0; i < 10; i += 1) working.add({ text: `第 ${i} 条比较长的焦点内容，用来测试预算裁剪。`, priority: 0.5 });
    const rendered = renderWorkingMemory(working.list(), { budgetTokens: 40 });
    assert.ok(rendered.used <= 40);
    assert.ok(rendered.count >= 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('goals can be added, progressed and completed', () => {
  const { dir, db, goals } = setup();
  try {
    const goal = goals.add({ title: '把 cortex 写到 30k 行', priority: 0.8 });
    assert.equal(goal.status, 'active');
    const updated = goals.update(goal.id, { progress: 0.4, description: '继续写模块' });
    assert.equal(updated.progress, 0.4);
    const done = goals.complete(goal.id);
    assert.equal(done.status, 'completed');
    assert.equal(done.progress, 1);
    assert.equal(goals.list({ status: 'active' }).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('service self shows working memory and active goals', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-working-service-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.working.add({ text: '当前焦点：写模块' });
    cortex.goals.add({ title: '完成 30k 行' });
    const snapshot = cortex.self();
    assert.ok(snapshot.working.some((item) => item.text.includes('写模块')));
    assert.ok(snapshot.goals.some((item) => item.title.includes('30k')));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
