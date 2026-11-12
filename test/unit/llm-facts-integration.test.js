import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('llmFacts schedules background extraction and writes validated facts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-llm-facts-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llmFacts: true } },
    llm: {
      available: () => true,
      complete: async () => '{"facts":[{"subject":"助手","predicate":"likes","object":"白饭","confidence":0.9},{"subject":"x","predicate":"y","object":"z","confidence":0.1}]}',
    },
  });
  try {
    cortex.write({ text: '助手喜欢白饭。', explicit: true });
    await cortex.flushLlmFacts();
    const facts = cortex.repos.facts.list({ scopeId: 'global' });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].predicate, 'likes');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
