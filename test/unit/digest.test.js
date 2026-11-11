import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('daily digest counts traces and persists a digest summary', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-digest-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const at = Date.parse('2026-11-11T10:00:00+08:00');
    cortex.write({ text: '今天修好了 API。', explicit: true, importance: 0.8, now: at });
    cortex.write({ text: '今天写了一篇日记。', explicit: true, now: at + 1000 });
    cortex.emotion.record({ text: '本鲸有点开心。', target: '主人', at: '2026-11-11T10:05:00+08:00' });
    const digest = cortex.digest.daily({ date: '2026-11-11', now: at + 2000 });
    assert.equal(digest.counts.traces, 2);
    assert.equal(digest.counts.emotions, 1);
    assert.match(digest.content, /记忆摘要/);
    assert.ok(digest.summary);
    assert.ok(cortex.repos.summaries.list('global', { limit: 10 }).length >= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
