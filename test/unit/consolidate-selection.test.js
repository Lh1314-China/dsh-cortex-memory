import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup(complete) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-selection-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: { available: () => true, complete },
  });
  return { dir, cortex };
}

test('候选优先挑低重要度痕迹，高重要度沉底', async () => {
  const { dir, cortex } = setup(async () => JSON.stringify([{ action: 'keep', ids: [] }]));
  try {
    const now = Date.now();
    cortex.write({ text: '用户：高重要度身份记忆。', kind: 'utterance', title: '高', importance: 0.95, explicit: true, now });
    cortex.write({ text: '用户：低重要度碎片甲。', kind: 'utterance', title: '低甲', importance: 0.3, explicit: true, now: now + 1000 });
    cortex.write({ text: '用户：中低重要度碎片乙。', kind: 'utterance', title: '低乙', importance: 0.5, explicit: true, now: now + 2000 });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    const input = result.run.input;
    assert.equal(input[0].title, '低甲', '最低重要度先问');
    assert.equal(input.at(-1).title, '高', '高重要度沉到最后');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('已被摘要覆盖的痕迹排在未覆盖之后', async () => {
  const { dir, cortex } = setup(async () => JSON.stringify([{ action: 'keep', ids: [] }]));
  try {
    const now = Date.now();
    cortex.write({ text: '用户：已经被总结过的一条。', kind: 'utterance', title: '已覆盖', importance: 0.3, explicit: true, now });
    cortex.write({ text: '用户：还没被总结的一条。', kind: 'utterance', title: '未覆盖', importance: 0.3, explicit: true, now: now + 2000 });
    const list = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
    const covered = list.find((trace) => trace.title === '已覆盖');
    cortex.repos.summaries.insert({ scopeId: 'global', level: 'episode', content: '一条旧摘要', sourceIds: [covered.id], coverage: 1 });
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.input[0].title, '未覆盖');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('输入完全相同的第二次运行不再调用模型，也不写新行', async () => {
  let calls = 0;
  let traceId = null;
  const { dir, cortex } = setup(async () => {
    calls += 1;
    return JSON.stringify([{ action: 'keep', ids: traceId ? [traceId] : [] }]);
  });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：同一批里的一条。', kind: 'utterance', explicit: true, now });
    traceId = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 1 })[0].id;
    const first = await cortex.consolidation.run({ scopeId: 'global' });
    assert.equal(calls, 1);
    assert.equal(first.run.status, 'applied');
    const second = await cortex.consolidation.run({ scopeId: 'global' });
    assert.equal(second.skipped, 'unchanged', '同样的输入应直接复用上一次结果');
    assert.equal(calls, 1, '不该再问一次模型');
    assert.equal(cortex.consolidation.list({ scopeId: 'global', limit: 10 }).length, 1, '不该多写一行');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejected 的同一批输入仍允许重试', async () => {
  let calls = 0;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-selection-retry-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      // 第一次返回没有 ids 的决策（会被判 rejected），第二次正常 keep。
      complete: async () => {
        calls += 1;
        return calls === 1
          ? JSON.stringify([{ action: 'archive' }, { action: 'keep' }])
          : JSON.stringify([{ action: 'keep', ids: [] }]);
      },
    },
  });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：会被坏模型回答的一条。', kind: 'utterance', explicit: true, now });
    const first = await cortex.consolidation.run({ scopeId: 'global' });
    assert.equal(first.run.status, 'rejected');
    const second = await cortex.consolidation.run({ scopeId: 'global' });
    assert.equal(calls, 2, 'rejected 说明模型坏了，应允许重试');
    assert.notEqual(second.skipped, 'unchanged');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
