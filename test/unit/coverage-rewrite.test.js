import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate } from '../../src/store/database.js';
import { recomputeEpisodeCoverage } from '../../src/engines/summary-coverage.js';

test('重算 v1 摘要的 coverage，按重要度加权，并跳过已 v2 的', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-coverage-rewrite-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  try {
    const now = '2026-11-15T10:00:00.000Z';
    db.prepare("INSERT INTO events(id, seq, at, kind, scope_id, payload_json, hash) VALUES ('evt_1', 1, ?, 'observation', 'global', '{}', 'h0')").run(now);
    const insert = db.prepare(`INSERT INTO traces(id, scope_id, kind, state, title, content, event_id, hash, recorded_at, updated_at, created_at, importance)
      VALUES (?, 'global', 'observation', 'active', ?, ?, 'evt_1', ?, ?, ?, ?, ?)`);
    // 窗口内：2 条重要（0.9）+ 2 条琐碎（0.1）；摘要只覆盖了 2 条重要
    insert.run('t1', '重要一', '正文', 'h1', '2026-11-15T09:00:00.000Z', now, now, 0.9);
    insert.run('t2', '重要二', '正文', 'h2', '2026-11-15T09:30:00.000Z', now, now, 0.9);
    insert.run('t3', '琐碎一', '正文', 'h3', '2026-11-15T08:00:00.000Z', now, now, 0.1);
    insert.run('t4', '琐碎二', '正文', 'h4', '2026-11-15T07:00:00.000Z', now, now, 0.1);

    db.prepare(`INSERT INTO summaries(id, scope_id, level, period_start, period_end, content, source_ids_json, coverage, model, created_at)
      VALUES ('s_v1', 'global', 'episode', '2026-11-15T06:00:00.000Z', '2026-11-15T10:00:00.000Z', '旧摘要', '["t1","t2"]', 0.05, 'extractive-v1', ?)`).run(now);
    db.prepare(`INSERT INTO summaries(id, scope_id, level, period_start, period_end, content, source_ids_json, coverage, model, created_at)
      VALUES ('s_v2', 'global', 'episode', '2026-11-15T06:00:00.000Z', '2026-11-15T10:00:00.000Z', '新摘要', '["t1"]', 0.8, 'extractive-v2-weighted', ?)`).run(now);

    const result = recomputeEpisodeCoverage({ db, scopeId: 'global' });
    assert.equal(result.candidates, 1, '只应候选 v1 摘要');
    assert.equal(result.updates.length, 1);
    // covered = 0.9+0.9 = 1.8；total = 1.8+0.1+0.1 = 2.0 → 0.9
    assert.equal(result.updates[0].to, 0.9);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
