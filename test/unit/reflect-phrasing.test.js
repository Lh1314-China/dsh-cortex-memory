import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('摘要用第一人称句式，要点不重复，coverage 仍按重要度加权算', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reflect-phrasing-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    for (let i = 0; i < 60; i += 1) {
      cortex.write({
        text: `用户：第 ${i} 条，记一下这件事的来龙去脉。`,
        kind: 'utterance',
        title: `句式样本 ${i}`,
        explicit: true,
        now,
      });
    }
    const report = cortex.maintain({ now });
    assert.equal(report.reflection?.created, true);
    const episode = cortex.repos.summaries.list('global', { level: 'episode', limit: 1 })[0];
    assert.match(episode.content, /我记下了：/, '应是第一人称句式');
    assert.match(episode.content, /\n· /, '要点用 · 而不是列表符');

    // 「一句话」聚合行不能与任何要点逐字相同，也不能把要点重复两遍
    const bullets = episode.content.split('\n').filter((line) => line.startsWith('· '));
    assert.equal(new Set(bullets).size, bullets.length, '要点不该重复');
    const gistLines = episode.content.split('\n').filter((line) => line.startsWith('一句话：'));
    for (const line of gistLines) {
      const text = line.replace(/^一句话：/, '');
      assert.ok(!bullets.includes(text), '聚合行不能是某条要点的复制');
      assert.equal(episode.content.split(text).length - 1, 1, '同一句只出现一次');
    }

    // coverage 口径：source 的 importance 权重 / 窗口内全部权重
    const sources = new Set(episode.sourceIds);
    const all = cortex.repos.traces.listSince('global', episode.periodStart, { limit: 500 }).filter((t) => t.kind !== 'reflection');
    const weight = (trace) => Math.max(0.05, Number(trace.importance) || 0.5);
    const total = all.reduce((sum, trace) => sum + weight(trace), 0);
    const covered = all.filter((trace) => sources.has(trace.id)).reduce((sum, trace) => sum + weight(trace), 0);
    const expected = Math.round((covered / total) * 1000) / 1000;
    assert.equal(Math.round(episode.coverage * 1000) / 1000, expected, 'coverage 算法不能被句式改动带偏');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('要点够多时，「一句话」是拼出来的概括，不是复制某条要点', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reflect-gist-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    const words = ['向量回填', '捕获剥离', '摘要窗口', '复活预算', '分层预算', '交接单', '彩排脚本', '备份闸门', '健康检查', '实体图', '事实争议', '日记', '梦境', '召唤卡', '工具契约', '调度节奏'];
    for (let i = 0; i < 40; i += 1) {
      const text = '用户：记一下 ' + words[i % words.length] + ' 与 ' + words[(i * 7 + 3) % words.length] + ' 这件事，编号 ' + i + '。';
      cortex.write({ text, kind: 'utterance', title: '要点 ' + i + ' ' + words[i % words.length], explicit: true, now });
    }
    const result = cortex.engines.reflect.reflect({ scopeId: 'global', now, segment: true, since: new Date(now - 3600000).toISOString(), force: true });
    assert.equal(result.skipped, false);
    const lines = result.summary.content.split('\n');
    const bullets = lines.filter((line) => line.startsWith('· ')).map((line) => line.slice(2));
    const gist = lines.find((line) => line.startsWith('一句话：'));
    assert.ok(bullets.length >= 3, '这个场景应该选到至少 3 条要点，实际 ' + bullets.length);
    assert.ok(gist, '要点够多时应有聚合行');
    const text = gist.replace(/^一句话：/, '');
    assert.ok(!bullets.includes(text), '聚合行不能与任何要点逐字相同');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
