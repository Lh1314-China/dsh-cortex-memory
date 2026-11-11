import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createVectorIndex } from '../../src/vector/index.js';

function asyncEmbedder() {
  return {
    kind: 'openai-embedding', model: 'mock-embed', dim: 4,
    async embed(text) {
      const value = String(text);
      return Float32Array.from([value.includes('米食') ? 1 : 0, value.includes('面') ? 1 : 0, 0.1, 0.1]);
    },
  };
}

test('async vector indexing does not block and can be awaited explicitly', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-async-vector-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const written = cortex.write({ text: '用户喜欢米食。', explicit: true });
    const index = createVectorIndex({ db: cortex.db, embedder: asyncEmbedder() });
    const pending = index.upsert(written.trace.id, '用户喜欢米食。');
    assert.equal(pending.pending, true);
    assert.equal(index.status().count, 0);
    await index.upsertAsync(written.trace.id, '用户喜欢米食。');
    assert.equal(index.status().count, 1);
    const hits = await index.searchAsync('米食', { scopeId: 'global', limit: 3 });
    assert.equal(hits[0].traceId, written.trace.id);
    const rebuilt = await index.rebuildAsync({ scopeId: 'global' });
    assert.equal(rebuilt.rebuilt, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('service async search uses the async vector path', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-async-hybrid-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), vectorEnabled: true, features: { vector: true }, embedder: asyncEmbedder() } });
  try {
    const written = cortex.write({ text: '用户喜欢米食。', explicit: true });
    await cortex.indexVectorAsync(written.trace.id);
    const result = await cortex.searchAsync('米食');
    assert.ok(result.items.some((item) => item.id === written.trace.id));
    assert.ok(result.trace.sources.some((source) => source.source === 'vector' && source.count > 0));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('service exposes async index and rebuild without changing sync search', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-async-service-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), vectorEnabled: true, features: { vector: true }, embedder: asyncEmbedder() } });
  try {
    const written = cortex.write({ text: '用户喜欢面。', explicit: true });
    const indexed = await cortex.indexVectorAsync(written.trace.id);
    assert.equal(indexed.traceId, written.trace.id);
    const rebuilt = await cortex.rebuildVectorAsync({ scopeId: 'global' });
    assert.equal(rebuilt.rebuilt, 1);
    assert.ok(cortex.vector.status().count >= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
