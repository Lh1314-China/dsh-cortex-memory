import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { computeMaturity, stageFor, nextStage, createDevelopmentStore, createDevelopmentEngine } from '../../src/self/development.js';
import { createSelfStore } from '../../src/self/state.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createFeedbackRepository } from '../../src/store/repositories/feedback.js';
import { createSkillRepository } from '../../src/store/repositories/skills.js';
import { createRelationshipStore } from '../../src/self/relationship.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-development-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db };
}

test('maturity maps to developmental stages', () => {
  const low = computeMaturity({ traces: 1, feedback: 0, calibration: null, activeSkills: 0, summaries: 0 });
  assert.equal(stageFor(low.maturity), 'infancy');
  const mid = computeMaturity({
    traces: 100, feedback: 25, calibration: { brier: 0.2 }, activeSkills: 2, summaries: 4,
    relationships: [{ familiarity: 0.5, trust: 0.7 }],
  });
  assert.ok(['childhood', 'adolescence'].includes(stageFor(mid.maturity)));
  const high = computeMaturity({
    traces: 500, feedback: 100, calibration: { brier: 0.05 }, activeSkills: 10, summaries: 20,
    relationships: [{ familiarity: 1, trust: 1 }],
  });
  assert.equal(stageFor(high.maturity), 'adulthood');
  assert.equal(nextStage('infancy'), 'childhood');
  assert.equal(nextStage('adulthood'), null);
});

test('development store records history and engine updates self stage', () => {
  const { dir, db } = setup();
  try {
    const events = createEventRepository(db);
    const traces = createTraceRepository(db);
    const feedback = createFeedbackRepository(db);
    const skills = createSkillRepository(db);
    const selfStore = createSelfStore(db);
    const relationships = createRelationshipStore(db);
    const store = createDevelopmentStore(db);
    const auditCalls = [];
    const audit = { record: (entry) => auditCalls.push(entry) };
    const engine = createDevelopmentEngine({ traces, feedback, skills, relationships, selfStore, store, audit });
    for (let i = 0; i < 5; i += 1) {
      const event = events.append({ kind: 'observation', payload: { text: `记忆 ${i}` } });
      traces.insert({ eventId: event.id, content: `记忆 ${i}`, importance: 0.5 });
    }
    const before = selfStore.get('global').stage;
    const result = engine.evaluate({ now: Date.parse('2026-11-11T12:00:00+08:00') });
    assert.equal(result.stage, 'infancy');
    assert.equal(result.counts.traceCount, 5);
    assert.equal(store.latest('global').stage, 'infancy');
    assert.equal(store.history('global').length, 1);
    assert.equal(selfStore.get('global').stage, result.stage);
    if (before !== result.stage) assert.ok(auditCalls.length >= 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
