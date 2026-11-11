import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase, transaction } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createEntityRepository } from '../../src/store/repositories/entities.js';
import { createFactRepository } from '../../src/store/repositories/facts.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-facts-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db };
}

test('entities merge aliases and facts revise over time', () => {
  const { dir, db } = setup();
  try {
    const events = createEventRepository(db);
    const entities = createEntityRepository(db);
    const facts = createFactRepository(db);
    const owner = entities.upsert({ name: '主人', type: 'person', aliases: ['凌寒'] });
    const merged = entities.upsert({ name: '主人', type: 'person', aliases: ['主人大人'] });
    assert.equal(merged.id, owner.id);
    assert.deepEqual(merged.aliases.sort(), ['凌寒', '主人大人'].sort());
    const rice = entities.upsert({ name: '白饭', type: 'food' });
    const meal = entities.upsert({ name: '米饭', type: 'food' });
    const event = events.append({ kind: 'utterance', payload: { text: '主人喜欢白饭' } });

    const first = facts.resolve({
      subjectId: owner.id,
      predicate: 'likes',
      objectId: rice.id,
      validFrom: '2026-11-01T00:00:00.000Z',
      recordedAt: '2026-11-01T00:00:00.000Z',
      confidence: 0.7,
      sourceEventId: event.id,
    });
    assert.equal(first.action, 'created');
    assert.equal(facts.queryAt({ subjectId: owner.id, predicate: 'likes', at: '2026-11-05T00:00:00.000Z' }).length, 1);

    const corroborated = facts.resolve({
      subjectId: owner.id,
      predicate: 'likes',
      objectId: rice.id,
      validFrom: '2026-11-02T00:00:00.000Z',
      confidence: 0.6,
      sourceEventId: event.id,
    });
    assert.equal(corroborated.action, 'corroborate');
    assert.ok(corroborated.fact.confidence > first.fact.confidence);

    const superseded = facts.resolve({
      subjectId: owner.id,
      predicate: 'likes',
      objectId: meal.id,
      validFrom: '2026-11-10T00:00:00.000Z',
      confidence: 0.8,
      sourceEventId: event.id,
    });
    assert.equal(superseded.action, 'supersede');
    assert.equal(superseded.invalidated.length, 1);
    assert.equal(superseded.invalidated[0].status, 'invalidated');
    assert.equal(superseded.fact.status, 'active');
    const oldAt = facts.queryAt({ subjectId: owner.id, predicate: 'likes', at: '2026-11-05T00:00:00.000Z' });
    assert.equal(oldAt.length, 1);
    assert.equal(oldAt[0].objectId, rice.id);
    const newAt = facts.queryAt({ subjectId: owner.id, predicate: 'likes', at: '2026-11-11T00:00:00.000Z' });
    assert.equal(newAt.length, 1);
    assert.equal(newAt[0].objectId, meal.id);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same-start contradiction becomes a dispute and backfill gets a bounded interval', () => {
  const { dir, db } = setup();
  try {
    const entities = createEntityRepository(db);
    const facts = createFactRepository(db);
    const owner = entities.upsert({ name: '主人' });
    const a = entities.upsert({ name: '白饭' });
    const b = entities.upsert({ name: '米饭' });
    facts.resolve({ subjectId: owner.id, predicate: 'likes', objectId: a.id, validFrom: '2026-11-10T00:00:00.000Z' });
    const dispute = facts.resolve({ subjectId: owner.id, predicate: 'likes', objectId: b.id, validFrom: '2026-11-10T00:00:00.000Z' });
    assert.equal(dispute.action, 'dispute');
    assert.equal(dispute.dispute.status, 'open');
    assert.equal(facts.disputes().length, 1);
    const backfill = facts.resolve({
      subjectId: owner.id,
      predicate: 'likes',
      objectId: entities.upsert({ name: '面条' }).id,
      validFrom: '2026-10-01T00:00:00.000Z',
    });
    assert.equal(backfill.action, 'backfill');
    assert.ok(backfill.fact.validTo);
    const atOld = facts.queryAt({ subjectId: owner.id, predicate: 'likes', at: '2026-10-15T00:00:00.000Z' });
    assert.equal(atOld.length, 1);
    assert.equal(atOld[0].id, backfill.fact.id);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
