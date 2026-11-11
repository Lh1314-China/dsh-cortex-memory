import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createQaEngine } from '../../src/engines/qa.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-qa-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  cortex.write({ text: '主人最喜欢白饭。', title: '白饭', explicit: true });
  cortex.write({ text: '本鲸会一直等主人。', title: '等待', explicit: true });
  return { dir, cortex };
}

test('qa engine extracts evidence without an LLM', async () => {
  const { dir, cortex } = setup();
  try {
    const qa = createQaEngine({ cortex });
    const result = await qa.answer({ question: '主人喜欢什么？' });
    assert.equal(result.mode, 'extractive');
    assert.ok(result.sources.length >= 1);
    assert.match(result.answer, /白饭|抽取式/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('qa engine abstains on irrelevant queries even when recent memory exists', async () => {
  const { dir, cortex } = setup();
  try {
    const qa = createQaEngine({ cortex, llm: { complete: async () => 'should not be called' } });
    const result = await qa.answer({ question: 'xyzzyplugh' });
    assert.equal(result.mode, 'abstain');
    assert.equal(result.sources.length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('qa reranker can reorder evidence before answering', async () => {
  const qa = createQaEngine({
    cortex: {
      search: () => ({
        items: [
          { id: 'a', layer: 'L2', title: 'A', snippet: '不相关', trace: {} },
          { id: 'b', layer: 'L2', title: 'B', snippet: '相关', trace: {} },
        ],
        trace: { sources: [{ source: 'fts', count: 2 }] },
      }),
    },
    reranker: { rerank: async () => [{ index: 1, score: 0.9 }, { index: 0, score: 0.1 }] },
  });
  const result = await qa.answer({ question: '测试' });
  assert.equal(result.sources[0].id, 'b');
  assert.match(result.answer, /相关/);
});

test('host prefetch recall is not charged to the search budget', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-prefetch-budget-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), maxCallsPerHour: 1 } });
  try {
    cortex.write({ text: '主人最喜欢白饭。', explicit: true });
    assert.equal(cortex.search('白饭', { noBudget: true }).items.length, 1);
    assert.equal(cortex.search('白饭', { noBudget: true }).items.length, 1);
    assert.equal(cortex.budget.snapshot().calls, 0);
    assert.equal(cortex.search('白饭').items.length, 1);
    assert.equal(cortex.search('白饭').trace.blocked, 'budget');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('qa engine uses an injected LLM and abstains when nothing is recalled', async () => {
  const { dir, cortex } = setup();
  try {
    const qa = createQaEngine({ cortex, llm: { complete: async () => '白饭 [1]' } });
    const result = await qa.answer({ question: '主人喜欢什么？' });
    assert.equal(result.mode, 'llm');
    assert.match(result.answer, /白饭/);
    const emptyDir = mkdtempSync(path.join(os.tmpdir(), 'cortex-qa-empty-'));
    const empty = createCortex({ config: { dataRoot: emptyDir, dbFile: path.join(emptyDir, 'cortex.sqlite') } });
    try {
      const emptyQa = createQaEngine({ cortex: empty, llm: { complete: async () => 'should not be called' } });
      const missing = await emptyQa.answer({ question: 'xyzzyplugh' });
      assert.equal(missing.mode, 'abstain');
      assert.equal(missing.sources.length, 0);
    } finally {
      empty.close();
      rmSync(emptyDir, { recursive: true, force: true });
    }
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
