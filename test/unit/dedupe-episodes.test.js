import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate } from '../../src/store/database.js';
import { findDuplicateEpisodes } from '../../src/engines/summary-dedupe.js';

test('重合窗口 + 内容几乎一致才判为重复', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-dedupe-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  try {
    const now = '2026-11-15T10:00:00.000Z';
    const insert = db.prepare(`INSERT INTO summaries(id, scope_id, level, period_start, period_end, content, source_ids_json, coverage, model, created_at)
      VALUES (?, 'global', 'episode', ?, ?, ?, ?, 0.5, 'extractive-v2-weighted', ?)`);
    // 同一窗口（重叠 ≈99%）、内容完全相同
    insert.run('a', '2026-11-11T13:50:00.000Z', '2026-11-12T13:40:00.000Z', '这段时间记住了：用户否决了单图网格绑定，决定借模型。', '["t1","t2"]', '2026-11-12T13:48:00.000Z');
    insert.run('b', '2026-11-11T13:52:00.000Z', '2026-11-12T13:44:00.000Z', '这段时间记住了：用户否决了单图网格绑定，决定借模型。', '["t2","t3"]', '2026-11-12T15:35:00.000Z');
    // 完全不同的窗口与内容
    insert.run('c', '2026-11-13T00:00:00.000Z', '2026-11-14T00:00:00.000Z', '另一段时间：修好了向量回填，覆盖率从 0.22 到 1.0。', '["t9"]', now);

    const result = findDuplicateEpisodes({ db, scopeId: 'global' });
    assert.equal(result.candidates, 3);
    assert.equal(result.clusters.length, 1, '只有 a/b 该成簇');
    const cluster = result.clusters[0];
    assert.equal(cluster.keep.id, 'b', '保留较新的一条');
    assert.deepEqual(cluster.remove.map((item) => item.id), ['a']);
    assert.deepEqual(cluster.unionSources.sort(), ['t1', 't2', 't3']);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
