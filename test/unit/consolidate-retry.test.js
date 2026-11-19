import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('提示词过长时先失败，会自动用精简候选重试一次并打上 -retry', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-retry-'));
  let calls = 0;
  const prompts = [];
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      complete: async ({ prompt }) => {
        calls += 1;
        prompts.push(String(prompt).length);
        if (calls === 1) return null;
        const id = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 1 })[0].id;
        return JSON.stringify([{ action: 'keep', ids: [id], reason: 'retry-ok' }]);
      },
    },
  });
  try {
    const now = Date.now();
    for (let i = 0; i < 16; i += 1) {
      cortex.write({ text: `用户：第 ${i} 条很长的日志，${'细节'.repeat(200)}`, kind: 'utterance', title: `长样本 ${i}`, explicit: true, now });
    }
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(calls, 2, '应该调用两次：一次原始、一次精简');
    assert.ok(prompts[1] < prompts[0], '重试的提示词必须更短');
    assert.equal(result.run.status, 'applied');
    assert.match(String(result.run.model), /-retry$/, '成功的重试要打标记');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('短提示词失败时不重试，直接记 llm-empty', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-noretry-'));
  let calls = 0;
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: { available: () => true, complete: async () => { calls += 1; return null; } },
  });
  try {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      cortex.write({ text: `用户：短 ${i}`, kind: 'utterance', title: `短 ${i}`, explicit: true, now });
    }
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(calls, 1, '短输入不该重试');
    assert.equal(result.run.error, 'llm-empty');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('大候选先用精简预算一次成功，并标 -bounded', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-bounded-'));
  let calls = 0;
  let maxTokensSeen = 0;
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: {
      available: () => true,
      complete: async (options) => {
        calls += 1;
        maxTokensSeen = options?.maxTokens ?? 0;
        const id = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 1 })[0].id;
        return JSON.stringify([{ action: 'keep', ids: [id] }]);
      },
    },
  });
  try {
    const now = Date.now();
    for (let i = 0; i < 40; i += 1) {
      cortex.write({ text: `用户：大样本 ${i} ${'细节'.repeat(150)}`, kind: 'utterance', title: `大 ${i}`, explicit: true, now });
    }
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(calls, 1, '大候选应该一次成功，不必先失败再重试');
    assert.match(String(result.run.model), /-bounded$/);
    assert.ok(maxTokensSeen >= 2000, `bounded 尝试的输出预算应足够（实际 ${maxTokensSeen}）`);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
