import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('privacy deleteScope removes derived memory while keeping the event ledger', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-privacy-scope-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({ text: '主人喜欢白饭。', explicit: true, facts: [{ subject: '主人', predicate: 'likes', object: '白饭' }] });
    cortex.working.add({ text: '一个焦点' });
    cortex.goals.add({ title: '一个目标' });
    cortex.engines.skills.create({ name: '一个技能', steps: ['a'], state: 'active' });
    cortex.life.diaryWrite({ text: '会被清掉的日记' });
    await cortex.life.dreamGenerate({ at: Date.now() });
    await cortex.life.sleep({ at: Date.now() });
    cortex.working.add({ text: '另一个焦点' });
    const eventsBefore = cortex.repos.events.count();
    const result = cortex.privacy.deleteScope('global', { reason: 'test' });
    assert.equal(result.removed, true);
    assert.ok(result.counts.traces >= 1);
    assert.ok(result.counts.diary >= 1);
    assert.ok(result.counts.dreams >= 1);
    assert.ok(result.counts.sleeps >= 1);
    assert.equal(cortex.repos.traces.count(), 0);
    assert.equal(cortex.repos.facts.list().length, 0);
    assert.equal(cortex.working.list().length, 0);
    assert.equal(cortex.goals.list().length, 0);
    assert.equal(cortex.life.diaryList().length, 0);
    assert.equal(cortex.life.dreamList().length, 0);
    assert.equal(cortex.life.sleepRuns().length, 0);
    assert.equal(cortex.repos.events.count(), eventsBefore);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
