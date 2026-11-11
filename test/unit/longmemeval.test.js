import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { buildLongMemEvalIndex, evaluateLongMemEvalRetrieval, instanceType } from '../../bench/longmemeval.js';

const fixture = [
  {
    question_id: 'q1',
    question_type: 'single-session-user',
    question: '用户喜欢什么主食？',
    answer: '米食',
    question_date: '2026-11-11T12:00:00+08:00',
    haystack_session_ids: ['s1', 's2'],
    haystack_dates: ['2026-11-01T12:00:00+08:00', '2026-11-02T12:00:00+08:00'],
    haystack_sessions: [
      [{ role: 'user', content: '用户最喜欢米食。', has_answer: true }],
      [{ role: 'user', content: '今天修插件。' }],
    ],
    answer_session_ids: ['s1'],
  },
  {
    question_id: 'q2_abs',
    question_type: 'temporal-reasoning',
    question: '不存在的约定是哪天？',
    answer: '没有',
    question_date: '2026-11-11T12:00:00+08:00',
    haystack_session_ids: ['s3'],
    haystack_dates: ['2026-11-03T12:00:00+08:00'],
    haystack_sessions: [[{ role: 'user', content: '没有这件事。' }]],
    answer_session_ids: [],
  },
];

test('LongMemEval adapter builds traces and query relevance', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-lme-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const built = buildLongMemEvalIndex({ cortex, instances: fixture });
    assert.equal(built.traces, 3);
    assert.equal(built.queries.length, 2);
    const q1 = built.queries.find((query) => query.id === 'q1');
    assert.equal(q1.relevant.length, 1);
    assert.equal(q1.abstention, false);
    assert.equal(instanceType(fixture[1]), 'abstention');
    const result = evaluateLongMemEvalRetrieval({ cortex, instances: fixture, limit: 5 });
    assert.equal(result.built.evaluated, 1);
    assert.ok(result.recallAtK >= 0);
    assert.ok(result.recallAtK <= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
