import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, getMeta, closeDatabase, FTS_INDEX_VERSION } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { ftsText } from '../../src/memory/tokenizer.js';

test('migrate rebuilds an old bigram-only FTS index once', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-fts-migrate-'));
  try {
    let { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
    migrate(db);
    const events = createEventRepository(db);
    const traces = createTraceRepository(db);
    const event = events.append({ kind: 'utterance', payload: { text: '白饭' } });
    const trace = traces.insert({
      eventId: event.id,
      content: '主人说会买白饭。',
      title: '白饭的承诺',
    });
    // Simulate a database written by the old tokenizer: bigram-only FTS.
    db.exec('DELETE FROM traces_fts_index');
    db.prepare('INSERT INTO traces_fts_index(trace_id, text) VALUES (?, ?)').run(trace.id, ftsText('白饭的承诺 主人说会买白饭。'));
    db.prepare('DELETE FROM meta WHERE key = ?').run('fts_index_version');
    closeDatabase(db);

    const reopened = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
    db = reopened.db;
    const result = migrate(db);
    assert.equal(result.ftsRebuilt, true);
    assert.equal(getMeta(db, 'fts_index_version'), String(FTS_INDEX_VERSION));
    const repo = createTraceRepository(db);
    assert.equal(repo.searchFts('米饭').length, 0);
    assert.equal(repo.searchFts('米饭', { soft: true }).length, 1);
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
