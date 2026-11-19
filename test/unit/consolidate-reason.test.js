import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function fakeLlm(reason) {
  return {
    available: () => true,
    complete: async () => null,
    lastFailure: () => reason,
  };
}

test('空回复要带 adapter 给出的原因', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reason-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } }, llm: fakeLlm('empty-text:length') });
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) cortex.write({ text: `用户：短 ${i}`, kind: 'utterance', title: `短 ${i}`, explicit: true, now });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.error, 'llm-empty:empty-text:length');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('重试也失败时标成 llm-empty-retry，而不是和一次就空混在一起', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reason-retry-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } }, llm: fakeLlm('finish-error') });
  try {
    const now = Date.now();
    for (let i = 0; i < 16; i += 1) {
      cortex.write({ text: `用户：长 ${i} ${'细节'.repeat(200)}`, kind: 'utterance', title: `长 ${i}`, explicit: true, now });
    }
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.error, 'llm-empty-retry:finish-error');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('health 按原因分桶统计空回复', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reason-health-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } }, llm: fakeLlm('exception') });
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) cortex.write({ text: `用户：样本 ${i}`, kind: 'utterance', title: `样本 ${i}`, explicit: true, now });
    for (let i = 0; i < 5; i += 1) await cortex.consolidation.run({ scopeId: 'global', force: true });
    const health = cortex.health({ scopeId: 'global' });
    const warn = health.issues.find((issue) => issue.code === 'LLM_EMPTY');
    assert.ok(warn, '应报 LLM_EMPTY');
    assert.equal(warn.detail?.count, 5);
    assert.equal(warn.detail?.buckets?.['llm-empty:exception'], 5);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter 抛异常时记 exception-outer，而不是裸 llm-empty', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reason-throw-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: { available: () => true, complete: async () => { throw new Error('boom'); } },
  });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：样本。', kind: 'utterance', title: '样本', explicit: true, now });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.error, 'llm-empty:exception-outer');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('一次调用的原因不会被另一次调用的失败覆盖', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reason-scope-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      // 模拟 adapter：先回调本次调用的 onReason，再把实例级的 lastFailure 改掉。
      complete: async (options) => {
        options?.onReason?.('empty-text:max-tokens');
        return null;
      },
      lastFailure: () => 'no-selection',
    },
  });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：样本。', kind: 'utterance', title: '样本', explicit: true, now });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.error, 'llm-empty:empty-text:max-tokens');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('巩固记账会记下是谁触发的，方便解释「一分钟两条」', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-caller-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：样本。', kind: 'utterance', title: '样本', explicit: true, now });
    await cortex.consolidation.run({ scopeId: 'global', force: true, caller: 'auto-trace-delta' });
    const row = cortex.db.prepare("SELECT detail_json FROM audit WHERE action = 'consolidation.run' ORDER BY at DESC LIMIT 1").get();
    assert.ok(row, '应有一条巩固审计');
    const detail = JSON.parse(row.detail_json);
    assert.equal(detail.caller, 'auto-trace-delta');
    assert.equal(detail.error, 'no-llm-adapter');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('整批都在保护线上时，仍允许 update（提示词排除 archive/merge）', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-all-protected-'));
  let seen = '';
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      complete: async (options) => {
        seen = String(options?.prompt ?? '');
        const id = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 1 })[0].id;
        return JSON.stringify([{ action: 'update', ids: [id], content: '更正后的内容' }]);
      },
    },
  });
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) cortex.write({ text: `用户：受保护样本 ${i}`, kind: 'utterance', title: `保护 ${i}`, importance: 0.95, explicit: true, now });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.match(seen, /本批全部在保护线上/, '提示词要说明只能 keep/update/conflict');
    assert.equal(result.applied.length, 1, '受保护批次里的 update 应该能落地');
    assert.equal(result.applied[0].action, 'update');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('被拒时错误里带上原因分布', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reject-note-'));
  let ids = [];
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: { available: () => true, complete: async () => JSON.stringify([{ action: 'archive', ids: [ids[0]] }]) },
  });
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) cortex.write({ text: `用户：样本 ${i}`, kind: 'utterance', title: `样本 ${i}`, importance: i === 2 ? 0.6 : 0.95, explicit: true, now });
    ids = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).map((trace) => trace.id);
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true, force: true });
    assert.match(String(result.run.error), /rejected 1（protected×1）/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test('invalid-json 分支也带 groups 记账', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-invalid-json-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: { available: () => true, complete: async () => '这不是 JSON' },
  });
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) cortex.write({ text: `用户：样本 ${i}`, kind: 'utterance', title: `样本 ${i}`, importance: 0.7, explicit: true, now });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.error, 'invalid-json');
    const audit = cortex.db.prepare("SELECT detail_json FROM audit WHERE action = 'consolidation.run' ORDER BY at DESC LIMIT 1").get();
    const detail = JSON.parse(audit.detail_json);
    assert.equal(typeof detail.groups, 'number');
    assert.equal(typeof detail.groupsDropped, 'number');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dedupe 同一批决策重跑会被 unchanged 跳过', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-dedupe-unchanged-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) cortex.write({ text: `用户：完全不同的样本 ${i} ${['鲸','潮','灯'][i]}`, kind: 'utterance', title: `样本 ${i}`, importance: 0.6, explicit: true, now });
    const first = await cortex.consolidation.dedupe({ scopeId: 'global', dryRun: false });
    assert.equal(first.decisions.length, 0);
    const second = await cortex.consolidation.dedupe({ scopeId: 'global', dryRun: false });
    assert.equal(second.skipped, 'unchanged');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
