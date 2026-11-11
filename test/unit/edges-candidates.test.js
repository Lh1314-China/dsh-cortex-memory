import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEdgeRepository } from '../../src/store/repositories/edges.js';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-edge-candidates-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db, edges: createEdgeRepository(db) };
}

test('candidate edges stay out of active graph until approved', () => {
  const { dir, db, edges } = setup();
  try {
    const candidate = edges.addCandidate({
      scopeId: 'global',
      fromId: 'ent_a',
      toId: 'ent_b',
      rel: 'related',
      confidence: 0.6,
      sourceTraceId: 'trc_test',
      evidence: 'co-occurrence',
    });
    assert.equal(candidate.metadata.status, 'candidate');
    assert.equal(edges.list({ scopeId: 'global' }).length, 0);
    assert.equal(edges.listCandidates({ scopeId: 'global' }).length, 1);

    const approved = edges.approveCandidate(candidate.id);
    assert.equal(approved.metadata.status, 'active');
    assert.equal(edges.list({ scopeId: 'global' }).length, 1);
    assert.equal(edges.listCandidates({ scopeId: 'global' }).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit facts queue candidate edges, but graph stays clean until approved', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-edge-queue-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const written = cortex.write({
      text: '甲和乙明确相关。',
      explicit: true,
      facts: [{ subject: '甲', predicate: 'related', object: '乙', confidence: 0.8 }],
    });
    assert.equal(written.edgeCandidates.length, 1);
    assert.equal(cortex.graphCandidates({ scopeId: 'global' }).length, 1);
    assert.equal(cortex.graphData({ scopeId: 'global' }).edges.length, 0);

    const candidateId = written.edgeCandidates[0].id;
    const approved = cortex.graphCandidateAction({ action: 'approve', id: candidateId });
    assert.equal(approved.metadata.status, 'active');
    assert.equal(cortex.graphCandidates({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.graphData({ scopeId: 'global' }).edges.length, 1);
    const audit = cortex.repos.audit.list({ targetType: 'edge', targetId: candidateId });
    assert.ok(audit.some((row) => row.action === 'edge.candidate.approve'));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('autoFacts queue candidate edges only when graphCandidateAutoFacts is enabled', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-edge-autofacts-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { autoFacts: true, graphCandidateAutoFacts: true } } });
  try {
    const written = cortex.write({ text: '主人喜欢白饭。', explicit: true });
    assert.ok(written.edgeCandidates.length >= 1);
    assert.ok(cortex.graphCandidates({ scopeId: 'global' }).length >= 1);
    assert.equal(cortex.graphData({ scopeId: 'global' }).edges.length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('autoFacts do not queue candidate edges by default', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-edge-autofacts-off-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { autoFacts: true } } });
  try {
    const written = cortex.write({ text: '主人喜欢白饭。', explicit: true });
    assert.equal(written.edgeCandidates?.length ?? 0, 0);
    assert.equal(cortex.graphCandidates({ scopeId: 'global' }).length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejected candidates and candidate downgrade protection', () => {
  const { dir, db, edges } = setup();
  try {
    const active = edges.upsert({ scopeId: 'global', fromId: 'ent_a', toId: 'ent_b', rel: 'related', weight: 1 });
    const attempted = edges.addCandidate({ scopeId: 'global', fromId: 'ent_a', toId: 'ent_b', rel: 'related', confidence: 0.2 });
    assert.equal(attempted.id, active.id);
    assert.equal(edges.get(active.id).metadata.status, undefined);

    const candidate = edges.addCandidate({ scopeId: 'global', fromId: 'ent_c', toId: 'ent_d', rel: 'related', confidence: 0.4 });
    const rejected = edges.rejectCandidate(candidate.id);
    assert.equal(rejected.metadata.status, 'rejected');
    assert.equal(edges.list({ scopeId: 'global' }).length, 1);
    assert.equal(edges.listCandidates({ scopeId: 'global' }).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
