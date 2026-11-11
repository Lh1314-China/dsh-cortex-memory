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
