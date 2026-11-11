import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-autonomy-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('autonomy tick executes consolidate and recall, leaves external proposals', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.parse('2026-11-11T12:00:00+08:00');
    cortex.write({ text: '第一条记忆。', explicit: true, now: now - 2000 });
    cortex.write({ text: '第二条记忆。', explicit: true, now: now - 1000 });
    const consolidate = cortex.stores.initiativeStore.insert({
      kind: 'consolidate', priority: 0.9, reason: '整理', payload: {}, createdAt: new Date(now).toISOString(),
    });
    const recall = cortex.stores.initiativeStore.insert({
      kind: 'recall', priority: 0.8, reason: '找记忆', payload: { topic: '记忆' }, createdAt: new Date(now).toISOString(),
    });
    const external = cortex.stores.initiativeStore.insert({
      kind: 'external', priority: 0.7, reason: '发消息', payload: {}, createdAt: new Date(now).toISOString(),
    });
    const result = cortex.autonomy.tick({ at: now, max: 3 });
    assert.equal(result.executed.length, 2);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0].requires, 'host');
    assert.equal(cortex.stores.initiativeStore.get(consolidate.id).status, 'acted');
    assert.equal(cortex.stores.initiativeStore.get(recall.id).status, 'acted');
    assert.equal(cortex.stores.initiativeStore.get(external.id).status, 'pending');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('autonomy status is readable', () => {
  const { dir, cortex } = setup();
  try {
    cortex.stores.initiativeStore.insert({ kind: 'question', priority: 0.6, reason: '确认', payload: {}, createdAt: new Date().toISOString() });
    const status = cortex.autonomy.status();
    assert.equal(status.pending, 1);
    assert.equal(status.byKind.question, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
