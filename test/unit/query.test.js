import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matchesFilters } from '../../src/memory/query.js';

test('query parser separates filters from free text', () => {
  const parsed = parseQuery('kind:utterance tag:米食 after:2026-11-01 importance:>0.5 用户 米食');
  assert.equal(parsed.text, '用户 米食');
  assert.equal(parsed.filters.kind, 'utterance');
  assert.deepEqual(parsed.filters.tags, ['米食']);
  assert.equal(parsed.filters.after, '2026-11-01');
  assert.deepEqual(parsed.filters.importance, { op: '>', value: 0.5 });
});

test('query filters match kind, tags, time range and importance', () => {
  const trace = {
    kind: 'utterance',
    state: 'active',
    tags: ['米食', '承诺'],
    recordedAt: '2026-11-05T10:00:00+08:00',
    importance: 0.8,
  };
  assert.equal(matchesFilters(trace, { kind: 'utterance', tags: ['米食'], after: '2026-11-01', before: '2026-12-01', importance: { op: '>', value: 0.5 } }), true);
  assert.equal(matchesFilters(trace, { kind: 'reflection' }), false);
  assert.equal(matchesFilters(trace, { tags: ['不存在'] }), false);
  assert.equal(matchesFilters(trace, { before: '2026-11-01' }), false);
  assert.equal(matchesFilters(trace, { importance: { op: '<', value: 0.5 } }), false);
});

test('unknown prefixes remain free text', () => {
  const parsed = parseQuery('foo:bar 米食');
  assert.equal(parsed.text, 'foo:bar 米食');
  assert.deepEqual(parsed.filters, {});
});

test('service search applies kind and tag filters before ranking', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createCortex } = await import('../../src/service/cortex.js');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-query-service-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({ text: '用户喜欢米食。', kind: 'utterance', tags: ['米食'], explicit: true });
    cortex.write({ text: '反思：米食的承诺。', kind: 'reflection', tags: ['米食'], explicit: true });
    const result = cortex.search('kind:utterance tag:米食 米食');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].layer, 'L2');
    assert.ok(result.items.every((item) => item.id));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
