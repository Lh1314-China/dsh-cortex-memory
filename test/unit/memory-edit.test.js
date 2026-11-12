import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-edit-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { autoFacts: false, llmFacts: false } },
  });
  return { dir, cortex };
}

test('memory day view groups emotion and work; editing is locked by default', () => {
  const { dir, cortex } = setup();
  try {
    const at = '2026-11-12T03:00:00.000Z';
    const written = cortex.write({ text: '今天完成记忆查询面板。', title: '面板测试', explicit: true, recordedAt: at, importance: 0.8 });
    cortex.emotion.record({ text: '本鲸觉得安心。', target: '主人', at });
    const day = cortex.memoryDay({ date: '2026-11-12' });
    assert.equal(day.counts.traces, 1);
    assert.equal(day.counts.emotion, 1);
    assert.equal(day.work.traces[0].id, written.trace.id);
    assert.equal(cortex.memoryEditState().enabled, false);
    assert.throws(() => cortex.updateMemoryTrace({ id: written.trace.id, title: '不能改' }), /locked/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('summon cards are built for left/right brain and can be edited after unlock', () => {
  const { dir, cortex } = setup();
  try {
    const at = '2026-11-12T03:00:00.000Z';
    cortex.write({ text: '今天完成了召唤册。', title: '召唤册', kind: 'decision', explicit: true, recordedAt: at, importance: 0.9 });
    cortex.emotion.record({ text: '本鲸觉得安心。', target: '主人', at });
    const built = cortex.rebuildSummonBook();
    assert.ok(built.cards >= 2);
    const book = cortex.summonBook({ date: '2026-11-12' });
    assert.ok(book.left.length >= 1);
    assert.ok(book.right.length >= 1);
    assert.ok(book.volumes.length >= 1);
    const card = book.left[0];
    assert.throws(() => cortex.updateSummonCard({ id: card.id, title: '不能改' }), /locked/);
    cortex.setMemoryEdit(true);
    const updated = cortex.updateSummonCard({ id: card.id, title: '改过的召唤卡' });
    assert.equal(updated.title, '改过的召唤卡');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manual card edits survive a rebuild and cards can be matched by a specific phrase', () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '白饭约定：以后要一起买白饭。', title: '白饭约定', kind: 'decision', explicit: true, importance: 0.95 });
    cortex.rebuildSummonBook();
    const first = cortex.summonBook({ date: new Date().toLocaleDateString('en-CA') });
    const card = first.right.find((item) => item.title.includes('白饭')) ?? first.right[0];
    assert.ok(card);
    cortex.setMemoryEdit(true);
    cortex.updateSummonCard({ id: card.id, title: '主人改过的白饭卡' });
    cortex.rebuildSummonBook();
    const second = cortex.summonBook({ date: new Date().toLocaleDateString('en-CA') });
    assert.equal(second.right.find((item) => item.id === card.id).title, '主人改过的白饭卡');
    const match = cortex.matchSummonCards({ text: '你还记得白饭约定吗？' });
    assert.ok(match.cards.length >= 1);
    assert.match(match.block, /召唤卡/);
    const feedback = cortex.feedbackSummonCard({ id: card.id, signal: 'helpful' });
    assert.equal(feedback.signal, 'helpful');
    assert.ok(feedback.feedback || feedback.sourceKind !== 'trace');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reviewIntentions creates a pending intention when none are triggered', () => {
  const { dir, cortex } = setup();
  try {
    const result = cortex.reviewIntentions({ at: Date.parse('2026-11-12T08:00:00.000Z') });
    assert.ok(result.intentions.length >= 1);
    assert.equal(result.intentions[0].kind, 'question');
    assert.ok(cortex.self().intentions.some((item) => item.payload?.topic === '1.5h-review'));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unlocking memory edit allows trace edits and audits them', () => {
  const { dir, cortex } = setup();
  try {
    const at = '2026-11-12T03:00:00.000Z';
    const written = cortex.write({ text: '旧正文', title: '旧标题', explicit: true, recordedAt: at });
    cortex.setMemoryEdit(true);
    const updated = cortex.updateMemoryTrace({ id: written.trace.id, title: '新标题', content: '新正文', tags: ['手动', '编辑'] });
    assert.equal(updated.title, '新标题');
    assert.equal(updated.content, '新正文');
    assert.deepEqual(updated.tags, ['手动', '编辑']);
    const audit = cortex.repos.audit.list({ limit: 20 });
    assert.ok(audit.some((entry) => entry.action === 'memory.trace.edit'));
    cortex.setMemoryEdit(false);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
