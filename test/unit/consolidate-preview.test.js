import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup(complete) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-preview-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: { available: () => true, complete },
  });
  return { dir, cortex };
}

test('预演不占候选位，同一批真跑时不会被幂等门挡掉', async () => {
  let calls = 0;
  const { dir, cortex } = setup(async () => {
    calls += 1;
    return '[]';
  });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：低甲碎片。', kind: 'utterance', title: '低甲', importance: 0.3, explicit: true, now });
    cortex.write({ text: '用户：低乙碎片。', kind: 'utterance', title: '低乙', importance: 0.35, explicit: true, now: now + 1000 });
    cortex.write({ text: '用户：中丙碎片。', kind: 'utterance', title: '中丙', importance: 0.4, explicit: true, now: now + 2000 });
    cortex.write({ text: '用户：中丁碎片。', kind: 'utterance', title: '中丁', importance: 0.45, explicit: true, now: now + 3000 });
    const preview = await cortex.consolidation.run({ scopeId: 'global', limit: 2, dryRun: true });
    assert.equal(calls, 1);
    assert.deepEqual(preview.run.input.map((item) => item.title), ['低甲', '低乙']);
    const real = await cortex.consolidation.run({ scopeId: 'global', limit: 2 });
    assert.equal(calls, 2, '预演过的同一批，真跑时仍应问模型');
    assert.notEqual(real.skipped, 'unchanged', '预演行不该让真跑变成 unchanged');
    assert.deepEqual(real.run.input.map((item) => item.title), ['低甲', '低乙'], '预演不该把候选挤走');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('提示词要求 merge 的 ids 至少两条', async () => {
  let seen = '';
  const { dir, cortex } = setup(async (options) => {
    seen = `${options?.system ?? ''}\n${options?.prompt ?? ''}`;
    return '[]';
  });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：重复样本甲，今天在图书馆看了超时空辉夜姬第三集，很好笑。', kind: 'utterance', title: '重复甲', importance: 0.6, explicit: true, now });
    cortex.write({ text: '用户：重复样本乙，今天在图书馆看了超时空辉夜姬第三集，特别好笑。', kind: 'utterance', title: '重复乙', importance: 0.6, explicit: true, now: now + 1000 });
    await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.match(seen, /merge 的 ids 至少两条/);
    assert.match(seen, /targetId 必须是 ids 里的一条/);
    assert.match(seen, /只带一条 id 的 merge 会被拒绝/);
    assert.match(seen, /merge 必须一次给出所有参与合并的 ids/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dedupe 候选优先低重要度（重复更可能藏在那里）', async () => {
  const { dir, cortex } = setup(async () => '[]');
  try {
    const now = Date.now();
    cortex.write({ text: '用户：低一碎片。', kind: 'utterance', title: '低一', importance: 0.3, explicit: true, now });
    cortex.write({ text: '用户：低二碎片。', kind: 'utterance', title: '低二', importance: 0.35, explicit: true, now: now + 1000 });
    cortex.write({ text: '用户：高三重要。', kind: 'utterance', title: '高三', importance: 0.9, explicit: true, now: now + 2000 });
    cortex.write({ text: '用户：高四重要。', kind: 'utterance', title: '高四', importance: 0.95, explicit: true, now: now + 3000 });
    cortex.write({ text: '用户：高五重要。', kind: 'utterance', title: '高五', importance: 1.0, explicit: true, now: now + 4000 });
    const result = await cortex.consolidation.dedupe({ scopeId: 'global', limit: 2, dryRun: true });
    assert.deepEqual(result.run.input.map((item) => item.title), ['低一', '低二']);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('没有 LLM 时的 skipped 行不会挡住 LLM 接上后的真跑', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-preview-nollm-'));
  const dbFile = path.join(dir, 'cortex.sqlite');
  const now = Date.now();
  const first = createCortex({ config: { dataRoot: dir, dbFile } });
  try {
    first.write({ text: '用户：样本甲。', kind: 'utterance', title: '样本甲', explicit: true, now });
    first.write({ text: '用户：样本乙。', kind: 'utterance', title: '样本乙', explicit: true, now: now + 1000 });
    first.write({ text: '用户：样本丙。', kind: 'utterance', title: '样本丙', explicit: true, now: now + 2000 });
    const skipped = await first.consolidation.run({ scopeId: 'global' });
    assert.equal(skipped.run.status, 'skipped');
    assert.equal(skipped.run.error, 'no-llm-adapter');
  } finally {
    first.close();
  }
  let calls = 0;
  const second = createCortex({
    config: { dataRoot: dir, dbFile, features: { llm: true } },
    llm: { available: () => true, complete: async () => { calls += 1; return '[]'; } },
  });
  try {
    const real = await second.consolidation.run({ scopeId: 'global' });
    assert.equal(calls, 1, 'LLM 接上后应真跑，而不是被 skipped 行挡成 unchanged');
    assert.notEqual(real.skipped, 'unchanged');
  } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dedupe 的预演不挡真去重', async () => {
  const { dir, cortex } = setup(async () => '[]');
  try {
    const now = Date.now();
    cortex.write({ text: '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。', kind: 'utterance', title: '重复甲', importance: 0.6, explicit: true, now });
    cortex.write({ text: '用户：今天在图书馆看了超时空辉夜姬第三集，特别好笑。', kind: 'utterance', title: '重复乙', importance: 0.6, explicit: true, now: now + 1000 });
    const dry = await cortex.consolidation.dedupe({ scopeId: 'global', threshold: 0.6, dryRun: true });
    assert.equal(dry.run.status, 'preview');
    const real = await cortex.consolidation.dedupe({ scopeId: 'global', threshold: 0.6, dryRun: false });
    assert.notEqual(real.skipped, 'unchanged', '预演不该挡真去重');
    assert.ok(real.applied.length >= 1, '真去重应归档一条');
    const archived = cortex.db.prepare("SELECT COUNT(*) AS c FROM traces WHERE scope_id = 'global' AND state = 'archived'").get().c;
    assert.ok(archived >= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dedupe 的采样能覆盖到高重要度那半', async () => {
  const { dir, cortex } = setup(async () => '[]');
  try {
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) {
      cortex.write({ text: `用户：低样本 ${i}。`, kind: 'utterance', title: `低${i}`, importance: 0.2 + i * 0.01, explicit: true, now: now + i * 100 });
    }
    for (let i = 0; i < 6; i += 1) {
      cortex.write({ text: `用户：高样本 ${i}。`, kind: 'utterance', title: `高${i}`, importance: 0.9 + i * 0.01, explicit: true, now: now + 1000 + i * 100 });
    }
    const result = await cortex.consolidation.dedupe({ scopeId: 'global', limit: 4, dryRun: true });
    const titles = result.run.input.map((item) => item.title);
    assert.equal(titles.length, 4);
    assert.ok(titles.some((title) => title.startsWith('高')), '高重要度一半也要被采样到');
    assert.ok(titles.some((title) => title.startsWith('低')), '低重要度一半仍优先');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('深整理用跨重要度采样，不会整批落在同一档', async () => {
  const { dir, cortex } = setup(async () => '[]');
  try {
    const now = Date.now();
    for (let i = 0; i < 8; i += 1) {
      cortex.write({ text: `用户：低档痕迹 ${i}。`, kind: 'utterance', title: `低${i}`, importance: 0.2 + i * 0.01, explicit: true, now: now + i * 100 });
    }
    for (let i = 0; i < 8; i += 1) {
      cortex.write({ text: `用户：高档痕迹 ${i}。`, kind: 'utterance', title: `高${i}`, importance: 0.9 + i * 0.01, explicit: true, now: now + 1000 + i * 100 });
    }
    const result = await cortex.consolidation.run({ scopeId: 'global', spread: true, limit: 8, force: true });
    const levels = result.run.input.map((item) => Number(item.importance));
    assert.ok(levels.some((value) => value < 0.5), '低档应有一半');
    assert.ok(levels.some((value) => value >= 0.9), '高档也应被采样到');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
