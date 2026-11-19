import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('overview 的覆盖率只平均 v2 摘要，旧语义单独计数', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reflect-overview-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.repos.summaries.insert({ level: 'episode', content: '旧摘要', sourceIds: ['t1'], coverage: 0.04, model: 'extractive-v1' });
    cortex.repos.summaries.insert({ level: 'episode', content: '新摘要', sourceIds: ['t2'], coverage: 0.8, model: 'extractive-v2-weighted' });
    const value = cortex.engines.reflect.overview('global');
    assert.equal(value.count, 2);
    assert.equal(value.legacy, 1);
    assert.equal(Math.round(value.coverage * 100) / 100, 0.8, '只平均 v2：不应被 0.04 拉低');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
