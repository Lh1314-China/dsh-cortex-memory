import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate } from '../../src/store/database.js';
import { createCortex } from '../../src/service/cortex.js';

test('覆盖率只数活跃痕迹的向量，不会超过 100%', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-vector-coverage-'));
  const dbFile = path.join(dir, 'cortex.sqlite');
  const { db } = openDatabase({ dataRoot: dir, dbFile });
  migrate(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO events(id, seq, at, kind, scope_id, payload_json, hash) VALUES ('evt_1', 1, ?, 'observation', 'global', '{}', 'eh1')`).run(now);
  const insertTrace = db.prepare(`INSERT INTO traces(id, scope_id, kind, state, title, content, event_id, hash, recorded_at, updated_at, created_at) VALUES (?, 'global', 'observation', ?, ?, ?, 'evt_1', ?, ?, ?, ?)`);
  insertTrace.run('t_active_1', 'active', '活跃一', '正文一', 'h1', now, now, now);
  insertTrace.run('t_active_2', 'active', '活跃二', '正文二', 'h2', now, now, now);
  insertTrace.run('t_archived', 'archived', '旧的一', '正文三', 'h3', now, now, now);  const blob = Buffer.from(new Float32Array(4).fill(0.1).buffer);
  const insertEmbedding = db.prepare(`INSERT INTO embeddings(trace_id, model, dim, vector, hash, updated_at) VALUES (?, 'fake', 4, ?, ?, ?)`);
  insertEmbedding.run('t_active_1', blob, 'h1', now);
  insertEmbedding.run('t_archived', blob, 'h3', now);
  db.close();

  const cortex = createCortex({ config: { dataRoot: dir, dbFile } });
  try {
    const health = cortex.health({ scopeId: 'global' });
    assert.equal(health.vectors.embedded, 1, '只应数活跃痕迹的向量');
    assert.ok(health.vectors.coverage <= 1, `覆盖率不应超过 1：${health.vectors.coverage}`);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
