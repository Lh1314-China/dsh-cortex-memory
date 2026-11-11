import test from 'node:test';
import assert from 'node:assert/strict';
import { makeId, hashText, chainHash } from '../../src/core/ids.js';
import { normalizeConfig } from '../../src/core/config.js';
import { parseTimeWindow, daysBetween } from '../../src/core/time.js';
import { stableStringify } from '../../src/core/json.js';
import { tokenList, tokens, ftsText, buildMatchQuery, jaccard, estimateTokens } from '../../src/memory/tokenizer.js';

test('makeId is prefixed and lexically ordered by time', () => {
  const a = makeId('trc', 1000);
  const b = makeId('trc', 2000);
  assert.match(a, /^trc_/);
  assert.ok(a < b);
  assert.notEqual(a, b);
});

test('hashText and chainHash are stable', () => {
  assert.equal(hashText('白饭'), hashText('白饭'));
  assert.notEqual(hashText('白饭'), hashText('米饭'));
  assert.equal(chainHash(null, 'x'), chainHash(null, 'x'));
  assert.notEqual(chainHash(null, 'x'), chainHash('a', 'x'));
});

test('stableStringify sorts object keys and rejects cycles', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => stableStringify(cycle));
});

test('tokenizer builds CJK bigrams and latin terms', () => {
  const list = tokenList('主人说白饭很好吃 DSH-plugin 2026');
  assert.ok(list.includes('白饭'));
  assert.ok(list.includes('主人'));
  assert.ok(list.includes('dsh'));
  assert.ok(list.includes('plugin'));
  assert.ok(tokens('白饭').has('白饭'));
  assert.equal(ftsText('白饭'), '白饭');
});

test('FTS match query quotes tokens and supports AND', () => {
  assert.equal(buildMatchQuery('白饭 主人'), '"白饭" OR "主人"');
  assert.equal(buildMatchQuery('白饭 主人', { mode: 'and' }), '"白饭" AND "主人"');
  assert.equal(buildMatchQuery(''), '');
});

test('jaccard and estimateTokens are bounded', () => {
  assert.equal(jaccard('白饭 主人', '白饭 主人'), 1);
  assert.ok(jaccard('白饭 主人', '插件 安装') < 0.2);
  assert.ok(estimateTokens('') === 0);
  assert.ok(estimateTokens('白饭') >= 1);
});

test('config normalizes paths and clamps numbers', () => {
  const config = normalizeConfig({
    dataRoot: 'relative-data',
    dbFile: ':memory:',
    contextBudget: 999999,
    recallTimeoutMs: 1,
    dsr: { decay: -2, archiveRetrievability: 2 },
  });
  assert.ok(config.dataRoot.endsWith('relative-data'));
  assert.equal(config.dbFile, ':memory:');
  assert.equal(config.contextBudget, 20000);
  assert.equal(config.recallTimeoutMs, 100);
  assert.equal(config.dsr.decay, -1);
  assert.equal(config.dsr.archiveRetrievability, 0.9);
});

test('time helpers parse windows and age', () => {
  const now = Date.parse('2026-11-11T00:00:00.000Z');
  const today = parseTimeWindow('今天做了什么', now);
  assert.ok(today.from < today.to);
  const ago = parseTimeWindow('3天前的事', now);
  assert.ok(ago.from < ago.to);
  assert.ok(daysBetween('2026-11-01T00:00:00.000Z', now) >= 9);
});
