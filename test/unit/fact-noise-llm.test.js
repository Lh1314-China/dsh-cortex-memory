import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { extractFactCandidates } from '../../src/engines/extract.js';

test('叙述句碎片不会被抽成事实（等/收一收/水里）', () => {
  const candidates = extractFactCandidates('它在水里收一收，然后又等了一会儿。', { selfName: '助手', userAddress: '用户' });
  assert.ok(Array.isArray(candidates));
  assert.equal(candidates.length, 0, `不该抽出事实：${JSON.stringify(candidates)}`);
});

test('正常句子仍然能抽出事实', () => {
  const candidates = extractFactCandidates('助手喜欢米饭。', { selfName: '助手', userAddress: '用户' });
  assert.ok(candidates.length > 0, '正常句子不该被误杀');
  assert.equal(candidates[0].predicate, 'likes');
});

test('LLM 没开时健康报告给出明确警告', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-llm-warn-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: false } } });
  try {
    const health = cortex.health({ scopeId: 'global' });
    const warn = health.issues.find((issue) => issue.code === 'LLM_DISABLED');
    assert.ok(warn, 'features.llm=false 时应提示');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LLM 打开时不再报 LLM_DISABLED', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-llm-on-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } } });
  try {
    const health = cortex.health({ scopeId: 'global' });
    assert.equal(health.issues.find((issue) => issue.code === 'LLM_DISABLED'), undefined);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
