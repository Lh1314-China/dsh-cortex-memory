import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

const PAIR = [
  '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。',
  '用户：今天在图书馆看了超时空辉夜姬第三集，特别好笑。',
];

function setup(importances = [0.6, 0.55]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-dedupe-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { cortex, dir };
}

test('确定性去重：预演只报可合并组，不动库', async () => {
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    PAIR.forEach((text, i) => cortex.write({ text, kind: 'utterance', title: `辉夜姬 ${i}`, importance: 0.6, explicit: true, now }));
    const result = await cortex.consolidation.dedupe({ scopeId: 'global', dryRun: true, threshold: 0.7 });
    assert.equal(result.decisions.length, 1, '应识别出一组');
    assert.equal(result.applied.length, 0);
    assert.equal(result.run.model, 'dedupe');
    const active = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
    assert.equal(active.length, 2, '预演不能改库');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('确定性去重：真跑会把低重要度那条归档，并留合并摘要', async () => {
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    PAIR.forEach((text, i) => cortex.write({ text, kind: 'utterance', title: `辉夜姬 ${i}`, importance: 0.6, explicit: true, now }));
    const result = await cortex.consolidation.dedupe({ scopeId: 'global', dryRun: false, threshold: 0.7 });
    assert.equal(result.applied.length, 1);
    const active = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
    assert.equal(active.length, 1, '重复的两条应合成一条');
    const archived = cortex.repos.traces.list({ scopeId: 'global', state: 'archived', limit: 10 });
    assert.equal(archived.length, 1);
    assert.equal(archived[0].compression, 'merged');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('保护线上的近重复仍可合并（活库里 75% 都在线上）', async () => {
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    PAIR.forEach((text, i) => cortex.write({ text, kind: 'utterance', title: `辉夜姬 ${i}`, importance: 0.95, explicit: true, now }));
    const result = await cortex.consolidation.dedupe({ scopeId: 'global', dryRun: false, threshold: 0.7 });
    assert.equal(result.applied.length, 1, '近乎相同的两条不该因为都在保护线上就永久并存');
    assert.equal(result.decisions.length, 1);
    const active = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
    assert.equal(active.length, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reflection 不参与去重（既不当来源也不被合并）', async () => {
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    cortex.write({ text: '今天在图书馆看了超时空辉夜姬第三集，很好笑。', kind: 'reflection', title: '反思', importance: 0.5, explicit: true, now });
    cortex.write({ text: '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。', kind: 'utterance', title: '辉夜姬', importance: 0.5, explicit: true, now });
    const result = await cortex.consolidation.dedupe({ scopeId: 'global', dryRun: false, threshold: 0.6 });
    assert.equal(result.applied.length, 0, '单独一条 utterance 没有同伙，不该合并');
    const active = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
    assert.equal(active.length, 2, 'reflection 与普通痕迹都还在');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LLM 想把 reflection 当来源 merge 时会被拒', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-dedupe-v-'));
  let reflexId = null;
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      complete: async () => {
        const ids = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).sort((a, b) => Number(b.importance) - Number(a.importance));
        return JSON.stringify([{ action: 'merge', ids: ids.map((t) => t.id), targetId: ids[0].id }]);
      },
    },
  });
  try {
    const now = Date.now();
    reflexId = cortex.write({ text: '我想：一条低重要度的反思。', kind: 'reflection', title: '反思', importance: 0.5, explicit: true, now });
    cortex.write({ text: '用户：另一条普通痕迹。', kind: 'utterance', title: '普通', importance: 0.6, explicit: true, now });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.applied.length, 0, '不应真的合并');
    assert.match(String(result.run.error), /rejected 1|rejected 2/);
    const still = cortex.repos.traces.get(String(reflexId?.trace?.id ?? reflexId));
    assert.notEqual(still?.state, 'archived');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LLM 路线仍不允许把受保护的痕迹当 merge 来源', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-llm-protect-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      complete: async () => {
        const list = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
        return JSON.stringify([{ action: 'merge', ids: list.map((t) => t.id), targetId: list[0].id }]);
      },
    },
  });
  try {
    const now = Date.now();
    for (let i = 0; i < 2; i += 1) cortex.write({ text: `用户：受保护样本 ${i}`, kind: 'utterance', title: `保护 ${i}`, importance: 0.97, explicit: true, now });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.applied.length, 0, 'LLM 不能合受保护的痕迹');
    const active = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
    assert.equal(active.length, 2);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('被归档的条目，与 target 的相似度必须仍然达标（防链式误合）', async () => {
  const shingles = (value) => {
    const flat = String(value ?? '').replace(/\s+/g, '');
    const set = new Set();
    for (let i = 0; i + 2 <= flat.length; i += 1) set.add(flat.slice(i, i + 2));
    return set;
  };
  const jaccard = (a, b) => {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const g of a) if (b.has(g)) shared += 1;
    return shared / (a.size + b.size - shared);
  };
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    const texts = [
      '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。',
      '用户：今天在图书馆看了超时空辉夜姬第三集，特别好笑。',
      '用户：今天在图书馆看了超时空辉夜姬第三集，非常好笑。',
      '用户：今天下雨了，路上很挤，回家吃了米饭。',
    ];
    texts.forEach((text, i) => cortex.write({ text, kind: 'utterance', title: `样本 ${i}`, importance: 1.0 - i * 0.01, explicit: true, now }));
    const threshold = 0.7;
    await cortex.consolidation.dedupe({ scopeId: 'global', dryRun: false, threshold });
    const active = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 20 });
    const archived = cortex.repos.traces.list({ scopeId: 'global', state: 'archived', limit: 20 });
    for (const loser of archived) {
      const target = active.find((trace) => jaccard(shingles(loser.content), shingles(trace.content)) >= threshold);
      assert.ok(target, `归档的 ${loser.title} 必须仍与某条 active 达标相似`);
    }
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
