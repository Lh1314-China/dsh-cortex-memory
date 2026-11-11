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
import { createEdgeRepository } from '../../src/store/repositories/edges.js';
import { createEncodeEngine } from '../../src/engines/encode.js';
import { createGraphEngine } from '../../src/engines/graph.js';
import { createRetrievalEngine } from '../../src/engines/retrieve.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const entities = createEntityRepository(db);
  const facts = createFactRepository(db);
  const edges = createEdgeRepository(db);
  const encode = createEncodeEngine({ events, traces, entities, facts, config: { minCompressionValue: 0.01 } });
  const graph = createGraphEngine({ entities, facts, edges, traces });
  const retrieve = createRetrievalEngine({ traces, facts, graph, config: { contextBudget: 500 } });
  return { dir, db, events, traces, entities, facts, edges, encode, graph, retrieve };
}

test('graph PPR expands from a seed entity through facts and edges', () => {
  const { dir, db, encode, graph } = setup();
  try {
    const now = Date.parse('2026-11-11T12:00:00+08:00');
    encode.encode({ text: 'A 认识 B，B 认识 C。', explicit: true, now, facts: [
      { subject: 'A', predicate: 'knows', object: 'B' },
      { subject: 'B', predicate: 'knows', object: 'C' },
    ] });
    const result = graph.search('A', { at: new Date(now).toISOString() });
    assert.ok(result.seeds.length >= 1);
    assert.ok(result.entities.some((item) => item.entity.name === 'B'));
    assert.ok(result.traces.length >= 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('temporal edges are filtered by neighbours()', () => {
  const { dir, db, entities, edges } = setup();
  try {
    const a = entities.upsert({ name: 'A' });
    const b = entities.upsert({ name: 'B' });
    const old = edges.upsert({ fromId: a.id, toId: b.id, rel: 'old', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-02-01T00:00:00.000Z' });
    const fresh = edges.upsert({ fromId: a.id, toId: b.id, rel: 'fresh', validFrom: '2026-11-01T00:00:00.000Z' });
    const at = '2026-11-11T00:00:00.000Z';
    const neighbours = edges.neighbors(a.id, { at, direction: 'out' });
    assert.equal(neighbours.some((edge) => edge.id === old.id), false);
    assert.equal(neighbours.some((edge) => edge.id === fresh.id), true);
    assert.equal(edges.get(fresh.id).rel, 'fresh');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieval includes a graph source when graph results map to traces', () => {
  const { dir, db, encode, retrieve } = setup();
  try {
    const now = Date.parse('2026-11-11T12:00:00+08:00');
    encode.encode({ text: 'A 认识 B。', explicit: true, now, facts: [{ subject: 'A', predicate: 'knows', object: 'B' }] });
    const result = retrieve.search('A', { now, budget: 500 });
    assert.ok(result.trace.sources.some((source) => source.source === 'graph' && source.ok));
    assert.ok(result.items.length >= 1);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
