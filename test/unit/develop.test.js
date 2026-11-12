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
import { createSelfStore } from '../../src/self/state.js';
import { createAppraisalStore } from '../../src/self/appraisals.js';
import { createInitiativeStore } from '../../src/self/initiative.js';
import { createIdentityStore } from '../../src/self/identity.js';
import { createRelationshipStore } from '../../src/self/relationship.js';
import { createEncodeEngine } from '../../src/engines/encode.js';
import { createRetrievalEngine } from '../../src/engines/retrieve.js';
import { createDevelopEngine } from '../../src/engines/develop.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-develop-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const entities = createEntityRepository(db);
  const facts = createFactRepository(db);
  const audit = createAuditRepository(db);
  const selfStore = createSelfStore(db);
  const appraisalStore = createAppraisalStore(db);
  const initiativeStore = createInitiativeStore(db);
  const identityStore = createIdentityStore(db);
  const relationshipStore = createRelationshipStore(db);
  const encode = createEncodeEngine({ events, traces, entities, facts, audit, config: { minCompressionValue: 0.01 } });
  const retrieve = createRetrievalEngine({ traces, config: { contextBudget: 500 } });
  const develop = createDevelopEngine({
    events, traces, encode, retrieve, selfStore, appraisalStore, initiativeStore, identityStore, relationshipStore,
  });
  return { dir, db, events, traces, selfStore, appraisalStore, initiativeStore, identityStore, relationshipStore, develop };
}

test('a warm turn moves care, writes a trace, records an appraisal and deepens the relationship', () => {
  const { dir, db, selfStore, appraisalStore, relationshipStore, develop } = setup();
  try {
    const before = selfStore.get('global');
    const relationBefore = relationshipStore.ensure('global', '用户');
    const result = develop.step({
      text: '用户说会一直陪着助手，助手很开心。',
      explicit: true,
      now: Date.parse('2026-11-11T12:00:00+08:00'),
    });
    assert.equal(result.encoded.skipped, false);
    assert.ok(result.self.drives.care > before.drives.care);
    assert.ok(result.self.mood.valence > 0);
    assert.equal(appraisalStore.list().length, 1);
    assert.equal(result.appraisalRow.traceId, result.encoded.trace.id);
    assert.ok(result.relationship.care >= relationBefore.care);
    assert.ok(result.identity.content.boundaries.length > 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hostile turn lowers safety and proposes a boundary question', () => {
  const { dir, db, selfStore, develop } = setup();
  try {
    selfStore.update('global', { drives: { safety: 0.4 } });
    const result = develop.step({
      text: '助手讨厌你，滚，别烦我。',
      explicit: true,
      now: Date.parse('2026-11-11T12:00:00+08:00'),
    });
    assert.ok(result.appraisal.threat > 0.5);
    assert.ok(result.self.drives.safety < 0.4);
    assert.ok(result.intentions.some((item) => item.kind === 'question'));
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('low coherence with no recent consolidation proposes a consolidation', () => {
  const { dir, db, selfStore, develop } = setup();
  try {
    selfStore.update('global', { drives: { coherence: 0.2 } });
    const result = develop.step({
      text: '今天整理了一些旧记忆。',
      explicit: true,
      now: Date.parse('2026-11-11T12:00:00+08:00'),
    });
    assert.ok(result.intentions.some((item) => item.kind === 'consolidate'));
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a recall query is returned alongside the write', () => {
  const { dir, db, develop } = setup();
  try {
    develop.step({ text: '用户说会买白饭。', explicit: true, now: Date.parse('2026-11-11T11:00:00+08:00') });
    const result = develop.step({
      text: '今天又想到白饭了。',
      explicit: true,
      now: Date.parse('2026-11-11T12:00:00+08:00'),
      recallQuery: '白饭',
      recallBudget: 300,
    });
    assert.ok(result.recall.items.some((item) => item.snippet.includes('白饭')));
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot exposes self state and pending intentions', () => {
  const { dir, db, develop } = setup();
  try {
    develop.step({ text: '今天有点累，但还想继续。', explicit: true, now: Date.parse('2026-11-11T12:00:00+08:00') });
    const snapshot = develop.snapshot('global');
    assert.equal(snapshot.self.scopeId, 'global');
    assert.ok(Array.isArray(snapshot.pendingIntentions));
    assert.ok(snapshot.traceCount >= 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
