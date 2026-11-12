import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-life-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('diary entries can be written, listed and forgotten', () => {
  const { dir, cortex } = setup();
  try {
    const entry = cortex.life.diaryWrite({ text: '今天把守护模块接上了。', mood: '踏实' });
    assert.ok(entry.id);
    assert.equal(cortex.life.diaryList()[0].id, entry.id);
    assert.equal(cortex.life.diaryForget(entry.id), true);
    assert.equal(cortex.life.diaryList().length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dream generation uses recent memories and falls back to template', async () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '今天修好了图检索。', explicit: true, importance: 0.9, now: Date.parse('2026-11-11T12:00:00+08:00') });
    const dream = await cortex.life.dreamGenerate({ at: Date.parse('2026-11-11T20:00:00+08:00') });
    assert.ok(dream.text.length > 0);
    assert.equal(dream.model, 'template');
    assert.ok(cortex.life.dreamList().length >= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dream generation dedupes identical dreams inside ten minutes', async () => {
  const { dir, cortex } = setup();
  try {
    const at = Date.parse('2026-11-11T20:00:00+08:00');
    const first = await cortex.life.dreamGenerate({ at });
    const second = await cortex.life.dreamGenerate({ at: at + 1000 });
    assert.equal(second.id, first.id);
    assert.equal(cortex.life.dreamList().length, 1);

    const later = await cortex.life.dreamGenerate({ at: at + 11 * 60 * 1000 });
    assert.notEqual(later.id, first.id);
    assert.equal(cortex.life.dreamList().length, 2);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sleep runs consolidation and records a report', async () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '第一条记忆。', explicit: true });
    cortex.write({ text: '第二条记忆。', explicit: true });
    cortex.working.add({ text: '会过期的焦点', ttlMs: 1, at: Date.now() - 1000 });
    const report = await cortex.life.sleep({ at: Date.now() });
    assert.ok(report.id);
    assert.ok(report.purgedWorking >= 1);
    assert.ok(cortex.life.sleepRuns().length >= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
