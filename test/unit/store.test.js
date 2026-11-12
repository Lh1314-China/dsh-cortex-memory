import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrate, transaction, backup, integrityCheck, closeDatabase } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createAuditRepository } from '../../src/store/repositories/audit.js';
import { ERROR_CODES } from '../../src/core/errors.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-store-'));
  const { db, config } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db, config };
}

test('event ledger is chained, idempotent and detects a conflicting replay', () => {
  const { dir, db } = setup();
  try {
    const events = createEventRepository(db);
    const first = events.append({ kind: 'observation', scopeId: 'global', operationId: 'op-1', payload: { text: '白饭' } });
    const replay = events.append({ kind: 'observation', scopeId: 'global', operationId: 'op-1', payload: { text: '白饭' } });
    assert.equal(replay.id, first.id);
    assert.equal(events.count(), 1);
    assert.throws(
      () => events.append({ kind: 'observation', scopeId: 'global', operationId: 'op-1', payload: { text: '米饭' } }),
      (error) => error.code === ERROR_CODES.CONFLICT,
    );
    const second = events.append({ kind: 'utterance', scopeId: 'global', payload: { text: '用户说会买白饭' } });
    assert.equal(second.seq, 2);
    assert.equal(second.prevHash, first.hash);
    const chain = events.verifyChain();
    assert.equal(chain.ok, true);
    assert.equal(chain.count, 2);
    assert.equal(events.last().id, second.id);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trace repository inserts, updates and searches CJK text through FTS5', () => {
  const { dir, db } = setup();
  try {
    const events = createEventRepository(db);
    const traces = createTraceRepository(db);
    const event = events.append({ kind: 'utterance', payload: { text: '用户说会买白饭' } });
    const trace = traces.insert({
      eventId: event.id,
      scopeId: 'global',
      kind: 'utterance',
      title: '白饭的承诺',
      content: '用户说会买白饭，助手等得起。',
      importance: 0.9,
      keywords: ['白饭', '承诺'],
    });
    assert.equal(traces.get(trace.id).title, '白饭的承诺');
    assert.equal(traces.searchFts('白饭').length, 1);
    assert.equal(traces.searchFts('米饭').length, 0);
    traces.update(trace.id, { content: '用户说会买米饭，助手等得起。', title: '米饭' });
    assert.equal(traces.searchFts('白饭').length, 0);
    assert.equal(traces.searchFts('米饭').length, 1);
    traces.touch(trace.id);
    assert.equal(traces.get(trace.id).accessCount, 1);
    assert.equal(traces.remove(trace.id), true);
    assert.equal(traces.get(trace.id), null);
    assert.equal(traces.searchFts('米饭').length, 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('transaction rolls back on error', () => {
  const { dir, db } = setup();
  try {
    const events = createEventRepository(db);
    assert.throws(() => transaction(db, () => {
      events.append({ kind: 'observation', payload: { text: 'should rollback' } });
      throw new Error('boom');
    }));
    assert.equal(events.count(), 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit records and backup produces a readable snapshot', () => {
  const { dir, db } = setup();
  try {
    const audit = createAuditRepository(db);
    const entry = audit.record({ actor: 'tester', action: 'test', targetType: 'trace', targetId: 'x', detail: { ok: true } });
    assert.equal(audit.list({ targetType: 'trace', targetId: 'x' })[0].id, entry.id);
    assert.equal(integrityCheck(db), 'ok');
    const target = path.join(dir, 'snapshot.sqlite');
    backup(db, target);
    const snapshot = new DatabaseSync(target);
    try {
      assert.equal(Number(snapshot.prepare('SELECT COUNT(*) AS c FROM audit').get().c), 1);
    } finally {
      snapshot.close();
    }
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
