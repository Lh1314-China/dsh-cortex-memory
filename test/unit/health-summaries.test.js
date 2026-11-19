import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('health 会报叙事层的条数，摘要缺失时给警告', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-health-summaries-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const before = cortex.health({ scopeId: 'global' });
    assert.equal(before.summaryLayers.episode, 0);
    cortex.repos.summaries.insert({ level: 'episode', content: '一段摘要', sourceIds: ['t1'], coverage: 0.5, model: 'extractive-v2-weighted' });
    cortex.repos.summaries.insert({ level: 'merge', content: '合并记录', sourceIds: ['t1'], coverage: 0.5, model: 'dedupe-v1' });
    const after = cortex.health({ scopeId: 'global' });
    assert.equal(after.summaryLayers.episode, 1);
    assert.equal(after.summaryLayers.merge, 1);
    assert.ok(after.summaryLayers.lastEpisodeAt, '应给出最近一次每日摘要的时间');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
