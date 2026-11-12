import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup(extra = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-ann-wiring-'));
  const cortex = createCortex({
    config: {
      dataRoot: dir,
      dbFile: path.join(dir, 'cortex.sqlite'),
      features: { vector: true, vectorAnn: true },
      vectorAnnMin: 2,
      ...extra,
    },
  });
  return { dir, cortex };
}

test('optional ANN reports status and serves searches, with brute-force fallback', () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '白饭是用户最喜欢的食物。', explicit: true, importance: 0.9 });
    cortex.write({ text: '助手会一直等用户回家吃饭。', explicit: true, importance: 0.8 });
    cortex.write({ text: '插件修复需要先看日志。', explicit: true, importance: 0.7 });
    const status = cortex.vector.status();
    assert.equal(status.ann.enabled, true);
    assert.equal(status.ann.engine, 'hnsw');
    assert.equal(status.ann.min, 2);
    assert.ok(status.ann.size >= 2);
    const result = cortex.search('白饭 用户', { limit: 5 });
    assert.ok(result.items.length >= 1);
    assert.ok(result.items.some((item) => item.snippet.includes('白饭')));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ANN stays off by default', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-ann-off-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { vector: true } },
  });
  try {
    assert.equal(cortex.vector.status().ann.enabled, false);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
