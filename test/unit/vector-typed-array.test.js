import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createVectorIndex } from '../../src/vector/index.js';

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE traces (id TEXT PRIMARY KEY, scope_id TEXT, state TEXT, title TEXT, content TEXT, summary TEXT, recorded_at TEXT);
    CREATE TABLE embeddings (trace_id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL, hash TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO traces(id, scope_id, state, title, content, summary, recorded_at) VALUES ('t1','global','active','标题','正文',NULL,'2026-11-15T00:00:00Z')").run();
  return db;
}

test('drainQueue accepts a Float32Array embedding and stores it', async () => {
  const db = memoryDb();
  try {
    const embedder = { kind: 'openai-embedding', async embed() { return new Float32Array(4).fill(0.5); } };
    const vector = createVectorIndex({ db, embedder, model: 'fake', dim: 4 });
    vector.backfillMissing({ limit: 1 });
    const result = await vector.drainQueue({ max: 1, budgetMs: 5000 });
    assert.equal(result.ok, 1);
    assert.equal(result.failed, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM embeddings').get().c, 1);
  } finally {
    db.close();
  }
});

test('a wrong dimension is still rejected and retried later', async () => {
  const db = memoryDb();
  try {
    const embedder = { kind: 'openai-embedding', async embed() { return new Float32Array(3); } };
    const vector = createVectorIndex({ db, embedder, model: 'fake', dim: 4 });
    vector.backfillMissing({ limit: 1 });
    const result = await vector.drainQueue({ max: 1, budgetMs: 5000 });
    assert.equal(result.ok, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM embeddings').get().c, 0);
    assert.ok(result.pending >= 1);
  } finally {
    db.close();
  }
});
