import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-preview-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { cortex, dir };
}

test('coverage2：摘要正文真的装下才给分，薄摘要封顶 0.35', () => {
  const trace = { id: 't1', title: '辉夜姬', content: '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。' };
  const good = { id: 's1', content: '今天在图书馆看了超时空辉夜姬第三集，很好笑，还吃了米饭。' };
  const thin = { id: 's2', content: '图书馆' };
  const unrelated = { id: 's3', content: '完全无关的一句话。' };
  const { cortex, dir } = setup();
  try {
    const goodScore = cortex.compression.coverage2(trace, [good]);
    const thinScore = cortex.compression.coverage2(trace, [thin]);
    const noneScore = cortex.compression.coverage2(trace, [unrelated]);
    assert.ok(goodScore.score >= 0.6, `装得下的摘要应给高分，实际 ${goodScore.score}`);
    assert.ok(thinScore.score <= 0.35, '薄摘要必须封顶');
    assert.equal(noneScore.score, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('previewCoverage：只读、跳过保护与近期访问、给出分位', () => {
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) {
      cortex.write({ text: `用户：一条普通记录 ${i}`, kind: 'utterance', title: `普通 ${i}`, importance: 0.7, explicit: true, now });
    }
    cortex.write({ text: '用户：一条受保护的记录', kind: 'utterance', title: '保护', importance: 0.99, explicit: true, now });
    const before = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 50 }).length;
    const report = cortex.compression.previewCoverage({ scopeId: 'global', limit: 100 });
    const after = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 50 }).length;
    assert.equal(before, after, '预演不能改库');
    assert.equal(report.total, 7);
    assert.ok(report.protectedSkipped >= 1, '高重要度应被跳过');
    assert.ok(report.percentiles && typeof report.percentiles.p90 === 'number');
    assert.ok(Array.isArray(report.wouldCut));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('高频通用词会被 DF 过滤：只含「我们/可以」的摘要不该算覆盖', async () => {
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    for (let i = 0; i < 30; i += 1) {
      cortex.write({ text: `我们可以做第${i}件事，这件事有点特别。`, kind: 'utterance', title: `样本 ${i}`, importance: 0.7, explicit: true, now });
    }
    cortex.repos.summaries.insert({
      scopeId: 'global', level: 'episode', content: '我们可以。', sourceIds: [], coverage: 1, model: 'test',
    });
    const report = cortex.compression.previewCoverage({ scopeId: 'global', limit: 100 });
    assert.equal(report.summaryCovered, 0, '通用二字词被过滤后不应算覆盖');
    assert.equal(report.pool, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('只有摘要一条证据时，不把单证据条目当候选输出', async () => {
  const { cortex, dir } = setup();
  try {
    const now = Date.now();
    cortex.write({ text: '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑，还吃了米饭。', kind: 'utterance', title: '辉夜姬', importance: 0.7, explicit: true, now });
    cortex.repos.summaries.insert({
      scopeId: 'global', level: 'episode', content: '今天在图书馆看了超时空辉夜姬第三集，很好笑，还吃了米饭。', sourceIds: [], coverage: 1, model: 'test',
    });
    const report = cortex.compression.previewCoverage({ scopeId: 'global', limit: 50 });
    assert.ok(report.pool >= 0);
    assert.equal(report.strongPool, 0, '没有事实时不存在两类证据');
    assert.equal(report.wouldCut.length, 0, '单证据不能当候选');
    assert.ok(['no_signal', 'single-evidence-only'].includes(report.reason));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
