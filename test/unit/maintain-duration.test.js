import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('maintain 会记录耗时，健康报告能读到（空转走内存回退）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-ms-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    const report = cortex.maintain({ now });
    assert.ok(Number.isFinite(report.ms) && report.ms >= 0, `maintain 应回报耗时（实际 ${report.ms}）`);
    const health = cortex.health({ scopeId: 'global', now });
    assert.ok(health.maintain, '健康报告应带上一次维护');
    assert.equal(health.maintain.ms, report.ms, '耗时应通过内存回退传到健康报告');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('真产生变更（写审计行）时，审计行里也有 ms', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-audit-ms-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    // 两条完全相同的摘要会被维护清掉一条 → 一定会写 maintain.run 审计行
    cortex.repos.summaries.insert({ level: 'thread', content: '重复的摘要内容', sourceIds: ['t1'], coverage: 0.2 });
    cortex.repos.summaries.insert({ level: 'thread', content: '重复的摘要内容', sourceIds: ['t1'], coverage: 0.2 });
    const report = cortex.maintain({ now });
    assert.ok(report.summaries >= 1, '应清掉一条重复摘要');

    const row = cortex.repos.audit.list({ targetType: 'scope', targetId: 'global', limit: 1 })[0];
    assert.ok(row, '应写入 maintain.run 审计行');
    const detail = row.detail ?? {};
    assert.ok(Number.isFinite(detail.ms), `审计 detail 里应该有 ms（实际 ${JSON.stringify(Object.keys(detail))}）`);

    const health = cortex.health({ scopeId: 'global', now });
    assert.ok(Number.isFinite(health.maintain?.ms), '有审计行时健康报告也要拿到 ms');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('维护超过阈值的耗时会被报成 SLOW_MAINTAIN，阈值可配', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-slow-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), maintainSlowMs: 5 } });
  try {
    const now = Date.now();
    cortex.repos.audit.record({ actor: 'self:maintain', action: 'maintain.run', targetType: 'scope', targetId: 'global', detail: { at: new Date(now).toISOString(), ms: 50 } });
    const health = cortex.health({ scopeId: 'global', now });
    const slow = health.issues.find((issue) => issue.code === 'SLOW_MAINTAIN');
    assert.ok(slow, '超过 maintainSlowMs 应提示慢维护');
    assert.equal(slow.detail?.ms, 50);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('旧审计行缺 ms 时整条回退到内存快照，不混合两次维护的数字', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-mixed-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    // 升级前留下的 9 键旧行：没有 ms，但 working=7
    cortex.repos.audit.record({ actor: 'self:maintain', action: 'maintain.run', targetType: 'scope', targetId: 'global', detail: { at: new Date(now - 60000).toISOString(), working: 7, intentions: 3 } });
    const report = cortex.maintain({ now });
    const health = cortex.health({ scopeId: 'global', now });
    assert.ok(Number.isFinite(health.maintain?.ms), '应回退到内存快照拿到 ms');
    assert.equal(health.maintain.working, report.working, '条数与耗时必须来自同一次维护');
    assert.notEqual(health.maintain.working, 7, '不应把旧行的 7 与新的耗时混在一起');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('安静的一趟不写审计行时，健康报告同时说清「最近一趟」与「最近一次有变更」', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-twolines-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    cortex.repos.audit.record({ actor: 'self:maintain', action: 'maintain.run', targetType: 'scope', targetId: 'global', detail: { at: new Date(now - 6 * 3600000).toISOString(), working: 7, intentions: 3 } });
    cortex.maintain({ now });
    const health = cortex.health({ scopeId: 'global', now });
    const lines = health.ok.join('\n');
    assert.match(lines, /最近一趟维护/, '应报告最近一趟');
    assert.match(lines, /最近一次有变更的维护/, '旧审计行较旧时应另说一句');
    assert.equal(health.maintainLastChanged?.working, 7, 'maintainLastChanged 应保留旧行数据');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('先变更一趟、再安静一趟：第一行是最近的安静趟，第二行才是那次变更', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-order-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const t1 = Date.now();
    cortex.repos.summaries.insert({ level: 'thread', content: '重复摘要 A', sourceIds: ['t1'], coverage: 0.2 });
    cortex.repos.summaries.insert({ level: 'thread', content: '重复摘要 A', sourceIds: ['t1'], coverage: 0.2 });
    const change = cortex.maintain({ now: t1 });
    assert.ok(change.summaries >= 1, '第一趟应真的产生变更');

    const t2 = t1 + 60_000;
    const quiet = cortex.maintain({ now: t2 });
    assert.equal(quiet.summaries, 0, '第二趟应无变更');

    const health = cortex.health({ scopeId: 'global', now: t2 });
    assert.equal(health.maintain.at, quiet.at, '第一行必须是最近那一趟（安静趟）');
    assert.equal(health.maintainLastChanged?.passAt ?? health.maintainLastChanged?.at, change.at, '第二行才是那次有变更的维护');
    assert.notEqual(health.maintain.at, health.maintainLastChanged?.passAt, '两行不能同源');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('慢维护被后续安静趟盖住时，仍要报 SLOW_MAINTAIN', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-masked-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const t1 = Date.now() - 60_000;
    // 伪造一次 8.5 秒的慢维护审计行
    cortex.repos.audit.record({ actor: 'self:maintain', action: 'maintain.run', targetType: 'scope', targetId: 'global', detail: { at: new Date(t1).toISOString(), ms: 8500, working: 2 } });
    // 一分钟后跑一次很快的安静维护，把「最近一趟」顶掉
    const quiet = cortex.maintain({ now: Date.now() });
    assert.ok(quiet.ms < 2000, '安静趟本身不该慢');

    const health = cortex.health({ scopeId: 'global' });
    const slow = health.issues.find((issue) => issue.code === 'SLOW_MAINTAIN');
    assert.ok(slow, '慢趟不该被后续安静趟遮住');
    assert.equal(slow.detail.ms, 8500);
    assert.match(String(slow.detail.at), /T/, '告警要带上那一趟的时间');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('慢维护即使没有变更也要落审计行（否则护栏永远没样本）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-slowrow-'));
  // A fast CI runner can finish maintain inside one Date.now() tick (elapsed = 0).
  // Use a negative threshold so "this pass is slow" holds by construction, and
  // assert the number is finite instead of strictly positive.
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), maintainSlowMs: -1 } });
  try {
    const now = Date.now();
    const report = cortex.maintain({ now });
    assert.ok(Number.isFinite(report.ms) && report.ms >= 0, '阈值低于任何耗时时每趟都算慢');
    const row = cortex.repos.audit.list({ targetType: 'scope', targetId: 'global', limit: 1 })[0];
    assert.ok(row, '慢趟应写审计行');
    assert.ok(Number.isFinite(row.detail?.ms), '审计 detail 应带 ms');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('超过窗口的慢维护不再常驻告警', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-olderv-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    const old = now - 8 * 3600_000;
    cortex.repos.audit.record({ actor: 'self:maintain', action: 'maintain.run', targetType: 'scope', targetId: 'global', detail: { at: new Date(old).toISOString(), ms: 9000, working: 1 } });
    const health = cortex.health({ scopeId: 'global', now });
    const slow = health.issues.find((issue) => issue.code === 'SLOW_MAINTAIN');
    assert.equal(slow, undefined, '8 小时前的慢趟属于历史，不该常驻');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('时间戳带空格也能正确比较，不被字典序骗到', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-maintain-spacefmt-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    // 同一时刻：审计行写成带空格格式，内存是 ISO
    const iso = new Date(now).toISOString();
    const spaced = iso.replace('T', ' ').replace('Z', '');
    cortex.repos.audit.record({ actor: 'self:maintain', action: 'maintain.run', targetType: 'scope', targetId: 'global', detail: { at: spaced, ms: 3, working: 2 } });
    const report = cortex.maintain({ now });
    const health = cortex.health({ scopeId: 'global', now });
    assert.equal(health.maintain.at, report.at, '同一时刻应判为同一趟，用内存快照');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
