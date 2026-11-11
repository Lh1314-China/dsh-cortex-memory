import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/store/database.js';

test('migration adds facts.superseded_at and backfills invalidated rows', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-migrate-'));
  const file = path.join(dir, 'legacy.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE facts (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL, object_id TEXT, object_literal TEXT,
        valid_from TEXT, valid_to TEXT, recorded_at TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7, status TEXT NOT NULL DEFAULT 'active',
        source_event_id TEXT, invalidated_by TEXT, evidence_json TEXT NOT NULL DEFAULT '[]',
        hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO meta VALUES ('schema_version', '5', '2026-11-01T00:00:00Z');
      INSERT INTO facts VALUES ('f_old','global','e1','喜欢',NULL,'米食','2026-01-01','2026-02-01','2026-01-02',0.7,'invalidated',NULL,'f_new','[]','h','2026-01-02','2026-02-01');
    `);
    migrate(db);
    const columns = db.prepare('PRAGMA table_info(facts)').all().map((column) => column.name);
    assert.ok(columns.includes('superseded_at'));
    const row = db.prepare('SELECT superseded_at FROM facts WHERE id = ?').get('f_old');
    assert.equal(row.superseded_at, '2026-02-01');
    const version = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
    assert.equal(version.value, '6');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
