import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('belief uses the transaction timestamp, not updated_at', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-belief-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const t1 = Date.parse('2026-11-10T10:00:00+08:00');
    const t2 = Date.parse('2026-11-11T10:00:00+08:00');
    cortex.write({ text: '主人喜欢白饭。', explicit: true, now: t1, facts: [{ subject: '主人', predicate: '喜欢', object: '白饭' }] });
    cortex.write({ text: '主人现在喜欢面。', explicit: true, now: t2, facts: [{ subject: '主人', predicate: '喜欢', object: '面' }] });
    const old = cortex.asOf({ subject: '主人', predicate: '喜欢', at: new Date(t2 - 1000).toISOString(), mode: 'belief' });
    assert.equal(old.facts.length, 1);
    assert.match(old.facts[0].object, /白饭/);
    assert.ok(old.facts[0].supersededAt);
    const now = cortex.asOf({ subject: '主人', predicate: '喜欢', at: new Date(t2 + 1000).toISOString(), mode: 'belief' });
    assert.equal(now.facts.length, 1);
    assert.match(now.facts[0].object, /面/);
    const historical = cortex.asOf({ subject: '主人', predicate: '喜欢', at: new Date(t1 + 1000).toISOString(), mode: 'historical' });
    assert.match(historical.facts[0].object, /白饭/);
    const strict = cortex.asOf({ subject: '主人', predicate: '喜欢', mode: 'strict' });
    assert.match(strict.facts[0].object, /面/);
    assert.doesNotMatch(strict.facts.map((fact) => fact.object).join(' '), /白饭/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
