import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function seed(cortex, count = 6) {
  const now = Date.now();
  for (let i = 0; i < count; i += 1) {
    cortex.write({ text: `用户：第 ${i} 条待巩固的痕迹，内容各不相同 ${i}。`, kind: 'utterance', title: `巩固样本 ${i}`, explicit: true, now });
  }
}

test('没有 adapter 时记 no-llm-adapter，而不是笼统的 no-llm', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-no-adapter-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    seed(cortex);
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.error, 'no-llm-adapter');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter 返回空时记 llm-empty，与缺 adapter 区分开', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-empty-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') },
    llm: { complete: async () => null, available: () => true },
  });
  try {
    seed(cortex);
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.run.error, 'llm-empty');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('6 小时内多次 llm-empty 会在健康报告里报 LLM_EMPTY', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-warn-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } },
    llm: { complete: async () => null, available: () => true },
  });
  try {
    seed(cortex);
    for (let i = 0; i < 6; i += 1) {
      await cortex.consolidation.run({ scopeId: 'global', force: true });
    }
    const health = cortex.health({ scopeId: 'global' });
    const warn = health.issues.find((issue) => issue.code === 'LLM_EMPTY');
    assert.ok(warn, '多次空返回应被报出来');
    assert.equal(warn.detail?.count, 6);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
