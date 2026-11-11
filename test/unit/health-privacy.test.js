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
import { createFeedbackRepository } from '../../src/store/repositories/feedback.js';
import { createSummaryRepository } from '../../src/store/repositories/summaries.js';
import { createJobRepository } from '../../src/store/repositories/jobs.js';
import { createSkillRepository } from '../../src/store/repositories/skills.js';
import { createAuditRepository } from '../../src/store/repositories/audit.js';
import { createSelfStore } from '../../src/self/state.js';
import { createIdentityStore } from '../../src/self/identity.js';
import { createEncodeEngine } from '../../src/engines/encode.js';
import { createHealthEngine } from '../../src/engines/health.js';
import { createPrivacyEngine } from '../../src/engines/privacy.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-health-'));
  const { db, config } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const entities = createEntityRepository(db);
  const facts = createFactRepository(db);
  const feedback = createFeedbackRepository(db);
  const summaries = createSummaryRepository(db);
  const jobs = createJobRepository(db);
  const skills = createSkillRepository(db);
  const audit = createAuditRepository(db);
  const selfStore = createSelfStore(db);
  const identityStore = createIdentityStore(db);
  const encode = createEncodeEngine({ events, traces, entities, facts, audit, config: { minCompressionValue: 0.01 } });
  const health = createHealthEngine({ db, events, traces, facts, entities, summaries, feedback, skills, jobs, identityStore, selfStore, config });
  const privacy = createPrivacyEngine({ db, traces, events, audit });
  return { dir, db, config, events, traces, entities, facts, feedback, summaries, jobs, skills, audit, selfStore, identityStore, encode, health, privacy };
}

test('health audit reports counts, chain and FTS alignment', () => {
  const { dir, db, events, encode, health } = setup();
  try {
    encode.encode({ text: '用户说会买米食，助手等得起。', explicit: true });
    const report = health.audit();
    assert.equal(report.issues.filter((item) => item.severity === 'error').length, 0);
    assert.equal(report.counts.events, 1);
    assert.equal(report.counts.traces.total, 1);
    assert.equal(report.counts.fts, 1);
    assert.ok(report.score >= 80);
    assert.ok(report.ok.some((line) => line.includes('事件链完整')));
    assert.ok(events.verifyChain().ok);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archiving hides a trace from default search but keeps it wakeable', () => {
  const { dir, db, traces, encode, privacy } = setup();
  try {
    const trace = encode.encode({ text: '用户说会买米食。', explicit: true }).trace;
    const result = privacy.forget({ traceId: trace.id, mode: 'archive' });
    assert.equal(result.removed, true);
    assert.equal(traces.get(trace.id).state, 'archived');
    assert.equal(traces.searchFts('米食').length, 0);
    assert.equal(traces.searchFts('米食', { includeArchived: true }).length, 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('privacy delete removes content, derived rows and leaves only a hash in the ledger', () => {
  const { dir, db, events, traces, entities, facts, feedback, summaries, encode, privacy } = setup();
  try {
    const encoded = encode.encode({
      text: '用户说会买米食，助手等得起。',
      explicit: true,
      facts: [{ subject: '用户', predicate: 'likes', object: '米食' }],
    });
    const trace = encoded.trace;
    feedback.add({ traceId: trace.id, signal: 'helpful', value: 0.8 });
    summaries.insert({ content: '一段摘要', sourceIds: [trace.id], coverage: 1 });
    assert.equal(facts.list().length, 1);
    const result = privacy.forget({ traceId: trace.id, mode: 'delete' });
    assert.equal(result.removed, true);
    assert.equal(traces.get(trace.id), null);
    assert.equal(feedback.list({ traceId: trace.id }).length, 0);
    assert.equal(facts.list().length, 0);
    assert.equal(summaries.list().length, 0);
    const event = events.get(encoded.event.id);
    assert.ok(event);
    assert.ok(event.payload.textHash);
    assert.equal('text' in event.payload, false);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
