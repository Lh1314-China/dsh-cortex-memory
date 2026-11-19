import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createToolDefinitions } from '../../src/tools/definitions.js';

test('health 会报「巩固」与「睡眠」的最近状态', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-health-consolidation-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：一条样本。', kind: 'utterance', title: '样本', explicit: true, now });
    await cortex.consolidation.run({ scopeId: 'global', force: true });
    const report = cortex.health({ scopeId: 'global' });
    assert.ok(report.consolidation?.dream, '应带最近一次巩固');
    assert.equal(report.consolidation.dream.error, 'no-llm-adapter');
    assert.equal(report.consolidation.sleep, null, '还没睡过时睡眠为 null');

    const tool = createToolDefinitions(cortex).find((entry) => entry.name === 'cortex_health');
    const text = String((await tool.execute({})).text);
    assert.match(text, /巩固 /, '文本里应有一行巩固状态');
    assert.match(text, /空转（no-llm-adapter）/, '应写出空转原因');
    assert.match(text, /睡眠 还没有记录/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('空回复分桶会把「重试过」和「一次就空」分开显示', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-health-buckets-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const at = new Date().toISOString();
    const insert = cortex.db.prepare("INSERT INTO dream_runs(id, scope_id, at, status, model, input_digest, input_json, decisions_json, applied_json, error, created_at) VALUES (?, 'global', ?, 'skipped', NULL, 'x', '[]', '[]', '[]', ?, ?)");
    for (let i = 0; i < 4; i += 1) insert.run(`drn_a${i}`, at, 'llm-empty:empty-text:max-tokens', at);
    for (let i = 0; i < 2; i += 1) insert.run(`drn_b${i}`, at, 'llm-empty-retry:empty-text:max-tokens', at);
    const report = cortex.health({ scopeId: 'global' });
    const warn = report.issues.find((issue) => issue.code === 'LLM_EMPTY');
    assert.ok(warn, '应报 LLM_EMPTY');
    assert.equal(warn.detail.count, 6);
    const tool = createToolDefinitions(cortex).find((entry) => entry.name === 'cortex_health');
    const text = String((await tool.execute({})).text);
    assert.match(text, /empty-text:max-tokens×4/);
    assert.match(text, /empty-text:max-tokens（重试）×2/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
