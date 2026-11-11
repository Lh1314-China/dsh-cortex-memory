import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ftsText, buildMatchQuery } from '../../src/memory/tokenizer.js';
import { createCortex } from '../../src/service/cortex.js';

test('CJK soft FTS keeps bigrams and adds non-stop single characters', () => {
  const exact = ftsText('白饭 记忆引擎');
  assert.equal(exact, '白饭 记忆 忆引 引擎 记忆引擎');
  const indexed = ftsText('白饭 记忆引擎', { soft: true });
  assert.ok(indexed.includes('白饭'));
  assert.ok(indexed.includes('饭'));
  assert.ok(indexed.includes('记忆引擎'));
  assert.ok(indexed.includes('记'));
  const query = buildMatchQuery('米饭', { soft: true });
  assert.ok(query.includes('米饭'));
  assert.ok(query.includes('米'));
  assert.ok(query.includes('饭'));
  assert.equal(buildMatchQuery('米饭'), '"米饭"');
});

test('a shared-character paraphrase can fall back to FTS', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-char-fts-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({ text: '白饭', explicit: true });
    const result = cortex.search('米饭', { limit: 10 });
    assert.ok(result.items.some((item) => item.snippet?.includes('白饭')));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
