import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { buildLoCoMoIndex, evaluateLoCoMoRetrieval } from '../../bench/locomo.js';

const sample = {
  sample_id: 'conv-1',
  conversation: {
    speaker_a: 'A',
    speaker_b: 'B',
    session_1_date_time: '2026-11-01T10:00:00+08:00',
    session_1: [
      { speaker: 'A', text: '我喜欢白饭。' },
      { speaker: 'B', text: '那很好。' },
    ],
    session_2_date_time: '2026-11-02T10:00:00+08:00',
    session_2: [
      { speaker: 'A', text: '今天修了插件。' },
    ],
  },
  qa: [
    { question: 'A 喜欢什么？', answer: '白饭', evidence: ['D1:1'], category: 1 },
    { question: '不存在的事是什么？', answer: '没有', evidence: [], category: 5 },
  ],
};

test('LoCoMo adapter maps evidence turns to trace relevance', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-locomo-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const built = buildLoCoMoIndex({ cortex, samples: [sample] });
    assert.equal(built.traces, 3);
    assert.equal(built.queries.length, 2);
    assert.equal(built.queries[0].relevant.length, 1);
    const result = await evaluateLoCoMoRetrieval({ cortex, samples: [sample], limit: 5 });
    assert.equal(result.built.evaluated, 1);
    assert.ok(result.recallAtK >= 0 && result.recallAtK <= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
