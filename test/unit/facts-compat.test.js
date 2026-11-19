import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createFactRepository, negationFlip } from '../../src/store/repositories/facts.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-facts-compat-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db, facts: createFactRepository(db) };
}

function ensureEntity(db, id, name, at) {
  db.prepare(`
    INSERT INTO entities(id, scope_id, type, name, canonical, aliases_json, summary, created_at, updated_at)
    VALUES (?, 'global', 'concept', ?, ?, '[]', '', ?, ?)
  `).run(id, name, name, at, at);
}

test('only a leading negation counts as a flip', () => {
  assert.equal(negationFlip('会一直在', '不会一直在'), true);
  assert.equal(negationFlip('没有米饭', '有米饭'), true);
  assert.equal(negationFlip('一直存在着', '一直在——记忆不丢'), false);
  assert.equal(negationFlip('喜欢米饭', '喜欢米饭。'), false);
  assert.equal(negationFlip('', '一直在'), false);
});

test('same subject/predicate with compatible literals is not a dispute', () => {
  const { dir, db, facts } = setup();
  try {
    const at = '2026-11-15T10:00:00.000Z';
    ensureEntity(db, 'ent_x', '助手', at);
    const first = facts.resolve({ scopeId: 'global', subjectId: 'ent_x', predicate: 'will', objectLiteral: '一直存在着', validFrom: at, recordedAt: at });
    assert.equal(first.action, 'created');
    const second = facts.resolve({ scopeId: 'global', subjectId: 'ent_x', predicate: 'will', objectLiteral: '一直在——记忆不丢', validFrom: at, recordedAt: at });
    assert.equal(second.action, 'compatible');
    assert.equal(facts.disputes({ scopeId: 'global', status: 'open' }).length, 0);
    assert.equal(facts.get(first.fact.id).status, 'active');
    assert.equal(facts.get(second.fact.id).status, 'active');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a negation still produces a dispute', () => {
  const { dir, db, facts } = setup();
  try {
    const at = '2026-11-15T10:00:00.000Z';
    ensureEntity(db, 'ent_y', '助手', at);
    facts.resolve({ scopeId: 'global', subjectId: 'ent_y', predicate: 'will', objectLiteral: '会一直在', validFrom: at, recordedAt: at });
    const result = facts.resolve({ scopeId: 'global', subjectId: 'ent_y', predicate: 'will', objectLiteral: '不会一直在', validFrom: at, recordedAt: at });
    assert.equal(result.action, 'dispute');
    assert.ok(facts.disputes({ scopeId: 'global', status: 'open' }).length >= 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
