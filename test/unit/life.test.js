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

test('web sources are passed into AI diary generation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-diary-web-'));
  let seenWeb = '';
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { webSearch: true } },
    llm: {
      dream: async () => null,
      diary: async (args) => { seenWeb = args.web; return '今天本鲸从一份外部资料里看见了一点新东西。'; },
      feeling: async () => null,
    },
    webSearch: async () => ({
      sources: [{ title: 'Source A', url: 'https://example.com/a', snippet: 'A snippet' }],
    }),
  });
  try {
    cortex.write({ text: '今天研究联网日记。', explicit: true, importance: 0.8 });
    const entry = await cortex.life.diaryGenerate({ at: Date.parse('2026-11-12T13:00:00+08:00') });
    assert.match(seenWeb, /example\.com\/a/);
    assert.equal(entry.webSources?.[0]?.url, 'https://example.com/a');
    assert.match(entry.text, /https:\/\/example\.com\/a/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diary generation is written by the configured AI, with a labeled fallback', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-diary-ai-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') },
    llm: {
      dream: async () => null,
      diary: async () => '今天本鲸把检索和梦都重新摸了一遍，心里慢慢安静下来。',
    },
  });
  try {
    cortex.write({ text: '今天把日记生成接上。', explicit: true, importance: 0.8 });
    const entry = await cortex.life.diaryGenerate({ at: Date.parse('2026-11-12T12:00:00+08:00') });
    assert.equal(entry.model, 'llm');
    assert.equal(entry.source, 'cortex:llm');
    assert.match(entry.text, /本鲸/);
    assert.equal(cortex.life.diaryList()[0].source, 'cortex:llm');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feeling generation records AI-chosen emotion labels and affect', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-feeling-ai-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') },
    llm: {
      dream: async () => null,
      diary: async () => null,
      feeling: async () => ({
        text: '本鲸现在有一点安心，也有一点期待。',
        emotions: [{ name: '安', score: 2 }, { name: '盼', score: 1 }],
        target: '主人',
      }),
    },
  });
  try {
    cortex.write({ text: '今天把自动感受接上了。', explicit: true, importance: 0.8 });
    const feeling = await cortex.life.feelingGenerate({ at: Date.parse('2026-11-12T13:00:00+08:00') });
    assert.equal(feeling.model, 'llm');
    assert.deepEqual(feeling.emotions.map((item) => item.name), ['安', '盼']);
    assert.ok(cortex.emotion.events({ limit: 5 }).some((event) => event.text.includes('安心')));
    assert.match(cortex.emotion.text(), /安/);
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

test('dream generation dedupes identical dreams inside five seconds', async () => {
  const { dir, cortex } = setup();
  try {
    const at = Date.parse('2026-11-11T20:00:00+08:00');
    const first = await cortex.life.dreamGenerate({ at });
    const second = await cortex.life.dreamGenerate({ at: at + 1000 });
    assert.equal(second.id, first.id);
    assert.equal(cortex.life.dreamList().length, 1);

    const later = await cortex.life.dreamGenerate({ at: at + 6 * 1000 });
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
