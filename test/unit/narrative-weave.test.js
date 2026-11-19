import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('maintain 会织出第一条叙事线，间隔内不重复', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T20:00:00+08:00');
    for (let i = 0; i < 4; i += 1) {
      cortex.write({
        text: `第 ${i} 天在修记忆桥，把断掉的那段接上。`,
        kind: 'utterance',
        title: `修桥 ${i}`,
        explicit: true,
        tags: ['记忆桥'],
        now: now + i * 3600_000,
      });
    }
    // maybeAutoWeave 只在至少两条 episode 之后动手。
    for (let i = 0; i < 2; i += 1) {
      cortex.repos.summaries.insert({ scopeId: 'global', level: 'episode', content: `日 ${i} 的摘录`, coverage: 0.2 });
    }
    const first = cortex.maintain({ now });
    assert.ok(first.narrative?.built >= 1, '应织出至少一条线');
    const threads = cortex.db.prepare("SELECT COUNT(*) AS c FROM summaries WHERE level = 'thread'").get().c;
    assert.ok(threads >= 1, '库里应有 thread 摘要');
    const second = cortex.maintain({ now: now + 60_000 });
    assert.equal(second.narrative?.skipped, 'too-soon', '六小时内不重复织');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sleep 也会顺手织线并写进报告', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-sleep-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T20:00:00+08:00');
    for (let i = 0; i < 3; i += 1) {
      cortex.write({ text: `第 ${i} 条关于同一段经历的碎片。`, kind: 'utterance', title: `碎片 ${i}`, explicit: true, tags: ['经历'], now: now + i * 3600_000 });
    }
    const report = await cortex.life.sleep({ at: now + 4 * 3600_000 });
    assert.ok(report.narrative >= 1, '睡眠报告里应有织线数');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('叙事线写成一段话，不重复日期前缀', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-date-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T12:00:00+08:00');
    cortex.write({ text: '用户：今天把桥修好了。', kind: 'utterance', title: '2026-11-18 上午，用户回我「别急」', explicit: true, now });
    cortex.write({ text: '用户：晚上又修了一点。', kind: 'utterance', title: '2026-11-18 晚上，继续修', explicit: true, now: now + 3_600_000 });
    const traces = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 });
    const result = cortex.engines.narrative.buildThread({ seedTraceId: traces[0].id, at: now + 7_200_000 });
    assert.equal(result.skipped, false);
    assert.doesNotMatch(result.summary.content, /2026-11-18\s+2026-11-18/, '日期不应重复出现');
    assert.doesNotMatch(result.summary.content, /\n-\s/, '不再用 bullet 列表');
    assert.match(result.summary.content, /月\d+日/, '开头的日期应写成「11月18日」');
    assert.match(result.summary.content, /接着|最后/, '句子之间要有衔接');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('版本号里的「0.」不会被当成句末截断', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-version-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T22:30:00+08:00');
    cortex.write({ text: '2026-11-18 22:22：dsh-cortex 0.4.139 打包交付（575,499 B）。', kind: 'observation', title: '2026-11-18 22:22：dsh-cortex 0.4.139 打包交付', explicit: true, now: now - 1_800_000 });
    cortex.write({ text: '用户：种子这一句。', kind: 'utterance', title: '种子', importance: 0.6, explicit: true, now });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title === '种子');
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, at: now });
    assert.equal(result.skipped, false);
    assert.match(result.summary.content, /0\.4\.139/, '版本号应完整保留');
    assert.doesNotMatch(result.summary.content, /dsh-cortex 0\.[；。]/, '不该出现「dsh-cortex 0.」这种半句');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('长标题在标点处截断，不留半个括号', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-trim-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T22:40:00+08:00');
    const longTitle = '2026-11-18 22:22：dsh-cortex 0.4.140 打包交付，这一版修的是段落化的半句问题，还有三个小观感问题等着下一版一起收，包括括号截断和种子里残留的星号标记，以及一条自相矛盾的残片规则';
    cortex.write({ text: longTitle, kind: 'observation', title: longTitle, explicit: true, now: now - 1_800_000 });
    cortex.write({ text: '用户：种子这一句。', kind: 'utterance', title: '种子', importance: 0.6, explicit: true, now });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title === '种子');
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, at: now });
    assert.equal(result.skipped, false);
    const content = result.summary.content;
    const opens = (content.match(/（/g) || []).length;
    const closes = (content.match(/）/g) || []).length;
    assert.equal(opens, closes, '括号必须成对');
    assert.ok(content.length < 320, '长标题应被截短');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('说话类前缀挡住引用标记时，「用户：> 」也要一起剥掉', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-quote-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T23:00:00+08:00');
    cortex.write({ text: '用户：> 要彻底跟时间走有两条路：把时间权重提到 0.45–0.5。', kind: 'utterance', title: '> 要彻底跟时间走', importance: 0.6, explicit: true, now });
    cortex.write({ text: '用户：邻居这一条。', kind: 'utterance', title: '邻居', explicit: true, now: now - 1_800_000 });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title.includes('要彻底'));
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, at: now });
    assert.equal(result.skipped, false);
    assert.doesNotMatch(result.summary.content, />\s/, '「用户：> 」这种叠在一起的前缀也要剥干净');
    assert.doesNotMatch(result.summary.content, /用户：/, '说话类前缀不该留下');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('种子标题里的星号标记被清掉，结尾英文句号不算残片', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-seedtitle-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T22:45:00+08:00');
    cortex.write({ text: '用户：种子这一句。', kind: 'utterance', title: '**测试**：预期得纠正一下.', importance: 0.6, explicit: true, now });
    cortex.write({ text: '> 用户：类类观察日记.', kind: 'utterance', title: '类类观察日记.', explicit: true, now: now - 1_800_000 });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title.includes('测试'));
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, at: now });
    assert.equal(result.skipped, false);
    assert.doesNotMatch(result.summary.content, /\*\*/, '种子标题不该带星号');
    assert.doesNotMatch(result.summary.content, />\s/, '不该带引用标记');
    assert.match(result.summary.content, /类类观察日记/, '以英文句号结尾的完整句子不该被丢');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('weave 超过上限时淘汰最旧的叙事线', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-prune-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    for (let i = 0; i < 8; i += 1) {
      cortex.repos.summaries.insert({ scopeId: 'global', level: 'thread', content: `旧线 ${i}`, coverage: 1 });
    }
    const result = cortex.engines.narrative.weave({ scopeId: 'global', maxTotal: 5 });
    assert.ok(result.pruned >= 3, '超出的旧线应被删掉');
    const threads = cortex.repos.summaries.list('global', { level: 'thread', limit: 100 });
    assert.equal(threads.length, 5);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('weave 优先拿最近的痕迹当种子', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-seed-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T12:00:00+08:00');
    cortex.write({ text: '用户：两天前说过的高重要度话。', kind: 'utterance', title: '两天前的高重要度', importance: 1.0, explicit: true, now: now - 2 * 86_400_000 });
    cortex.write({ text: '用户：刚刚才说的普通话。', kind: 'utterance', title: '刚刚这句', importance: 0.6, explicit: true, now: now - 60_000 });
    const result = cortex.engines.narrative.weave({ scopeId: 'global', maxThreads: 1, at: now });
    assert.equal(result.built, 1);
    assert.match(result.threads[0].summary.content, /刚刚才说的普通话/, '种子应是最新的痕迹，而不是最重要的');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildThread 用时间窗：远处的高重要度痕迹进不了线', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-window-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T21:00:00+08:00');
    cortex.write({ text: '用户：刚才在修插件，第一句。', kind: 'utterance', title: '刚才第一句', importance: 0.5, explicit: true, now: now - 3_600_000 });
    cortex.write({ text: '用户：刚才在修插件，第二句。', kind: 'utterance', title: '刚才第二句', importance: 0.5, explicit: true, now: now - 1_800_000 });
    cortex.write({ text: '用户：五天前的高重要度身份记忆。', kind: 'utterance', title: '远处的高重要度', importance: 1.0, explicit: true, now: now - 5 * 86_400_000 });
    cortex.write({ text: '用户：种子这一句。', kind: 'utterance', title: '种子', importance: 0.6, explicit: true, now });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title === '种子');
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, windowHours: 24, at: now });
    assert.equal(result.skipped, false);
    assert.match(result.summary.content, /刚才在修插件，第一句/);
    assert.match(result.summary.content, /刚才在修插件，第二句/);
    assert.doesNotMatch(result.summary.content, /五天前/, '24 小时窗口外的痕迹不该进线');
    assert.equal(result.windowHours, 24);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('附近太安静时放宽窗口兜底', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-widen-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T21:00:00+08:00');
    cortex.write({ text: '用户：邻座这一条。', kind: 'utterance', title: '邻座', importance: 0.5, explicit: true, now: now - 1_800_000 });
    cortex.write({ text: '用户：两天前的另一条。', kind: 'utterance', title: '两天前', importance: 1.0, explicit: true, now: now - 2 * 86_400_000 });
    cortex.write({ text: '用户：种子这一句。', kind: 'utterance', title: '种子', importance: 0.6, explicit: true, now });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title === '种子');
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, windowHours: 1, at: now });
    assert.equal(result.skipped, false);
    assert.ok(result.windowHours > 1, '窗内太少时应放宽');
    assert.match(result.summary.content, /两天前/, '放宽后远处的痕迹可以进来');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('池子按种子时间范围取，不被最老的 300 条截断', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-truncate-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T21:00:00+08:00');
    // 310 条旧痕迹：比旧实现 listSince 的 300 上限还多，会把池子整个占满。
    for (let i = 0; i < 310; i += 1) {
      cortex.write({ text: `用户：旧痕迹 ${i}。`, kind: 'utterance', title: `旧 ${i}`, importance: 0.5, explicit: true, now: now - 7 * 86_400_000 + i * 60_000 });
    }
    cortex.write({ text: '用户：今晚修包的第一句。', kind: 'utterance', title: '今晚第一句', importance: 0.5, explicit: true, now: now - 1_800_000 });
    cortex.write({ text: '用户：今晚修包的第二句。', kind: 'utterance', title: '今晚第二句', importance: 0.5, explicit: true, now: now - 900_000 });
    cortex.write({ text: '用户：种子这一句。', kind: 'utterance', title: '种子', importance: 0.6, explicit: true, now });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title === '种子');
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, at: now });
    assert.equal(result.skipped, false);
    assert.match(result.summary.content, /今晚修包的第一句/);
    assert.match(result.summary.content, /今晚修包的第二句/);
    assert.doesNotMatch(result.summary.content, /旧痕迹/, '旧痕迹不该被当成本次的邻居');
    assert.equal(result.windowHours, 24);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('24 小时窗内痕迹很多时，最新的邻居也不被切掉', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-weave-busy-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.parse('2026-11-18T21:00:00+08:00');
    // 400 条都在 24 小时内，seed 在最末：旧实现 limit 300 的 ASC 会取前 300 条，
    // 最新的邻居（当天 300~399）会被切掉。
    for (let i = 0; i < 400; i += 1) {
      cortex.write({ text: `用户：当天的痕迹 ${i}。`, kind: 'utterance', title: `当天 ${i}`, importance: 0.5, explicit: true, now: now - (400 - i) * 60_000 });
    }
    cortex.write({ text: '用户：种子这一句。', kind: 'utterance', title: '种子', importance: 0.6, explicit: true, now });
    const seed = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 }).find((trace) => trace.title === '种子');
    const result = cortex.engines.narrative.buildThread({ seedTraceId: seed.id, at: now });
    assert.equal(result.skipped, false);
    assert.equal(result.windowHours, 24, '24 小时窗已经够热闹，不该放宽');
    assert.match(result.summary.content, /痕迹 399/, '最新的邻居不能被切掉');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
