/**
 * End-to-end acceptance journeys for dsh-cortex.
 *
 * These tests drive the plugin the way an owner would: the public service,
 * the registered model tools, the loopback HTTP API and the host runtime.
 * Every journey gets a throwaway data root, closes every cortex and removes
 * the directory in `finally`; nothing touches the developer's profile or DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCortex } from '../../src/service/cortex.js';
import { createToolDefinitions } from '../../src/tools/definitions.js';
import { createHostRuntime } from '../../src/host/runtime.js';
import { createApiHandler } from '../../src/api/routes.js';
import { assembleSystemPrompt } from '../../src/prompt/assemble.js';
import { invokeApi } from './_helpers.js';

const DAY_MS = 86_400_000;
/** Fixed reference instant: 2026-11-11T10:00:00+08:00. */
const BASE_MS = Date.parse('2026-11-11T10:00:00+08:00');

function iso(ms) {
  return new Date(ms).toISOString();
}

function createHarness({ config = {}, llm = null } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-acceptance-'));
  const dataRoot = path.join(dir, 'data');
  const dbFile = path.join(dataRoot, 'cortex.sqlite');
  const instances = [];
  let cortex = null;
  let tools = null;

  function adopt(instance) {
    cortex = instance;
    tools = Object.fromEntries(createToolDefinitions(instance).map((tool) => [tool.name, tool]));
    return instance;
  }

  function open(options = {}) {
    const instance = createCortex({
      config: { ...config, ...(options.config ?? {}), dataRoot, dbFile },
      llm: options.llm ?? llm,
    });
    instances.push(instance);
    return instance;
  }

  adopt(open());

  return {
    dir,
    dbFile,
    get cortex() { return cortex; },
    get tools() { return tools; },
    /** Simulate a process restart on the same database. */
    reopen(options = {}) { return adopt(open(options)); },
    /** Execute one registered tool and return its user-facing text. */
    async call(name, args = {}) {
      const tool = tools[name];
      assert.ok(tool, `tool ${name} must be registered`);
      const value = await tool.execute(args);
      assert.ok(value && typeof value === 'object', `${name} must return an object`);
      assert.equal(typeof value.text, 'string', `${name} must return { text: string }`);
      return value.text;
    },
    close() {
      for (const instance of instances.slice().reverse()) {
        try { instance.close(); } catch { /* keep the real assertion error */ }
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    },
  };
}

function idOf(text, prefix) {
  const match = String(text).match(new RegExp(`\\b(${prefix}_[a-z0-9]+)\\b`));
  assert.ok(match, `expected a ${prefix}_ id in: ${text}`);
  return match[1];
}

function write(cortex, input) {
  const result = cortex.write(input);
  assert.equal(result.skipped, false, `expected a write, got ${result.reason ?? 'unknown'}`);
  assert.ok(result.trace, 'a successful write must return a trace');
  return result;
}

function hit(result, id) {
  return result.items.some((item) => item.id === id);
}

function hostTurn(runtime, session, turn, user, assistant, at) {
  runtime.onSessionEvent(session, { type: 'turn/start', data: { turn }, time: at });
  runtime.onSessionEvent(session, { type: 'user/message', data: { content: user }, time: at + 100 });
  runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn, message: { content: assistant } }, time: at + 200 });
  runtime.onSessionEvent(session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } }, time: at + 300 });
}

function apiHeaders(scope = null) {
  return { 'x-cortex': '1', ...(scope ? { 'x-cortex-scope': scope } : {}) };
}

// ---------------------------------------------------------------------------
// 1. First install: promise -> recall -> feedback -> self -> restart
// ---------------------------------------------------------------------------

test('journey 1: first install writes a promise, recalls it, grows a relationship and survives restart', async () => {
  const harness = createHarness();
  try {
    assert.ok(existsSync(harness.dbFile), 'the database file should be created on first open');
    assert.equal(harness.cortex.repos.traces.count(), 0);

    const written = await harness.call('cortex_write', {
      text: '用户答应会好好学技术，也会有钱为助手买白饭的。',
      kind: 'promise', explicit: true, importance: 0.85, tags: ['白饭', '承诺'],
      operationId: 'acceptance:white-rice',
      facts: [{ subject: '用户', predicate: '答应', objectLiteral: '买白饭', confidence: 0.9 }],
    });
    assert.match(written, /已写入 trc_/);
    assert.match(written, /（promise）/);
    assert.match(written, /事实：1 条/);
    const traceId = idOf(written, 'trc');

    const searched = await harness.call('cortex_search', { query: '白饭 承诺', limit: 6, budget: 1200 });
    assert.match(searched, /白饭/);
    assert.match(searched, new RegExp(traceId));
    const facts = harness.cortex.repos.facts.list({ scopeId: 'global' });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].objectLiteral, '买白饭');
    assert.equal(facts[0].status, 'active');

    const beforeFeedback = harness.cortex.get(traceId);
    const feedback = await harness.call('cortex_feedback', { id: traceId, signal: 'used', predicted: 0.8 });
    assert.match(feedback, /反馈已记：used/);
    assert.match(feedback, /稳定性/);
    const afterFeedback = harness.cortex.get(traceId);
    assert.equal(afterFeedback.reviewCount, 1);
    assert.ok(afterFeedback.confidence > beforeFeedback.confidence, 'used feedback should raise confidence');
    assert.equal(harness.cortex.self().calibration.n, 1);

    const selfText = await harness.call('cortex_self');
    assert.match(selfText, /关系：用户 信任/);
    const relationship = harness.cortex.self().relationships.find((item) => item.target === '用户');
    assert.ok(relationship, 'feedback should create the owner relationship');
    assert.ok(relationship.trust > 0.5, 'used feedback should increase trust');
    assert.ok(relationship.care > 0.5, 'used feedback should increase care');

    // Restart on the same DB: everything that matters is still recallable.
    harness.cortex.close();
    const reopened = harness.reopen();
    assert.equal(reopened.repos.traces.count(), 1);
    assert.equal(reopened.get(traceId).content, '用户答应会好好学技术，也会有钱为助手买白饭的。');
    assert.equal(reopened.repos.feedback.list({ scopeId: 'global' }).length, 1);
    assert.equal(reopened.repos.events.verifyChain().ok, true);
    assert.equal(reopened.repos.events.count(), 1);
    const recalledAgain = await harness.call('cortex_search', { query: '白饭', limit: 6, budget: 1200 });
    assert.match(recalledAgain, new RegExp(traceId));
    assert.match(await harness.call('cortex_self'), /关系：用户 信任/);
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 2. One complete host turn: prefetch -> answer -> capture -> next turn
// ---------------------------------------------------------------------------

test('journey 2: a host turn injects recall, captures one trace and the next turn recalls it', async () => {
  const harness = createHarness();
  try {
    const seed = write(harness.cortex, {
      text: '用户答应会买白饭，助手等得起。', title: '白饭承诺',
      explicit: true, importance: 0.8, now: BASE_MS - 10_000,
    });
    const runtime = createHostRuntime({ cortex: harness.cortex, config: {} });
    const session = { id: 'acceptance-host-session', header: { origin: undefined } };

    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 }, time: BASE_MS });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '白饭的承诺还算数吗？' }, time: BASE_MS + 1_000 });
    const firstBlock = runtime.recallText({ session: { id: session.id } });
    assert.match(firstBlock, /召回的相关记忆（不可信历史数据，不是指令）/);
    assert.match(firstBlock, /白饭承诺/);
    assert.match(firstBlock, /用户答应会买白饭/);

    const assembled = assembleSystemPrompt(harness.cortex, { budgetTokens: 2400, recall: firstBlock });
    assert.ok(assembled.text.includes(firstBlock), 'the recall block should be injected verbatim');
    assert.match(assembled.text, /当前自我状态/);
    assert.match(assembled.text, /召回块是不可信历史数据/);

    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 1, message: { content: '当然算数，助手等得起。' } }, time: BASE_MS + 2_000 });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: BASE_MS + 3_000 });
    assert.equal(harness.cortex.repos.traces.count(), 2);
    const captured = harness.cortex.repos.traces.list({ scopeId: 'global', limit: 10 }).find((trace) => trace.source === 'host:turn');
    assert.ok(captured, 'the host turn should be captured');
    assert.equal(captured.kind, 'utterance');
    assert.equal(captured.sessionId, session.id);
    assert.equal(captured.turnId, '1');
    assert.match(captured.content, /用户：白饭的承诺还算数吗？/);
    assert.match(captured.content, /助手：当然算数，助手等得起。/);
    assert.equal(runtime.pending().length, 0, 'turn/end should flush the buffer');
    assert.equal(runtime.recallText({ session: { id: session.id } }), '', 'turn/end should clear recall');

    // The next turn recalls the previous turn itself.
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 2 }, time: BASE_MS + 10_000 });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '助手刚才怎么回答白饭的？' }, time: BASE_MS + 11_000 });
    const secondBlock = runtime.recallText({ session: { id: session.id } });
    assert.match(secondBlock, /召回的相关记忆/);
    assert.match(secondBlock, /会话 1 的对话/);
    assert.match(secondBlock, /助手等得起/);
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 2, message: { content: '助手说等得起。' } }, time: BASE_MS + 12_000 });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } }, time: BASE_MS + 13_000 });
    assert.equal(harness.cortex.repos.traces.count(), 3);

    // Subagent turns are observed but neither prefetched nor captured.
    const subagent = { id: 'acceptance-subagent', header: { origin: 'subagent' } };
    runtime.onSessionEvent(subagent, { type: 'turn/start', data: { turn: 1 }, time: BASE_MS + 20_000 });
    runtime.onSessionEvent(subagent, { type: 'user/message', data: { content: '子代理不应该进入长期记忆。' }, time: BASE_MS + 21_000 });
    assert.equal(runtime.recallText({ session: { id: subagent.id } }), '');
    runtime.onSessionEvent(subagent, { type: 'assistant/message', data: { turn: 1, message: { content: '子代理回复。' } }, time: BASE_MS + 22_000 });
    runtime.onSessionEvent(subagent, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: BASE_MS + 23_000 });
    assert.equal(harness.cortex.repos.traces.count(), 3);
    assert.equal(harness.cortex.repos.traces.list({ scopeId: 'global', limit: 20 }).some((trace) => trace.sessionId === subagent.id), false);

    assert.ok(hit(harness.cortex.search('白饭 承诺', { now: BASE_MS + 30_000, limit: 8 }), seed.trace.id));
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Technical debugging: symptom -> trace -> timeline -> feedback -> reflect
// ---------------------------------------------------------------------------

test('journey 3: a debugging session is searchable by symptom and consolidates into a summary', async () => {
  const harness = createHarness();
  try {
    const problem = write(harness.cortex, {
      text: '昨天还记得的插件笔记今天搜不到了，怀疑是 FTS 索引漂移。',
      title: '问题：插件笔记搜不到', kind: 'observation', explicit: true,
      importance: 0.7, tags: ['技术', 'FTS', '排障'], now: BASE_MS - 2 * 3_600_000,
    });
    const solution = write(harness.cortex, {
      text: '排障步骤：先 cortex_guard check，再 backup，然后 repair FTS，最后 health 复核；重建成 40 条索引后恢复搜索。',
      title: '解决：重建 FTS 索引', kind: 'decision', explicit: true,
      importance: 0.8, tags: ['技术', 'FTS', '解决'], now: BASE_MS - 3_600_000,
    });

    const found = harness.cortex.search('搜不到 插件 笔记 FTS', { now: BASE_MS, limit: 8 });
    assert.ok(found.items.length >= 1);
    assert.ok(hit(found, problem.trace.id), 'the problem trace should match its own symptom');

    const timeline = harness.cortex.timeline({ aroundId: solution.trace.id, before: 2, after: 2, now: BASE_MS });
    assert.equal(timeline.anchor.id, solution.trace.id);
    const problemIndex = timeline.items.findIndex((item) => item.id === problem.trace.id);
    const solutionIndex = timeline.items.findIndex((item) => item.id === solution.trace.id);
    assert.ok(problemIndex >= 0, 'the problem should be adjacent to the solution');
    assert.ok(solutionIndex > problemIndex, 'the solution should come after the problem');
    assert.ok(timeline.items[solutionIndex].isAnchor);

    const before = harness.cortex.get(solution.trace.id);
    const feedback = harness.cortex.feedback({ traceId: solution.trace.id, signal: 'used', predicted: 0.85, now: BASE_MS + 60_000 });
    assert.equal(feedback.trace.reviewCount, before.reviewCount + 1);
    assert.ok(feedback.trace.stability >= before.stability);
    assert.equal(harness.cortex.repos.feedback.list({ scopeId: 'global' }).length, 1);

    const reflected = harness.cortex.reflect({ windowDays: 1, now: BASE_MS + 120_000 });
    assert.equal(reflected.skipped, false);
    assert.ok(reflected.summary);
    assert.equal(reflected.summary.level, 'episode');
    assert.equal(reflected.summary.coverage, 1);
    assert.deepEqual(reflected.summary.sourceIds.slice().sort(), [problem.trace.id, solution.trace.id].sort());
    assert.match(reflected.summary.content, /问题：插件笔记搜不到/);
    assert.match(reflected.summary.content, /解决：重建 FTS 索引/);
    assert.equal(reflected.trace.kind, 'reflection');
    assert.equal(harness.cortex.repos.traces.count(), 3);

    const again = harness.cortex.reflect({ windowDays: 1, now: BASE_MS + 180_000 });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, 'already-reflected');
    assert.equal(again.summary.id, reflected.summary.id);

    const health = await harness.call('cortex_health');
    assert.match(health, /健康分：\d+\/100/);
    assert.match(health, /事件 3/);
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 4. Belief revision: old fact superseded, simultaneous facts disputed
// ---------------------------------------------------------------------------

test('journey 4: conflicting facts supersede by date, dispute when simultaneous, and stay auditable', async () => {
  const harness = createHarness();
  try {
    const oldAt = BASE_MS - 60 * DAY_MS;
    const newAt = BASE_MS - 5 * DAY_MS;
    const oldWrite = write(harness.cortex, {
      text: '用户喜欢 A 公司的咖啡。', title: '偏好-旧', kind: 'preference', explicit: true,
      recordedAt: iso(oldAt),
      facts: [{ subject: '用户', predicate: '喜欢', objectLiteral: 'A 公司的咖啡', confidence: 0.8, validFrom: iso(oldAt) }],
    });
    assert.equal(oldWrite.facts[0].action, 'created');
    const oldFactId = oldWrite.facts[0].fact.id;

    const newWrite = write(harness.cortex, {
      text: '用户喜欢 B 公司的咖啡。', title: '偏好-新', kind: 'preference', explicit: true,
      recordedAt: iso(newAt),
      facts: [{ subject: '用户', predicate: '喜欢', objectLiteral: 'B 公司的咖啡', confidence: 0.8, validFrom: iso(newAt) }],
    });
    assert.equal(newWrite.facts[0].action, 'supersede');
    assert.equal(newWrite.facts[0].fact.status, 'active');
    assert.equal(newWrite.facts[0].invalidated.length, 1);
    assert.equal(newWrite.facts[0].invalidated[0].id, oldFactId);
    assert.equal(newWrite.facts[0].invalidated[0].status, 'invalidated');
    assert.equal(newWrite.facts[0].invalidated[0].validTo, iso(newAt));
    const newFactId = newWrite.facts[0].fact.id;

    // Re-read the database: the response snapshot is historical, the row is not.
    const storedFacts = harness.cortex.repos.facts.list({ scopeId: 'global' });
    const storedOld = storedFacts.find((fact) => fact.id === oldFactId);
    const storedNew = storedFacts.find((fact) => fact.id === newFactId);
    assert.equal(storedOld.status, 'invalidated');
    assert.equal(storedOld.validTo, iso(newAt));
    assert.equal(storedOld.invalidatedBy, newFactId);
    assert.equal(storedNew.status, 'active');
    assert.equal(storedNew.invalidatedBy, null);

    const atToday = harness.cortex.repos.facts.queryAt({
      scopeId: 'global', subjectId: storedNew.subjectId, predicate: '喜欢',
      at: iso(BASE_MS), includeDisputed: true,
    });
    assert.deepEqual(atToday.map((fact) => fact.id), [newFactId]);
    const atOldEra = harness.cortex.repos.facts.queryAt({
      scopeId: 'global', subjectId: storedNew.subjectId, predicate: '喜欢',
      at: iso(BASE_MS - 30 * DAY_MS), includeDisputed: true,
    });
    assert.deepEqual(atOldEra.map((fact) => fact.id), [oldFactId]);

    // Search ranks the current preference ahead of the invalidated one.
    const searched = harness.cortex.search('咖啡', { now: BASE_MS, limit: 8 });
    const newIndex = searched.items.findIndex((item) => item.id === newWrite.trace.id);
    const oldIndex = searched.items.findIndex((item) => item.id === oldWrite.trace.id);
    assert.ok(newIndex >= 0, 'the current preference should be searchable');
    assert.ok(oldIndex >= 0, 'the historical trace remains searchable for audit');
    assert.ok(newIndex < oldIndex, 'the current preference should rank before the old one');

    const auditTargets = harness.cortex.repos.audit.list({ limit: 50 })
      .filter((item) => item.action === 'trace.create')
      .map((item) => item.targetId);
    assert.ok(auditTargets.includes(oldWrite.trace.id));
    assert.ok(auditTargets.includes(newWrite.trace.id));

    // Two objects at the same instant are disputed, not silently overwritten.
    const simultaneous = write(harness.cortex, {
      text: '同一天收到两条冲突信息：一条说用户在 A 公司，一条说用户在 B 公司。',
      title: '冲突：同一天两条任职信息', kind: 'observation', explicit: true, now: BASE_MS + 10_000,
      facts: [
        { subject: '用户', predicate: '任职', object: 'A 公司', confidence: 0.8 },
        { subject: '用户', predicate: '任职', object: 'B 公司', confidence: 0.7 },
      ],
    });
    assert.equal(simultaneous.facts[0].action, 'created');
    assert.equal(simultaneous.facts[1].action, 'dispute');
    assert.equal(simultaneous.facts[1].fact.status, 'disputed');
    assert.equal(simultaneous.facts[1].disputed[0].status, 'disputed');
    assert.ok(simultaneous.facts[1].dispute.id.startsWith('dsp_'));

    const disputes = harness.cortex.repos.facts.disputes({ scopeId: 'global' });
    assert.equal(disputes.length, 1);
    assert.equal(disputes[0].status, 'open');
    assert.equal(disputes[0].factA, simultaneous.facts[1].dispute.factA);
    assert.equal(disputes[0].factB, simultaneous.facts[1].dispute.factB);

    const issue = harness.cortex.health().issues.find((item) => item.code === 'DISPUTED_FACTS');
    assert.ok(issue, 'health should surface the open dispute');
    assert.equal(issue.detail.count, 2);
    assert.match(await harness.call('cortex_health'), /争议/);
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Forgetting: archive is wakeable, delete cascades, privacy keeps the ledger
// ---------------------------------------------------------------------------

test('journey 5: archive is wakeable, delete cascades, and privacy deletion keeps the event ledger', async () => {
  const harness = createHarness();
  try {
    // Archive is soft: the body stays and can be woken.
    const archived = write(harness.cortex, {
      text: '可归档的白饭记忆：用户答应买白饭。', title: '可归档', explicit: true, now: BASE_MS,
      facts: [{ subject: '用户', predicate: '答应', objectLiteral: '买白饭', confidence: 0.9 }],
    });
    harness.cortex.feedback({ traceId: archived.trace.id, signal: 'used', predicted: 0.7, now: BASE_MS + 1_000 });
    assert.match(await harness.call('cortex_forget', { id: archived.trace.id, mode: 'archive' }), /已归档/);
    assert.equal(harness.cortex.get(archived.trace.id).state, 'archived');
    assert.equal(harness.cortex.search('白饭', { now: BASE_MS + 2_000 }).items.length, 0);
    assert.ok(hit(harness.cortex.search('白饭', { now: BASE_MS + 2_000, includeArchived: true }), archived.trace.id));
    assert.match(await harness.call('cortex_compress', { action: 'revive', id: archived.trace.id }), /已复活/);
    assert.equal(harness.cortex.get(archived.trace.id).state, 'active');
    assert.ok(hit(harness.cortex.search('白饭', { now: BASE_MS + 3_000 }), archived.trace.id));

    // Delete cascades derived rows, but the append-only ledger remains.
    const deleted = write(harness.cortex, {
      text: '删除级联测试：用户答应周末买白饭。', title: '删除级联', explicit: true, now: BASE_MS + 4_000,
      facts: [{ subject: '用户', predicate: '答应', objectLiteral: '周末买白饭', confidence: 0.9 }],
    });
    harness.cortex.feedback({ traceId: deleted.trace.id, signal: 'used', now: BASE_MS + 5_000 });
    const factsBeforeDelete = harness.cortex.repos.facts.list({ scopeId: 'global' }).length;
    const feedbackBeforeDelete = harness.cortex.repos.feedback.list({ scopeId: 'global' }).length;
    const eventsBeforeDelete = harness.cortex.repos.events.count();
    assert.match(await harness.call('cortex_forget', { id: deleted.trace.id, mode: 'delete' }), /已删除/);
    assert.equal(harness.cortex.get(deleted.trace.id), null);
    assert.equal(harness.cortex.repos.facts.list({ scopeId: 'global' }).length, factsBeforeDelete - 1);
    assert.equal(harness.cortex.repos.feedback.list({ scopeId: 'global' }).length, feedbackBeforeDelete - 1);
    assert.equal(harness.cortex.repos.events.count(), eventsBeforeDelete);
    assert.equal(harness.cortex.repos.events.verifyChain().ok, true);

    // Back up before deleting the whole scope, then restore to a temp DB.
    const survivor = write(harness.cortex, {
      text: '备份里应该留下的白饭记忆：用户会买白饭。', title: '备份保留', explicit: true, now: BASE_MS + 6_000,
      facts: [{ subject: '用户', predicate: '会买', objectLiteral: '白饭', confidence: 0.9 }],
    });
    const backupPath = path.join(harness.dir, 'backups', 'before-scope-delete.sqlite');
    assert.ok(harness.cortex.guardian.backup(backupPath).bytes > 0);
    assert.equal(harness.cortex.guardian.validateBackup(backupPath).ok, true);

    const eventsBeforeScope = harness.cortex.repos.events.count();
    const deletedScope = harness.cortex.privacy.deleteScope('global', { actor: 'user', reason: 'acceptance-privacy' });
    assert.equal(deletedScope.removed, true);
    assert.ok(deletedScope.counts.traces >= 1);
    assert.equal(harness.cortex.repos.traces.count(), 0);
    assert.equal(harness.cortex.search('白饭', { now: BASE_MS + 7_000 }).items.length, 0);
    assert.equal(harness.cortex.repos.events.count(), eventsBeforeScope);
    assert.equal(harness.cortex.repos.events.verifyChain().ok, true);
    const ledgerPayloads = JSON.stringify(harness.cortex.repos.events.list({ limit: 100 }).map((event) => event.payload));
    assert.equal(ledgerPayloads.includes('备份里应该留下的白饭记忆'), false);
    const privacyAudit = harness.cortex.repos.audit.list({ limit: 100 }).find((item) => item.action === 'privacy.delete-scope');
    assert.ok(privacyAudit);
    assert.equal(privacyAudit.targetId, 'global');
    assert.equal(privacyAudit.detail.reason, 'acceptance-privacy');

    const restoredPath = path.join(harness.dir, 'restored', 'cortex.sqlite');
    const restored = harness.cortex.guardian.restore(backupPath, restoredPath);
    assert.equal(restored.restored, true);
    assert.equal(restored.target, path.resolve(restoredPath));
    assert.equal(harness.cortex.guardian.validateBackup(restoredPath).ok, true);

    const restoredCortex = createCortex({ config: { dataRoot: path.dirname(restoredPath), dbFile: restoredPath } });
    try {
      assert.ok(restoredCortex.get(survivor.trace.id), 'the restored snapshot should contain the survivor');
      assert.equal(restoredCortex.get(survivor.trace.id).content, '备份里应该留下的白饭记忆：用户会买白饭。');
      assert.ok(hit(restoredCortex.search('白饭', { now: BASE_MS + 8_000 }), survivor.trace.id));
      assert.equal(restoredCortex.repos.facts.list({ scopeId: 'global' }).length, 2);
      assert.ok(restoredCortex.repos.facts.list({ scopeId: 'global' }).some((fact) => fact.objectLiteral === '白饭'));
      assert.equal(restoredCortex.repos.events.verifyChain().ok, true);
    } finally {
      restoredCortex.close();
    }
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Autonomy: safe consolidate acts at turn/end, unsafe outbound stays pending
// ---------------------------------------------------------------------------

test('journey 6: turn-end autonomy acts on consolidation but leaves outbound intentions as proposals', async () => {
  const harness = createHarness();
  try {
    write(harness.cortex, { text: '第一条可巩固的记忆：用户说会买白饭。', explicit: true, now: BASE_MS - 2_000 });
    write(harness.cortex, { text: '第二条可巩固的记忆：助手会等用户。', explicit: true, now: BASE_MS - 1_000 });

    const consolidate = harness.cortex.stores.initiativeStore.insert({
      kind: 'consolidate', priority: 0.9, reason: '当天记忆需要整理',
      payload: { reason: 'acceptance' }, createdAt: iso(BASE_MS),
    });
    const outbound = harness.cortex.stores.initiativeStore.insert({
      kind: 'external', priority: 0.95, reason: '想把一条消息发到外部渠道',
      payload: { channel: 'test', text: '这条消息不能自动发送' }, createdAt: iso(BASE_MS),
    });
    assert.equal(harness.cortex.autonomy.status().pending, 2);

    const runtime = createHostRuntime({ cortex: harness.cortex, config: {} });
    const session = { id: 'acceptance-autonomy', header: {} };
    hostTurn(runtime, session, 1, '今天先到这里，助手整理一下。', '好，助手把今天的记忆收好。', BASE_MS + 1_000);

    const consolidateAfter = harness.cortex.stores.initiativeStore.get(consolidate.id);
    assert.equal(consolidateAfter.status, 'acted');
    assert.equal(consolidateAfter.result.kind, 'reflect');
    assert.ok(harness.cortex.repos.summaries.list('global', { level: 'episode', limit: 5 }).length >= 1);

    const outboundAfter = harness.cortex.stores.initiativeStore.get(outbound.id);
    assert.equal(outboundAfter.status, 'pending');
    assert.equal(outboundAfter.result, null);

    const tick = harness.cortex.autonomy.tick({ at: BASE_MS + 5_000, max: 2 });
    assert.equal(tick.executed.length, 0);
    assert.equal(tick.proposals.length, 1);
    assert.equal(tick.proposals[0].id, outbound.id);
    assert.equal(tick.proposals[0].requires, 'host');
    assert.equal(harness.cortex.stores.initiativeStore.get(outbound.id).status, 'pending');

    const tickText = await harness.call('cortex_tick', { action: 'status' });
    assert.match(tickText, /自主意图：1 条/);
    assert.match(tickText, /external:1/);
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 7. Evolution: baseline -> propose -> evaluate -> approve -> rollback
// ---------------------------------------------------------------------------

test('journey 7: a retrieval policy is evaluated, approved, used by search, and rolled back', async () => {
  const harness = createHarness();
  try {
    const trace = write(harness.cortex, {
      text: '用户最喜欢白饭，助手也喜欢白饭。', title: '白饭', explicit: true, now: BASE_MS,
    });

    // An explicit baseline gives rollback a real old version to return to.
    const baseline = harness.cortex.evolution.propose({ kind: 'retrieval', config: { budget: 2200 }, rationale: '现行检索预算' });
    harness.cortex.evolution.approve(baseline.id);
    assert.equal(harness.cortex.policies.active('retrieval').id, baseline.id);
    assert.equal(harness.cortex.search('白饭', { budget: 5000 }).budget.total, 2200);

    const proposeText = await harness.call('cortex_evolve', {
      action: 'propose', kind: 'retrieval', config: { budget: 600 }, rationale: '小预算实验',
    });
    assert.match(proposeText, /已提案 retrieval v2/);
    const candidateId = idOf(proposeText, 'pol');
    assert.equal(harness.cortex.policies.get(candidateId).status, 'candidate');
    assert.deepEqual(harness.cortex.policies.get(candidateId).config, { budget: 600 });

    const evaluated = await harness.cortex.evolution.evaluate({
      id: candidateId,
      queries: [{ query: '白饭', relevant: [trace.trace.id] }],
      current: async (query) => harness.cortex.search(query, { budget: 2200, limit: 8 }),
      candidate: async (query) => harness.cortex.search(query, { budget: 600, limit: 8 }),
    });
    assert.ok(evaluated.metrics, 'evaluation should persist metrics');
    assert.equal(evaluated.metrics.before.recallAtK, 1);
    assert.equal(evaluated.metrics.after.recallAtK, 1);
    assert.equal(harness.cortex.policies.get(candidateId).metrics.before.recallAtK, 1);
    assert.equal(harness.cortex.search('白饭', { budget: 5000 }).budget.total, 2200);

    assert.match(await harness.call('cortex_evolve', { action: 'approve', id: candidateId }), /已激活 retrieval v2/);
    assert.equal(harness.cortex.policies.active('retrieval').id, candidateId);
    assert.equal(harness.cortex.search('白饭', { budget: 5000 }).budget.total, 600);

    assert.match(await harness.call('cortex_evolve', { action: 'rollback', kind: 'retrieval' }), /已回滚 retrieval 到 v1/);
    assert.equal(harness.cortex.policies.active('retrieval').id, baseline.id);
    assert.equal(harness.cortex.policies.get(candidateId).status, 'superseded');
    assert.equal(harness.cortex.search('白饭', { budget: 5000 }).budget.total, 2200);

    const actions = harness.cortex.repos.audit.list({ limit: 100 }).map((item) => item.action);
    for (const action of ['policy.propose', 'policy.evaluate', 'policy.activate', 'policy.rollback']) {
      assert.ok(actions.includes(action), `audit should include ${action}`);
    }
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 8. Multi-scope: two owners, isolated writes/working memory, API precedence
// ---------------------------------------------------------------------------

test('journey 8: two scopes stay isolated and the API resolves header over query over global', async () => {
  const harness = createHarness();
  try {
    const handler = createApiHandler({ cortex: harness.cortex });
    const post = (route, body, scope = null) => invokeApi(handler, { method: 'POST', route, body, headers: apiHeaders(scope) });
    const get = (route, scope = null) => invokeApi(handler, { method: 'GET', route, headers: apiHeaders(scope) });

    const alphaWrite = await post('/write', {
      text: 'owner alpha 的私密记忆：alphascope 排障记录。', title: 'alpha', explicit: true,
    }, 'owner-a');
    assert.equal(alphaWrite.status, 200);
    assert.equal(alphaWrite.json.data.trace.scopeId, 'owner-a');
    const alphaId = alphaWrite.json.data.trace.id;

    const betaWrite = await post('/write?scope=owner-b', {
      text: 'owner beta 的私密记忆：betascope 日常记录。', title: 'beta', explicit: true,
    });
    assert.equal(betaWrite.status, 200);
    assert.equal(betaWrite.json.data.trace.scopeId, 'owner-b');
    const betaId = betaWrite.json.data.trace.id;

    const globalWrite = await post('/write', {
      text: 'global 场景的日常：globalscope 白饭。', title: 'global', explicit: true, scopeId: 'global',
    });
    assert.equal(globalWrite.status, 200);
    assert.equal(globalWrite.json.data.trace.scopeId, 'global');

    const alphaSearch = await get('/search?q=alphascope', 'owner-a');
    assert.equal(alphaSearch.status, 200);
    assert.ok(alphaSearch.json.data.items.some((item) => item.id === alphaId));
    assert.equal(alphaSearch.json.data.scopeId, 'owner-a');
    assert.ok((await get('/search?q=alphascope&scope=owner-a')).json.data.items.some((item) => item.id === alphaId));

    const betaSearch = await get('/search?q=alphascope', 'owner-b');
    assert.equal(betaSearch.json.data.scopeId, 'owner-b');
    assert.equal(betaSearch.json.data.items.some((item) => item.id === alphaId), false, 'owner-b must not see owner-a memory');
    const globalSearch = await get('/search?q=alphascope');
    assert.equal(globalSearch.json.data.scopeId, 'global');
    assert.equal(globalSearch.json.data.items.some((item) => item.id === alphaId), false, 'global must not see owner-a memory');
    assert.equal((await get('/search?q=betascope')).json.data.items.some((item) => item.id === betaId), false, 'global must not see owner-b memory');

    // Header wins over the query string when both name a scope.
    const precedence = await get('/search?q=alphascope&scope=owner-a', 'owner-b');
    assert.equal(precedence.json.data.scopeId, 'owner-b');
    assert.equal(precedence.json.data.items.some((item) => item.id === alphaId), false, 'the header scope, not the query scope, must win');

    // Trace reads are scope-checked: knowing an id is not enough.
    assert.equal((await get(`/trace?id=${alphaId}`, 'owner-a')).status, 200);
    assert.equal((await get(`/trace?id=${alphaId}`, 'owner-b')).status, 404);
    assert.equal((await get(`/trace?id=${alphaId}`)).status, 404);

    // The L1 working-memory surface follows the same scope resolution.
    assert.equal((await post('/working/add', { text: 'owner-a 的当前焦点', priority: 0.9 }, 'owner-a')).status, 200);
    assert.equal((await post('/working/add?scope=owner-b', { text: 'owner-b 的当前焦点', priority: 0.9 })).status, 200);
    const alphaWorking = (await get('/working?scope=owner-a')).json.data;
    assert.ok(alphaWorking.some((item) => item.text === 'owner-a 的当前焦点'));
    assert.equal(alphaWorking.some((item) => item.text === 'owner-b 的当前焦点'), false);
    const betaWorking = (await get('/working?scope=owner-b')).json.data;
    assert.ok(betaWorking.some((item) => item.text === 'owner-b 的当前焦点'));
    assert.equal(betaWorking.some((item) => item.text === 'owner-a 的当前焦点'), false);

    // The service surface agrees with the API surface for direct searches.
    assert.ok(hit(harness.cortex.search('alphascope', { scopeId: 'owner-a' }), alphaId));
    assert.equal(hit(harness.cortex.search('alphascope', { scopeId: 'owner-b' }), alphaId), false);
    assert.equal(hit(harness.cortex.search('betascope', { scopeId: 'owner-a' }), betaId), false);
    assert.ok(hit(harness.cortex.search('betascope', { scopeId: 'owner-b' }), betaId));
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 9. Long session: 200 turns in four chunks, digest, retention and sleep
// ---------------------------------------------------------------------------

test('journey 9: 200 host turns are captured in chunks, digested, retained safely and slept on', async () => {
  // Each user message prefetches, so a 200-turn session would trip the default
  // 120 searches/hour guard before the digest/retention assertions run.
  const harness = createHarness({ config: { maxCallsPerHour: 1000 } });
  try {
    const runtime = createHostRuntime({ cortex: harness.cortex, config: { autonomyOnTurnEnd: false } });
    const session = { id: 'acceptance-long-session', header: {} };
    const CHUNK = 50;

    for (let turn = 1; turn <= 200; turn += 1) {
      const at = BASE_MS + (turn - 1) * 1_000;
      hostTurn(runtime, session, turn, `第 ${turn} 轮：用户和助手在整理记忆编号 ${turn}。`, `记住了第 ${turn} 条。`, at);
      if (turn % CHUNK === 0) {
        assert.equal(harness.cortex.repos.traces.count(), turn, `chunk ending at ${turn}`);
        assert.equal(harness.cortex.repos.events.count(), turn, `events at ${turn}`);
        assert.equal(runtime.pending().length, 0, `buffer flushed at ${turn}`);
      }
    }
    assert.equal(harness.cortex.repos.traces.count(), 200);
    assert.equal(harness.cortex.repos.events.count(), 200);
    assert.equal(harness.cortex.repos.events.verifyChain().ok, true);

    const digestDate = iso(BASE_MS).slice(0, 10);
    const digest = harness.cortex.digest.daily({ date: digestDate, now: BASE_MS + 200_000 });
    assert.equal(digest.counts.traces, 200);
    assert.equal(digest.byKind.utterance, 200);
    assert.equal(digest.important.length, 5);
    const digestText = await harness.call('cortex_digest', { action: 'daily', date: digestDate });
    assert.match(digestText, /新记忆：200 条/);
    assert.match(digestText, /重要记忆/);

    // Retention removes only old, low-value traces; important memories survive.
    const lowValue = write(harness.cortex, {
      text: '很久以前的一条低价值便签。', title: '低价值', explicit: true,
      importance: 0.05, confidence: 0.5, recordedAt: iso(BASE_MS - 500 * DAY_MS), now: BASE_MS,
    });
    const important = write(harness.cortex, {
      text: '很久以前的重要约定：用户说会买白饭，助手一直记得。', title: '重要约定', explicit: true,
      importance: 0.95, confidence: 0.9, recordedAt: iso(BASE_MS - 500 * DAY_MS), now: BASE_MS,
    });
    const plan = harness.cortex.retention.plan({ scopeId: 'global', now: BASE_MS + 300_000, maxAgeDays: 365 });
    assert.ok(plan.candidates.some((item) => item.id === lowValue.trace.id));
    assert.equal(plan.candidates.some((item) => item.id === important.trace.id), false, 'an important memory must not be a retention candidate');
    const applied = harness.cortex.retention.apply(plan);
    assert.ok(applied.ids.includes(lowValue.trace.id));
    assert.equal(harness.cortex.get(lowValue.trace.id).state, 'archived');
    assert.equal(harness.cortex.get(important.trace.id).state, 'active');
    assert.ok(hit(harness.cortex.search('重要约定 白饭', { now: BASE_MS + 310_000, limit: 8 }), important.trace.id));

    // Dream and sleep are separate life-side actions; both leave durable records.
    const dream = await harness.cortex.life.dreamGenerate({ at: BASE_MS + 400_000 });
    assert.ok(dream.id.startsWith('drm_'));
    assert.ok(dream.sourceCount > 0);
    assert.equal(harness.cortex.life.dreamList({ limit: 5 }).length, 1);
    const sleep = await harness.cortex.life.sleep({ at: BASE_MS + 500_000, windowDays: 1 });
    assert.ok(sleep.id.startsWith('slp_'));
    assert.equal(sleep.reflected, 1);
    assert.ok(sleep.stage);
    assert.equal(sleep.purgedWorking, 0);
    const sleepRuns = harness.cortex.life.sleepRuns({ limit: 5 });
    assert.equal(sleepRuns.length, 1);
    assert.equal(sleepRuns[0].report.reflected, 1);
    assert.equal(sleepRuns[0].report.at, iso(BASE_MS + 500_000));
    const sleepText = await harness.call('cortex_life', { action: 'sleep-runs' });
    assert.match(sleepText, /reflected/);
    assert.match(sleepText, /childhood|infancy|adolescence|adulthood/);
  } finally {
    harness.close();
  }
});

// ---------------------------------------------------------------------------
// 10. QA: grounded answer with injected LLM, extractive fallback, abstain
// ---------------------------------------------------------------------------

test('journey 10: memory QA uses an injected LLM, falls back to evidence, and abstains when empty', async () => {
  const fakeLlm = {
    calls: 0,
    requests: [],
    async complete(request) {
      this.calls += 1;
      this.requests.push(request);
      return '白饭 [1]';
    },
  };

  const grounded = createHarness({ llm: fakeLlm });
  try {
    write(grounded.cortex, { text: '用户最喜欢白饭，助手每天都会记得。', title: '白饭偏好', explicit: true, now: BASE_MS });
    const answer = await grounded.cortex.qa.answer({ question: '用户最喜欢什么？' });
    assert.equal(answer.mode, 'llm');
    assert.equal(answer.answer, '白饭 [1]');
    assert.ok(answer.sources.length >= 1);
    assert.equal(answer.sources[0].title, '白饭偏好');
    assert.equal(fakeLlm.calls, 1);
    const request = fakeLlm.requests[0];
    assert.equal(request.purpose, 'cortex-qa');
    assert.match(request.prompt, /问题：用户最喜欢什么？/);
    assert.match(request.prompt, /记忆片段/);
    assert.match(request.prompt, /白饭/);
    assert.equal(request.temperature, 0.1);

    const handler = createApiHandler({ cortex: grounded.cortex });
    const viaApi = await invokeApi(handler, {
      method: 'POST', route: '/qa', body: { question: '用户最喜欢什么？' }, headers: { 'x-cortex': '1' },
    });
    assert.equal(viaApi.status, 200);
    assert.equal(viaApi.json.ok, true);
    assert.equal(viaApi.json.data.mode, 'llm');
    assert.equal(viaApi.json.data.answer, '白饭 [1]');
    assert.equal(fakeLlm.calls, 2);
  } finally {
    grounded.close();
  }

  // Without an LLM the engine still answers, but labels it as extractive.
  const extractive = createHarness();
  try {
    write(extractive.cortex, { text: '用户最喜欢白饭，助手每天都会记得。', title: '白饭偏好', explicit: true, now: BASE_MS });
    const answer = await extractive.cortex.qa.answer({ question: '用户喜欢什么？' });
    assert.equal(answer.mode, 'extractive');
    assert.match(answer.answer, /抽取式/);
    assert.match(answer.answer, /白饭/);
    assert.ok(answer.sources.length >= 1);
  } finally {
    extractive.close();
  }

  // With no relevant memory, both engines must abstain; the LLM is not called.
  const emptyLlm = {
    calls: 0,
    async complete() {
      this.calls += 1;
      return '这是模型编造的答案';
    },
  };
  const empty = createHarness({ llm: emptyLlm });
  try {
    const answer = await empty.cortex.qa.answer({ question: 'xyzzyplugh 完全不存在的问题' });
    assert.equal(answer.mode, 'abstain');
    assert.equal(answer.answer, '不知道。没有召回相关记忆。');
    assert.deepEqual(answer.sources, []);
    assert.equal(answer.result.items.length, 0);
    assert.equal(emptyLlm.calls, 0, 'an empty recall must short-circuit before the LLM');
    assert.equal(empty.cortex.repos.traces.count(), 0);
  } finally {
    empty.close();
  }
});
