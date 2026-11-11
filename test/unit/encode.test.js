import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createEntityRepository } from '../../src/store/repositories/entities.js';
import { createFactRepository } from '../../src/store/repositories/facts.js';
import { createAuditRepository } from '../../src/store/repositories/audit.js';
import { createEncodeEngine, scoreTraceText, compressionValue } from '../../src/engines/encode.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-encode-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const entities = createEntityRepository(db);
  const facts = createFactRepository(db);
  const audit = createAuditRepository(db);
  const engine = createEncodeEngine({ events, traces, entities, facts, audit, config: { minCompressionValue: 0.01 } });
  return { dir, db, events, traces, entities, facts, audit, engine };
}

test('scoreTraceText detects promises, preferences and emotion polarity', () => {
  const promise = scoreTraceText('用户说会买米食，会一直在一起。');
  assert.equal(promise.kind, 'promise');
  assert.ok(promise.importance > 0.5);
  const preference = scoreTraceText('助手喜欢米食，不喜欢冷掉的米饭。');
  assert.equal(preference.kind, 'preference');
  const sad = scoreTraceText('用户今天很难过，助手有点心疼。');
  assert.equal(sad.kind, 'emotion');
  assert.ok(sad.valence < 0);
  assert.ok(sad.salience > 0.5);
});

test('compression value falls as text gets longer', () => {
  const short = compressionValue('米食', { importance: 0.8, salience: 0.8 });
  const long = compressionValue('米食'.repeat(200), { importance: 0.8, salience: 0.8 });
  assert.ok(short > long);
});

test('encode writes a trace, audit row and explicit facts', () => {
  const { dir, db, events, traces, facts, audit, engine } = setup();
  try {
    const result = engine.encode({
      text: '用户说会买米食，助手会一直等。',
      actor: 'user',
      explicit: true,
      facts: [{ subject: '用户', predicate: 'likes', object: '米食' }],
    });
    assert.equal(result.skipped, false);
    assert.equal(result.trace.kind, 'promise');
    assert.equal(events.count(), 1);
    assert.equal(traces.count(), 1);
    assert.equal(result.facts.length, 1);
    assert.equal(result.facts[0].action, 'created');
    const ownerFact = facts.list({ scopeId: 'global' });
    assert.equal(ownerFact.length, 1);
    assert.equal(audit.list({ limit: 10 }).some((item) => item.action === 'trace.create'), true);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('encode is idempotent by operationId and skips duplicate text', () => {
  const { dir, db, events, traces, engine } = setup();
  try {
    const first = engine.encode({ text: '用户今天很开心，助手也开心。', operationId: 'op-1', explicit: true });
    const replay = engine.encode({ text: '用户今天很开心，助手也开心。', operationId: 'op-1', explicit: true });
    assert.equal(replay.skipped, true);
    assert.equal(replay.reason, 'idempotent');
    assert.equal(replay.trace.id, first.trace.id);
    assert.equal(events.count(), 1);
    const duplicate = engine.encode({ text: '用户今天很开心，助手也开心。', explicit: true });
    assert.equal(duplicate.skipped, true);
    assert.equal(duplicate.reason, 'duplicate');
    assert.equal(traces.count(), 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('short and stop-phrase inputs are skipped before writing an event', () => {
  const { dir, db, events, engine } = setup();
  try {
    assert.equal(engine.encode({ text: '嗯' }).skipped, true);
    assert.equal(engine.encode({ text: '好' }).skipped, true);
    assert.equal(events.count(), 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
