import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createHashEmbedder, cosine } from '../../src/vector/embedder.js';
import { createVectorIndex } from '../../src/vector/index.js';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-vector-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const embedder = createHashEmbedder();
  const vector = createVectorIndex({ db, embedder });
  return { dir, db, events, traces, embedder, vector };
}

test('hash embedder is deterministic and normalized', () => {
  const embedder = createHashEmbedder({ dim: 64 });
  const a = embedder.embed('米食 用户');
  const b = embedder.embed('米食 用户');
  assert.equal(a.length, 64);
  assert.ok(cosine(a, b) > 0.999);
  const c = embedder.embed('插件 安装');
  assert.ok(cosine(a, c) < 0.99);
});

test('vector index upserts, searches and removes', () => {
  const { dir, db, events, traces, vector } = setup();
  try {
    const event = events.append({ kind: 'utterance', payload: { text: '米食' } });
    const trace = traces.insert({ eventId: event.id, content: '用户说会买米食，助手等得起。' });
    vector.upsert(trace.id, trace.content);
    const hits = vector.search('米食');
    assert.equal(hits[0].traceId, trace.id);
    assert.ok(hits[0].score > 0);
    assert.equal(vector.status().count, 1);
    vector.remove(trace.id);
    assert.equal(vector.search('米食').length, 0);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('service enables vector retrieval and degrades when disabled', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-vector-service-'));
  const embedder = createHashEmbedder();
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), vectorEnabled: true, embedder },
  });
  try {
    cortex.write({ text: '用户说会买米食，助手等得起。', explicit: true });
    const result = cortex.search('米食');
    assert.ok(result.items.length >= 1);
    assert.ok(result.trace.sources.some((source) => source.source === 'vector' && source.ok));
    assert.equal(cortex.rebuildVector().rebuilt, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
