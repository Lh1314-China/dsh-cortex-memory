import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import {
  proposeIntentions,
  filterIntentions,
  createInitiativeStore,
  selectIntentions,
  DEFAULT_INITIATIVE_POLICY,
} from '../../src/self/initiative.js';

const NOON = Date.parse('2026-11-11T12:00:00+08:00');

test('disputes and coherence deficits produce high-priority intentions', () => {
  const list = proposeIntentions({
    unresolvedDisputes: 2,
    selfState: { drives: { coherence: 0.2, safety: 0.8, care: 0.6, curiosity: 0.5, autonomy: 0.5, expression: 0.5 } },
    lastConsolidationAt: null,
    now: NOON,
  });
  assert.equal(list[0].kind, 'question');
  assert.ok(list.some((item) => item.kind === 'consolidate'));
});

test('curiosity and identity relevance propose questions and proposals', () => {
  const list = proposeIntentions({
    selfState: { drives: { coherence: 0.7, safety: 0.8, care: 0.6, curiosity: 0.9, autonomy: 0.5, expression: 0.5 } },
    appraisal: { novelty: 0.8, identityRelevance: 0.7, relevance: 0.7, valence: 0.2, text: '新东西' },
    now: NOON,
  });
  assert.ok(list.some((item) => item.kind === 'question'));
  assert.ok(list.some((item) => item.kind === 'propose'));
});

test('cooldown suppresses the same kind but not other kinds', () => {
  const proposed = [
    { kind: 'question', priority: 0.8, createdAt: new Date(NOON).toISOString() },
    { kind: 'consolidate', priority: 0.7, createdAt: new Date(NOON).toISOString() },
  ];
  const recent = [{ kind: 'question', createdAt: new Date(NOON - 5 * 60_000).toISOString() }];
  const filtered = filterIntentions(proposed, { now: NOON, recent, policy: DEFAULT_INITIATIVE_POLICY });
  assert.equal(filtered.some((item) => item.kind === 'question'), false);
  assert.equal(filtered.some((item) => item.kind === 'consolidate'), true);
});

test('hourly budget limits proactive intentions', () => {
  const proposed = Array.from({ length: 5 }, (_, i) => ({
    kind: i % 2 === 0 ? 'express' : 'recall',
    priority: 0.9 - i * 0.01,
    createdAt: new Date(NOON).toISOString(),
  }));
  const recent = Array.from({ length: 3 }, () => ({ kind: 'recall', createdAt: new Date(NOON - 10 * 60_000).toISOString() }));
  const filtered = filterIntentions(proposed, { now: NOON, recent, policy: DEFAULT_INITIATIVE_POLICY });
  assert.equal(filtered.length, 0);
});

test('quiet hours suppress all proactive intentions', () => {
  const proposed = [{ kind: 'question', priority: 0.9, createdAt: new Date(NOON).toISOString() }];
  const policy = { ...DEFAULT_INITIATIVE_POLICY, quietHours: [[23, 8]] };
  const night = Date.parse('2026-11-11T02:00:00+08:00');
  assert.deepEqual(filterIntentions(proposed, { now: night, recent: [], policy }), []);
});

test('initiative store persists pending intentions and marks results', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-initiative-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  try {
    const store = createInitiativeStore(db);
    const selected = selectIntentions({
      selfState: { drives: { coherence: 0.2, safety: 0.8, care: 0.6, curiosity: 0.5, autonomy: 0.5, expression: 0.5 } },
      lastConsolidationAt: null,
      store,
      now: NOON,
    });
    assert.ok(selected.length >= 1);
    const pending = store.pending('global', { now: NOON });
    assert.ok(pending.some((item) => item.id === selected[0].id));
    store.mark(selected[0].id, 'done', { ok: true });
    assert.equal(store.get(selected[0].id).status, 'done');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
