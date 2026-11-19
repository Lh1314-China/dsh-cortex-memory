import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('其他 scope 的痕迹不会让 health 误报 FTS 漂移', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-fts-scope-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    cortex.write({ text: '用户：global 的一条痕迹。', kind: 'utterance', explicit: true, now });
    const event = cortex.repos.events.append({ kind: 'trace.agency', scopeId: 'agency', at: new Date(now).toISOString() });
    cortex.repos.traces.insert({
      id: 'trc_agencyscope00001',
      scopeId: 'agency',
      kind: 'observation',
      title: 'agency 痕迹',
      content: '只属于 agency scope 的一条痕迹',
      eventId: event.id,
      recordedAt: new Date(now).toISOString(),
    });
    const health = cortex.health({ scopeId: 'global' });
    const drift = health.issues.find((issue) => issue.code === 'FTS_DRIFT');
    assert.equal(drift, undefined, '别的 scope 的行不该算成漂移');
    assert.equal(health.counts.fts, 1, 'fts 计数应与 global 的 traces 对齐');
    assert.equal(health.counts.traces.total, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
