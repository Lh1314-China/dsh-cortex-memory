/**
 * Tool contract integration tests for dsh-cortex.
 *
 * These tests are deliberately black-box and dependency-free: every case opens
 * a real cortex in a throwaway directory, drives the real registered tool
 * `execute()` functions, and closes/deletes everything in `finally`.
 *
 * The contract under test is the public tool surface, not the SQL schema:
 * - every registered definition is complete and renderable,
 * - every documented action returns `{ text: string }` and does not throw for
 *   valid minimal arguments,
 * - destructive/expensive actions only ever touch the temporary data root,
 * - unknown ids and malformed inputs surface a sentinel string or a clear
 *   error instead of corrupting memory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createToolDefinitions } from '../../src/tools/definitions.js';

const TOOL_NAMES = [
  'cortex_as_of',
  'cortex_playbook',
  'cortex_consolidate',
  'cortex_compress',
  'cortex_digest',
  'cortex_emotion',
  'cortex_evolve',
  'cortex_feedback',
  'cortex_forget',
  'cortex_get',
  'cortex_goal',
  'cortex_guard',
  'cortex_health',
  'cortex_life',
  'cortex_reflect',
  'cortex_search',
  'cortex_self',
  'cortex_tick',
  'cortex_timeline',
  'cortex_working',
  'cortex_write',
];

const ACTION_ENUMS = {
  cortex_consolidate: ['run', 'list'],
  cortex_playbook: ['add', 'list', 'vote', 'retire', 'render', 'suggest', 'approve'],
  cortex_tick: ['run', 'status'],
  cortex_digest: ['daily'],
  cortex_working: ['add', 'list', 'pin', 'remove', 'purge'],
  cortex_goal: ['add', 'list', 'update', 'complete'],
  cortex_compress: ['evaluate', 'compress', 'revive'],
  cortex_life: ['diary-write', 'diary-list', 'diary-forget', 'dream', 'sleep', 'sleep-runs'],
  cortex_emotion: ['detect', 'record', 'affect', 'events', 'lexicon'],
  cortex_evolve: ['status', 'optimize', 'propose', 'approve', 'rollback'],
  cortex_guard: ['check', 'backup', 'validate', 'restore', 'repair', 'export', 'sync'],
};

const REQUIRED_FIELDS = {
  cortex_consolidate: ['action'],
  cortex_playbook: ['action'],
  cortex_tick: ['action'],
  cortex_digest: ['action'],
  cortex_working: ['action'],
  cortex_goal: ['action'],
  cortex_compress: ['action'],
  cortex_life: ['action'],
  cortex_emotion: ['action'],
  cortex_evolve: ['action'],
  cortex_guard: ['action'],
  cortex_search: ['query'],
  cortex_as_of: ['subject'],
  cortex_timeline: ['aroundId'],
  cortex_get: ['id'],
  cortex_write: ['text'],
  cortex_feedback: ['id', 'signal'],
  cortex_forget: ['id', 'mode'],
  cortex_reflect: [],
  cortex_self: [],
  cortex_health: [],
};

const CONCURRENCY_SAFE = new Set(['cortex_search', 'cortex_as_of', 'cortex_get', 'cortex_timeline', 'cortex_self', 'cortex_health']);

const FEEDBACK_SIGNALS = ['used', 'helpful', 'ignored', 'incorrect', 'corrected', 'again', 'good', 'easy', 'hard'];

/** Create a real cortex plus its tool map inside a fresh temporary directory. */
function makeHarness(config = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-tools-contract-'));
  const dataRoot = path.join(dir, 'data');
  const dbFile = path.join(dataRoot, 'cortex.sqlite');
  let cortex;
  try {
    cortex = createCortex({ config: { ...config, dataRoot, dbFile } });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    throw error;
  }
  const tools = Object.fromEntries(createToolDefinitions(cortex).map((tool) => [tool.name, tool]));
  let closed = false;
  return {
    dir,
    dataRoot,
    dbFile,
    cortex,
    tools,
    close() {
      if (closed) return;
      closed = true;
      try {
        cortex.close();
      } catch {
        /* cleanup must never mask a test failure */
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

/** Execute a tool and assert the shared `{ text: string }` contract. */
async function call(tool, args = {}) {
  assert.ok(tool, 'tool must exist');
  const value = await tool.execute(args);
  assert.ok(value && typeof value === 'object', `${tool.name} must return an object`);
  assert.equal(typeof value.text, 'string', `${tool.name} must return { text: string }`);
  return value.text;
}

/** Extract the first id with the requested prefix from a tool response. */
function idOf(text, prefix) {
  const match = String(text).match(new RegExp(`\\b(${prefix}_[a-z0-9]+)\\b`));
  assert.ok(match, `expected a ${prefix}_ id in: ${text}`);
  return match[1];
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('tool registry exposes exactly the 21 documented tools', () => {
  const harness = makeHarness();
  try {
    const names = Object.keys(harness.tools).sort();
    assert.deepEqual(names, TOOL_NAMES.slice().sort());
    assert.equal(names.length, 21);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) {
      assert.equal(harness.tools[name].name, name);
    }
  } finally {
    harness.close();
  }
});

test('every tool definition is complete, renderable and honest about concurrency', () => {
  const harness = makeHarness();
  try {
    for (const tool of Object.values(harness.tools)) {
      assert.equal(typeof tool.name, 'string', 'name must be a string');
      assert.ok(tool.name.length > 0, 'name must not be empty');
      assert.equal(typeof tool.description, 'string', `${tool.name} description must be a string`);
      assert.ok(tool.description.length >= 20, `${tool.name} description must be useful`);

      assert.ok(tool.parameters && typeof tool.parameters === 'object', `${tool.name} parameters must be an object`);
      assert.equal(tool.parameters.type, 'object', `${tool.name} parameters.type`);
      assert.equal(tool.parameters.additionalProperties, false, `${tool.name} parameters.additionalProperties`);
      assert.equal(typeof tool.parameters.properties, 'object', `${tool.name} parameters.properties`);
      if ('required' in tool.parameters) {
        assert.ok(Array.isArray(tool.parameters.required), `${tool.name} parameters.required must be an array`);
      }

      assert.ok(tool.output && typeof tool.output === 'object', `${tool.name} output must be an object`);
      assert.equal(tool.output.schema.type, 'object', `${tool.name} output.schema.type`);
      assert.deepEqual(tool.output.schema.required, ['text'], `${tool.name} output must require text`);
      assert.equal(tool.output.schema.properties.text.type, 'string', `${tool.name} output text type`);
      assert.equal(typeof tool.output.render, 'function', `${tool.name} output.render`);
      assert.deepEqual(tool.output.render({}, { text: '渲染测试' }), [{ type: 'text', text: '渲染测试' }]);
      assert.deepEqual(tool.output.render({}, null), [{ type: 'text', text: '' }]);

      assert.equal(typeof tool.isConcurrencySafe, 'function', `${tool.name} isConcurrencySafe`);
      assert.equal(typeof tool.isConcurrencySafe(), 'boolean', `${tool.name} isConcurrencySafe must return boolean`);
      assert.equal(tool.isConcurrencySafe(), CONCURRENCY_SAFE.has(tool.name), `${tool.name} concurrency contract`);
      assert.equal(typeof tool.execute, 'function', `${tool.name} execute`);
      assert.equal(typeof tool.presentCall, 'function', `${tool.name} presentCall`);
    }

    assert.throws(() => createToolDefinitions(), /need a cortex service/);
  } finally {
    harness.close();
  }
});

test('action enums, required fields and key option schemas match the documented surface', () => {
  const harness = makeHarness();
  try {
    for (const [name, actions] of Object.entries(ACTION_ENUMS)) {
      const tool = harness.tools[name];
      assert.deepEqual(tool.parameters.properties.action.enum, actions, `${name} actions`);
      assert.deepEqual(tool.parameters.required, ['action'], `${name} must require action`);
    }
    for (const name of TOOL_NAMES) {
      const tool = harness.tools[name];
      assert.deepEqual(tool.parameters.required ?? [], REQUIRED_FIELDS[name], `${name} required fields`);
      if (!ACTION_ENUMS[name]) {
        assert.equal(tool.parameters.properties.action, undefined, `${name} must not declare an action enum`);
      }
    }

    assert.deepEqual(harness.tools.cortex_forget.parameters.properties.mode.enum, ['archive', 'delete']);
    assert.deepEqual(harness.tools.cortex_feedback.parameters.properties.signal.enum, FEEDBACK_SIGNALS);
    assert.equal(harness.tools.cortex_write.parameters.properties.text.type, 'string');
    assert.equal(harness.tools.cortex_write.parameters.properties.facts.type, 'array');
    assert.equal(harness.tools.cortex_search.parameters.properties.limit.type, 'number');
    assert.equal(harness.tools.cortex_guard.parameters.properties.dir.type, 'string');
    assert.equal(harness.tools.cortex_evolve.parameters.properties.config.type, 'object');
    assert.equal(harness.tools.cortex_tick.parameters.properties.max.type, 'number');
  } finally {
    harness.close();
  }
});

test('cortex_write: minimal write, explicit facts, scopes and operationId idempotency', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    // Minimal args: text only must be enough for a useful, explicit-looking note.
    const minimal = await call(tools.cortex_write, { text: '喜欢白饭。' });
    assert.match(minimal, /^已写入 trc_/);
    assert.match(minimal, /事件：evt_/);
    assert.match(minimal, /压缩值：0\.\d{3}/);
    const minimalId = idOf(minimal, 'trc');
    const minimalTrace = cortex.get(minimalId);
    assert.equal(minimalTrace.content, '喜欢白饭。');
    assert.equal(minimalTrace.kind, 'preference');
    assert.equal(minimalTrace.state, 'active');
    assert.equal(cortex.repos.traces.count(), 1);

    // Full args: kind/importance/confidence/tags/scope/facts all flow through.
    const richText = '主人答应会买白饭，本鲸会一直等。';
    const rich = await call(tools.cortex_write, {
      text: richText,
      kind: 'promise',
      importance: 0.8,
      confidence: 0.9,
      explicit: true,
      tags: ['白饭', '承诺'],
      scope: 'shared',
      facts: [{ subject: '主人', predicate: '答应', objectLiteral: '买白饭', confidence: 0.9 }],
    });
    assert.match(rich, /^已写入 trc_/);
    assert.match(rich, /（promise）/);
    assert.match(rich, /事实：1 条/);
    const richId = idOf(rich, 'trc');
    const richTrace = cortex.get(richId);
    assert.equal(richTrace.scopeId, 'shared');
    assert.equal(richTrace.kind, 'promise');
    assert.deepEqual(richTrace.tags, ['白饭', '承诺']);
    assert.equal(richTrace.confidence, 0.9);
    assert.ok(richTrace.importance >= 0.8);
    const richFacts = cortex.repos.facts.list({ scopeId: 'shared' });
    assert.equal(richFacts.length, 1);
    assert.equal(richFacts[0].objectLiteral, '买白饭');

    // Scope is real: the shared trace is visible only through a scoped search.
    const scopedSearch = await call(tools.cortex_search, { query: '白饭', scope: 'shared' });
    assert.match(scopedSearch, new RegExp(richId));
    const globalSearch = await call(tools.cortex_search, { query: '白饭' });
    assert.doesNotMatch(globalSearch, new RegExp(richId));

    // Idempotency: reusing operationId with the identical payload returns the first trace.
    const operationId = 'tools-contract-idempotent-write';
    const opText = '幂等写入：主人会买白饭。';
    const firstOp = await call(tools.cortex_write, { text: opText, explicit: true, operationId });
    const opId = idOf(firstOp, 'trc');
    const traceCount = cortex.repos.traces.count();
    const eventCount = cortex.repos.events.count();
    const replay = await call(tools.cortex_write, { text: opText, explicit: true, operationId });
    assert.match(replay, /^未写入：idempotent（已有 trc_/);
    assert.match(replay, new RegExp(opId));
    assert.equal(cortex.repos.traces.count(), traceCount);
    assert.equal(cortex.repos.events.count(), eventCount);

    // Reusing operationId with different content is a conflict, not a silent overwrite.
    await assert.rejects(
      () => tools.cortex_write.execute({ text: '完全不同的内容，operationId 冲突。', explicit: true, operationId }),
      /already exists with a different payload/,
    );
    assert.equal(cortex.repos.traces.count(), traceCount);
    assert.equal(cortex.repos.events.count(), eventCount);

    // Content duplicates are skipped without creating another trace.
    const duplicate = await call(tools.cortex_write, { text: opText, explicit: true });
    assert.match(duplicate, /^未写入：duplicate（已有 trc_/);
    assert.match(duplicate, new RegExp(opId));
    assert.equal(cortex.repos.traces.count(), traceCount);

    // A duplicate may still carry new facts; do not drop them silently.
    const duplicateFacts = await call(tools.cortex_write, {
      text: opText,
      explicit: true,
      facts: [{ subject: '测试对象', predicate: '喜欢', objectLiteral: '测试值' }],
    });
    assert.match(duplicateFacts, /^未写入：duplicate/);
    assert.match(duplicateFacts, /已应用 1 条事实/);
    const asOf = await call(tools.cortex_as_of, { subject: '测试对象', predicate: '喜欢', mode: 'historical' });
    assert.match(asOf, /测试值/);
    assert.equal(cortex.repos.traces.count(), traceCount);

    // Bad text is reported with a useful next step, never thrown.
    assert.match(await call(tools.cortex_write, {}), /^未写入：too-short/);
    assert.match(await call(tools.cortex_write, { text: '   ' }), /^未写入：too-short/);
    assert.match(await call(tools.cortex_write, { text: '谢谢' }), /^未写入：stop-phrase/);
    const lowCompression = await call(tools.cortex_write, { text: 'test message' });
    assert.match(lowCompression, /^未写入：low-compression/);
    assert.match(lowCompression, /explicit: true/);
  } finally {
    harness.close();
  }
});

test('cortex_search: hits, filters, budgets, archived opt-in and empty queries', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  const base = Date.now();
  try {
    const decision = cortex.write({
      text: '决定今天去吃白饭，白饭是主食。',
      title: '白饭决定',
      kind: 'decision',
      explicit: true,
      tags: ['白饭', '决定'],
      now: base,
    });
    const preference = cortex.write({
      text: '主人喜欢白饭，本鲸记得。',
      title: '白饭偏好',
      kind: 'preference',
      explicit: true,
      tags: ['白饭', '偏好'],
      now: base + 1_000,
    });
    assert.equal(decision.skipped, false);
    assert.equal(preference.skipped, false);

    let text = await call(tools.cortex_search, { query: '白饭', limit: 2 });
    assert.match(text, /^查询：白饭 · 意图：fact/);
    assert.match(text, /预算：\d+\/\d+ token · 候选 \d+ · 选中 \d+/);
    assert.match(text, new RegExp(decision.trace.id));
    assert.match(text, new RegExp(preference.trace.id));

    // Query-language filters are parsed before retrieval.
    text = await call(tools.cortex_search, { query: 'kind:decision 白饭' });
    assert.match(text, new RegExp(decision.trace.id));
    assert.doesNotMatch(text, new RegExp(preference.trace.id));

    // limit + budget still respect the portfolio contract.
    text = await call(tools.cortex_search, { query: '白饭', limit: 1, budget: 16 });
    assert.match(text, /预算：16\/16 token · 候选 \d+ · 选中 1/);

    // Archived traces stay out unless explicitly requested.
    const archived = await call(tools.cortex_forget, { id: preference.trace.id, mode: 'archive' });
    assert.match(archived, /已归档/);
    text = await call(tools.cortex_search, { query: '白饭' });
    assert.doesNotMatch(text, new RegExp(preference.trace.id));
    text = await call(tools.cortex_search, { query: '白饭', includeArchived: true });
    assert.match(text, new RegExp(preference.trace.id));

    // Empty query is accepted as "recent items" and rendered as an empty query.
    text = await call(tools.cortex_search, { query: '' });
    assert.match(text, /^查询：（空） · 意图：fact/);

    // No candidates in the requested scope is a normal result, not an exception.
    // (A populated scope always contributes its recent items, even for a query
    // that matches nothing, so the empty case has to use an empty scope.)
    text = await call(tools.cortex_search, { query: '完全不存在的词汇xyzzy', scope: 'empty-scope' });
    assert.match(text, /选中 0/);
    assert.match(text, /候选 0/);

    // Scope is honored by retrieval.
    const other = cortex.write({
      text: '另一个 scope 的白饭记录。',
      title: '另一个 scope',
      explicit: true,
      scopeId: 'other',
      now: base + 2_000,
    });
    text = await call(tools.cortex_search, { query: '另一个 scope', scope: 'other' });
    assert.match(text, new RegExp(other.trace.id));
    text = await call(tools.cortex_search, { query: '另一个 scope' });
    assert.doesNotMatch(text, new RegExp(other.trace.id));
  } finally {
    harness.close();
  }
});

test('cortex_get: full trace rendering and unknown id sentinel', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    const written = cortex.write({
      text: '读取契约：正文里要有白饭。',
      title: '读取标题',
      summary: '读取摘要',
      kind: 'observation',
      confidence: 0.75,
      tags: ['读取', '白饭'],
      explicit: true,
    });
    const text = await call(tools.cortex_get, { id: written.trace.id });
    assert.match(text, /^\[observation\] 读取标题/);
    assert.match(text, /时间：/);
    assert.match(text, /来源：user/);
    assert.match(text, /置信：0\.75/);
    assert.match(text, /状态：active\/raw · 稳定性 1\.00 · 难度 5\.00/);
    assert.match(text, /摘要：读取摘要/);
    assert.match(text, /正文里要有白饭/);
    assert.match(text, /标签：读取、白饭/);

    assert.equal(await call(tools.cortex_get, { id: 'trc_does_not_exist' }), '没有这条记忆：trc_does_not_exist');
    // Missing required args are not validated by the host here, but the tool
    // still fails closed with a readable sentinel instead of throwing.
    assert.equal(await call(tools.cortex_get, {}), '没有这条记忆：undefined');
  } finally {
    harness.close();
  }
});

test('cortex_playbook: add, vote, render, expiry and retire', async () => {
  const harness = makeHarness();
  const { tools } = harness;
  try {
    let text = await call(tools.cortex_playbook, { action: 'add', title: '发版前跑测试', body: '先跑全量测试，再发版。', tags: ['release'] });
    const id = text.match(/pbr_[a-z0-9]+/)?.[0];
    assert.ok(id);
    assert.match(text, /发版前跑测试/);
    text = await call(tools.cortex_playbook, { action: 'vote', id, signal: 'helpful' });
    assert.match(text, /helpful=1/);
    text = await call(tools.cortex_playbook, { action: 'render' });
    assert.match(text, /发版前跑测试/);
    text = await call(tools.cortex_playbook, { action: 'retire', id });
    assert.match(text, /已停用/);
    text = await call(tools.cortex_playbook, { action: 'render' });
    assert.match(text, /准则本为空/);
    text = await call(tools.cortex_playbook, { action: 'add', title: '过期规则', body: '不该注入', validTo: '2020-01-01T00:00:00Z' });
    assert.match(text, /过期规则/);
    text = await call(tools.cortex_playbook, { action: 'render' });
    assert.doesNotMatch(text, /过期规则/);
    harness.cortex.write({ text: '以后发版前必须先跑测试。', explicit: true, kind: 'reflection' });
    text = await call(tools.cortex_playbook, { action: 'suggest' });
    assert.match(text, /candidate/);
    const candidateId = text.match(/pbr_[a-z0-9]+/)?.[0];
    assert.ok(candidateId);
    text = await call(tools.cortex_playbook, { action: 'approve', id: candidateId });
    assert.match(text, /已确认/);
    text = await call(tools.cortex_playbook, { action: 'render' });
    assert.match(text, /发版前必须先跑测试/);
  } finally {
    harness.close();
  }
});

test('cortex_as_of: strict, historical, belief and associative views', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    const t1 = Date.parse('2026-11-10T10:00:00+08:00');
    const t2 = Date.parse('2026-11-11T10:00:00+08:00');
    cortex.write({ text: '主人喜欢白饭。', explicit: true, now: t1, facts: [{ subject: '主人', predicate: '喜欢', object: '白饭' }] });
    cortex.write({ text: '主人现在喜欢面。', explicit: true, now: t2, facts: [{ subject: '主人', predicate: '喜欢', object: '面' }] });
    let text = await call(tools.cortex_as_of, { subject: '主人', predicate: '喜欢', at: new Date(t1 + 1000).toISOString(), mode: 'historical' });
    assert.match(text, /喜欢 → 白饭/);
    text = await call(tools.cortex_as_of, { subject: '主人', predicate: '喜欢', mode: 'strict' });
    assert.match(text, /喜欢 → 面/);
    assert.doesNotMatch(text, /喜欢 → 白饭/);
    text = await call(tools.cortex_as_of, { subject: '主人', mode: 'associative' });
    assert.match(text, /白饭/);
    assert.match(text, /面/);
    text = await call(tools.cortex_as_of, { subject: '不存在的主体' });
    assert.match(text, /没有/);
  } finally {
    harness.close();
  }
});

test('cortex_timeline: anchor neighbourhood, anchors with no neighbours and missing anchor', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  const base = Date.now();
  try {
    const first = cortex.write({ text: '时间线内容第一条。', title: '第一条', kind: 'observation', explicit: true, now: base });
    const second = cortex.write({ text: '时间线内容第二条。', title: '第二条', kind: 'observation', explicit: true, now: base + 1_000 });
    const third = cortex.write({ text: '时间线内容第三条。', title: '第三条', kind: 'observation', explicit: true, now: base + 2_000 });
    assert.equal(first.skipped, false);
    assert.equal(second.skipped, false);
    assert.equal(third.skipped, false);

    let text = await call(tools.cortex_timeline, { aroundId: second.trace.id, before: 1, after: 1 });
    assert.match(text, /^锚点：第二条/);
    const detailLines = text.split('\n').filter((line) => line.includes(' — '));
    assert.equal(detailLines.length, 3);
    assert.equal(detailLines.filter((line) => line.startsWith('→')).length, 1);
    const anchorLine = detailLines.find((line) => line.startsWith('→'));
    assert.match(anchorLine, /第二条/);
    assert.match(text, /第一条/);
    assert.match(text, /第三条/);

    text = await call(tools.cortex_timeline, { aroundId: second.trace.id, before: 0, after: 0 });
    assert.match(text, /^锚点：第二条/);
    assert.equal(text.split('\n').filter((line) => line.includes(' — ')).length, 1);

    assert.equal(await call(tools.cortex_timeline, { aroundId: 'trc_missing' }), '（没有找到锚点）');
    assert.equal(await call(tools.cortex_timeline, {}), '（没有找到锚点）');
  } finally {
    harness.close();
  }
});

test('cortex_feedback: every signal updates DSR/confidence without throwing', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    const written = cortex.write({ text: '反馈契约：主人会买白饭。', explicit: true });
    let text = await call(tools.cortex_feedback, {
      id: written.trace.id,
      signal: 'used',
      predicted: 0.8,
    });
    assert.match(text, /^反馈已记：used → trc_/);
    assert.match(text, new RegExp(written.trace.id));
    assert.match(text, /稳定性 \d+\.\d{2} · 置信 \d+\.\d{2} · 复习 1/);
    assert.equal(cortex.get(written.trace.id).reviewCount, 1);

    for (const signal of FEEDBACK_SIGNALS.slice(1)) {
      text = await call(tools.cortex_feedback, { id: written.trace.id, signal, predicted: 0.6 });
      assert.match(text, new RegExp(`^反馈已记：${signal} → ${written.trace.id}`));
      assert.match(text, /稳定性/);
      assert.match(text, /置信/);
      assert.match(text, /复习/);
    }
    const trace = cortex.get(written.trace.id);
    assert.equal(trace.reviewCount, FEEDBACK_SIGNALS.length);
    assert.equal(cortex.repos.feedback.list({ scopeId: 'global', limit: 50 }).length, FEEDBACK_SIGNALS.length);
    const aggregate = cortex.repos.feedback.aggregate(written.trace.id);
    // aggregate.total is intentionally the DSR-relevant total: the four
    // positive signals plus the three negative ones. 'ignored' and 'hard' are
    // recorded but are neutral for that total.
    assert.equal(aggregate.total, 7);
    for (const signal of FEEDBACK_SIGNALS) {
      assert.equal(aggregate.counts[signal], 1, `aggregate must count ${signal}`);
    }

    await assert.rejects(
      () => tools.cortex_feedback.execute({ id: 'trc_missing', signal: 'used' }),
      /trace not found: trc_missing/,
    );
  } finally {
    harness.close();
  }
});

test('cortex_forget: archive stays searchable, delete cascades on a disposable trace', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  const base = Date.now();
  try {
    const archived = cortex.write({
      text: '归档契约：主人会买白饭。',
      title: '归档目标',
      explicit: true,
      facts: [{ subject: '主人', predicate: '会买', objectLiteral: '白饭', confidence: 0.9 }],
      now: base,
    });
    await call(tools.cortex_feedback, { id: archived.trace.id, signal: 'used' });
    let text = await call(tools.cortex_forget, { id: archived.trace.id, mode: 'archive' });
    assert.equal(text, `已归档 ${archived.trace.id}，可用关键词唤醒。`);
    const archivedTrace = cortex.get(archived.trace.id);
    assert.equal(archivedTrace.state, 'archived');
    assert.equal(archivedTrace.compression, 'archived');
    assert.ok(cortex.repos.events.get(archived.event.id), 'the event ledger must survive archiving');

    text = await call(tools.cortex_search, { query: '归档目标' });
    assert.doesNotMatch(text, new RegExp(archived.trace.id));
    text = await call(tools.cortex_search, { query: '归档目标', includeArchived: true });
    assert.match(text, new RegExp(archived.trace.id));

    assert.equal(await call(tools.cortex_forget, { id: 'trc_missing', mode: 'archive' }), '没有这条记忆：trc_missing');
    assert.equal(await call(tools.cortex_forget, { id: 'trc_missing', mode: 'delete' }), '没有这条记忆：trc_missing');
    await assert.rejects(() => tools.cortex_forget.execute({ id: 'trc_x', mode: 'shred' }), /unknown forget mode/);
    await assert.rejects(() => tools.cortex_forget.execute({ mode: 'archive' }), /traceId is required/);

    // Delete is exercised on a disposable trace because it is irreversible.
    const disposable = cortex.write({
      text: '删除契约：这段内容会被删除。',
      title: '删除目标',
      explicit: true,
      facts: [{ subject: '本鲸', predicate: '测试', objectLiteral: '删除级联', confidence: 0.8 }],
      now: base + 1_000,
    });
    await call(tools.cortex_feedback, { id: disposable.trace.id, signal: 'incorrect' });
    const summary = cortex.repos.summaries.insert({
      scopeId: 'global',
      level: 'episode',
      content: '删除目标的派生摘要',
      sourceIds: [disposable.trace.id],
      coverage: 1,
    });
    text = await call(tools.cortex_forget, { id: disposable.trace.id, mode: 'delete' });
    assert.equal(text, `已删除 ${disposable.trace.id}，并级联清理派生数据。`);
    assert.equal(cortex.get(disposable.trace.id), null);
    assert.equal(cortex.repos.feedback.list({ scopeId: 'global', traceId: disposable.trace.id }).length, 0);
    assert.equal(
      cortex.repos.facts.list({ scopeId: 'global' }).filter((fact) => fact.sourceEventId === disposable.event.id).length,
      0,
    );
    assert.equal(cortex.repos.summaries.get(summary.id), null);
    assert.ok(cortex.repos.events.get(disposable.event.id), 'the ledger keeps the event with only a hash');
    assert.equal(JSON.stringify(cortex.repos.events.get(disposable.event.id).payload).includes('删除契约'), false);
    text = await call(tools.cortex_search, { query: '删除契约' });
    assert.doesNotMatch(text, new RegExp(disposable.trace.id));
  } finally {
    harness.close();
  }
});

test('cortex_reflect: needs two traces, creates a reflection, skips duplicates and supports force', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    const onlyOne = await call(tools.cortex_reflect, {});
    assert.match(onlyOne, /^未整理：not-enough-traces/);

    await call(tools.cortex_write, { text: '反思契约第一条：主人喜欢白饭。', explicit: true });
    await call(tools.cortex_write, { text: '反思契约第二条：本鲸会等主人。', explicit: true });

    const first = await call(tools.cortex_reflect, {});
    assert.match(first, /^这段时间里，本鲸记住了：/);
    assert.match(first, /来源 2 条 · 覆盖率 100% · 反思痕迹 trc_/);
    const reflectionId = idOf(first, 'trc');
    assert.equal(cortex.get(reflectionId).kind, 'reflection');
    const episodes = cortex.repos.summaries.list('global', { level: 'episode' });
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].sourceIds.length, 2);
    assert.equal(episodes[0].coverage, 1);

    const again = await call(tools.cortex_reflect, {});
    assert.match(again, /^未整理：already-reflected/);

    const forced = await call(tools.cortex_reflect, { windowDays: 2, force: true });
    assert.match(forced, /^这段时间里，本鲸记住了：/);
    assert.match(forced, /来源 2 条 · 覆盖率 100% · 反思痕迹 trc_/);
    assert.equal(cortex.repos.summaries.list('global', { level: 'episode' }).length, 2);
  } finally {
    harness.close();
  }
});

test('cortex_self: snapshot fields, relationship/calibration feedback and read-only behaviour', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    let text = await call(tools.cortex_self, {});
    assert.match(text, /阶段：(infancy|childhood|adolescence|adulthood)/);
    assert.match(text, /驱力：.*\d/);
    assert.match(text, /情绪：valence -?\d+\.\d{2} \/ arousal \d+\.\d{2} \/ energy \d+\.\d{2}/);
    assert.match(text, /身份：v1 /);
    assert.doesNotMatch(text, /关系：/);
    assert.doesNotMatch(text, /校准：/);

    const written = cortex.write({ text: '自我契约：主人喜欢白饭。', explicit: true });
    await call(tools.cortex_feedback, { id: written.trace.id, signal: 'used', predicted: 0.8 });
    await call(tools.cortex_working, { action: 'add', text: '写自我契约测试。' });
    await call(tools.cortex_goal, { action: 'add', title: '完成自我契约测试' });

    const eventsBefore = cortex.repos.events.count();
    const tracesBefore = cortex.repos.traces.count();
    text = await call(tools.cortex_self, {});
    assert.match(text, /关系：主人 信任 \d+% \/ 在乎 \d+%/);
    assert.match(text, /校准：n=1 brier=0\.040 ece=\d+\.\d{3}/);
    assert.equal(cortex.repos.events.count(), eventsBefore);
    assert.equal(cortex.repos.traces.count(), tracesBefore);
  } finally {
    harness.close();
  }
});

test('cortex_health: clean audits, concrete counts, FTS drift detection and read-only reporting', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  const base = Date.now();
  try {
    const first = cortex.write({ text: '健康契约第一条。', explicit: true, now: base });
    const second = cortex.write({
      text: '健康契约第二条：主人喜欢白饭。',
      explicit: true,
      facts: [{ subject: '主人', predicate: '喜欢', objectLiteral: '白饭', confidence: 0.8 }],
      now: base + 1_000,
    });
    assert.equal(first.skipped, false);
    assert.equal(second.skipped, false);

    let text = await call(tools.cortex_health, {});
    assert.match(text, /健康分：\d+\/100/);
    assert.match(text, /事件 2 · 痕迹 2（active 2）· 事实 1 · 技能 0/);
    assert.match(text, /没有发现问题/);
    const eventsBefore = cortex.repos.events.count();
    const tracesBefore = cortex.repos.traces.count();

    // Inject the exact drift the audit promises to catch.
    cortex.db.prepare('DELETE FROM traces_fts_index WHERE trace_id = ?').run(first.trace.id);
    text = await call(tools.cortex_health, {});
    assert.match(text, /问题：/);
    // formatHealth renders severity + message, not the issue code.
    assert.match(text, /\[warn\] FTS 行数 1 与 traces 2 不一致/);
    assert.match(text, /健康分：94\/100/);

    // Reporting is read-only; the repair is an explicit guardian action.
    assert.equal(cortex.repos.events.count(), eventsBefore);
    assert.equal(cortex.repos.traces.count(), tracesBefore);
    cortex.guardian.repairFts();
    text = await call(tools.cortex_health, {});
    assert.match(text, /健康分：100\/100/);
    assert.match(text, /没有发现问题/);
  } finally {
    harness.close();
  }
});

test('cortex_guard: check, backup, validate, restore-to-temp, repair and export', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    const written = cortex.write({
      text: '守卫契约：主人会买白饭。',
      title: '白饭承诺',
      explicit: true,
      facts: [{ subject: '主人', predicate: '会买', objectLiteral: '白饭', confidence: 0.9 }],
    });
    assert.equal(written.skipped, false);

    // check
    let text = await call(tools.cortex_guard, { action: 'check' });
    assert.match(text, /^自检：通过 · integrity=ok · db \d+ B/);

    // backup
    const backupPath = path.join(harness.dir, 'backups', 'cortex-guard.sqlite');
    text = await call(tools.cortex_guard, { action: 'backup', file: backupPath });
    assert.match(text, /^备份完成：/);
    assert.ok(text.includes(path.resolve(backupPath)), 'backup text must name the resolved path');
    assert.match(text, /（\d+ B）/);
    assert.ok(fs.existsSync(backupPath));
    assert.ok(fs.statSync(backupPath).size > 0);

    // validate
    text = await call(tools.cortex_guard, { action: 'validate', file: backupPath });
    assert.match(text, /^备份有效：/);
    const tables = Number(text.match(/（(\d+) 张表）/)?.[1]);
    assert.ok(tables >= 20, `expected at least 20 tables, got ${tables}`);
    text = await call(tools.cortex_guard, { action: 'validate', file: path.join(harness.dir, 'missing.sqlite') });
    assert.equal(text, '备份无效：missing');

    // restore is only allowed to an offline target.
    const target = path.join(harness.dir, 'offline', 'restored.sqlite');
    text = await call(tools.cortex_guard, { action: 'restore', file: backupPath, target });
    assert.equal(text, `已恢复到离线库：${path.resolve(target)}`);
    assert.ok(fs.existsSync(target));
    const restored = new DatabaseSync(target);
    try {
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(Number(restored.prepare('SELECT COUNT(*) AS c FROM traces').get().c), 1);
      assert.equal(Number(restored.prepare('SELECT COUNT(*) AS c FROM facts').get().c), 1);
      assert.equal(restored.prepare('SELECT content FROM traces LIMIT 1').get().content, '守卫契约：主人会买白饭。');
    } finally {
      restored.close();
    }

    text = await call(tools.cortex_guard, { action: 'restore', file: backupPath, target: cortex.config.dbFile });
    assert.match(text, /^恢复失败：live-db/);
    assert.match(text, /关闭当前 cortex|新路径|离线/);
    assert.equal(cortex.repos.traces.count(), 1, 'the live DB must be untouched');

    text = await call(tools.cortex_guard, { action: 'restore', file: backupPath });
    assert.equal(text, '恢复失败：target-required');
    text = await call(tools.cortex_guard, {
      action: 'restore',
      file: path.join(harness.dir, 'never-created.sqlite'),
      target: path.join(harness.dir, 'offline', 'nope.sqlite'),
    });
    assert.match(text, /^恢复失败：invalid-backup/);

    // repair
    cortex.db.prepare('DELETE FROM traces_fts_index').run();
    text = await call(tools.cortex_guard, { action: 'check' });
    assert.match(text, /发现问题/);
    assert.match(text, /FTS_DRIFT/);
    text = await call(tools.cortex_guard, { action: 'repair' });
    assert.equal(text, 'FTS 重建完成：0 → 1（1 条）');
    assert.equal(cortex.repos.traces.ftsCount(), 1);
    text = await call(tools.cortex_guard, { action: 'check' });
    assert.match(text, /^自检：通过/);

    // export into the temp directory
    const mirror = path.join(harness.dir, 'mirror');
    text = await call(tools.cortex_guard, { action: 'export', dir: mirror });
    assert.match(text, /^Markdown 镜像已导出：/);
    assert.ok(text.includes(path.resolve(mirror)));
    assert.match(text, /文件：MEMORY\.md、SELF\.md、FACTS\.md、SKILLS\.md/);
    assert.match(text, /记忆 1 条（跳过 secret 0 条）/);
    const memoryFile = path.join(mirror, 'MEMORY.md');
    assert.ok(fs.existsSync(memoryFile));
    assert.match(fs.readFileSync(memoryFile, 'utf8'), /守卫契约：主人会买白饭。/);
    for (const file of ['SELF.md', 'FACTS.md', 'SKILLS.md']) {
      assert.ok(fs.existsSync(path.join(mirror, file)), `${file} must be exported`);
    }
  } finally {
    harness.close();
  }
});

test('cortex_evolve: status, optimize, propose, approve, rollback and gated errors', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    // status on a clean cortex
    let text = await call(tools.cortex_evolve, { action: 'status' });
    assert.match(text, /^活跃策略：/);
    assert.match(text, /（无）/);
    assert.match(text, /候选：0/);
    assert.match(text, /身份：v1/);

    // optimize produces nothing without evidence.
    text = await call(tools.cortex_evolve, { action: 'optimize' });
    assert.equal(text, '没有需要提议的改动。');

    // Create evidence: one active skill with three failures is worth demoting.
    const skill = cortex.engines.skills.create({ name: '契约低成功率技能', steps: ['a'], state: 'active' });
    cortex.engines.skills.record(skill.id, false);
    cortex.engines.skills.record(skill.id, false);
    cortex.engines.skills.record(skill.id, false);
    text = await call(tools.cortex_evolve, { action: 'optimize' });
    assert.match(text, /skill v\d+：/);
    assert.match(text, /建议降级/);
    assert.equal(cortex.policies.list({ status: 'candidate' }).length, 1);

    // propose two retrieval policies, activate both, then roll the first one back in.
    text = await call(tools.cortex_evolve, {
      action: 'propose',
      kind: 'retrieval',
      config: { budget: 800, confidenceWeight: 0.2 },
      rationale: '工具契约第一版',
    });
    assert.match(text, /^已提案 retrieval v1（pol_/);
    const firstPolicy = idOf(text, 'pol');
    text = await call(tools.cortex_evolve, {
      action: 'propose',
      kind: 'retrieval',
      config: { budget: 600, confidenceWeight: 0.3 },
      rationale: '工具契约第二版',
    });
    assert.match(text, /^已提案 retrieval v2（pol_/);
    const secondPolicy = idOf(text, 'pol');

    text = await call(tools.cortex_evolve, { action: 'approve', id: firstPolicy });
    assert.equal(text, '已激活 retrieval v1。');
    assert.equal(cortex.policies.active('retrieval').id, firstPolicy);
    text = await call(tools.cortex_evolve, { action: 'approve', id: secondPolicy });
    assert.equal(text, '已激活 retrieval v2。');
    assert.equal(cortex.policies.active('retrieval').id, secondPolicy);

    text = await call(tools.cortex_evolve, { action: 'rollback', kind: 'retrieval', id: firstPolicy });
    assert.equal(text, '已回滚 retrieval 到 v1。');
    assert.equal(cortex.policies.active('retrieval').id, firstPolicy);

    text = await call(tools.cortex_evolve, { action: 'status' });
    assert.match(text, /retrieval v1/);
    assert.match(text, /身份：v1/);

    // Approval is a gate: unknown ids and incomplete proposals throw clearly.
    await assert.rejects(() => tools.cortex_evolve.execute({ action: 'approve', id: 'pol_missing' }), /policy not found/);
    await assert.rejects(() => tools.cortex_evolve.execute({ action: 'propose' }), /policy kind is required/);
    await assert.rejects(() => tools.cortex_evolve.execute({ action: 'rollback', kind: 'none-kind' }), /no policy to roll back/);
  } finally {
    harness.close();
  }
});

test('cortex_emotion: detect, record, affect, events and lexicon', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    let text = await call(tools.cortex_emotion, { action: 'lexicon' });
    assert.match(text, /^情绪词库：24 类 \/ \d+ 词/);
    const total = Number(text.match(/情绪词库：24 类 \/ (\d+) 词/)?.[1]);
    assert.ok(total > 100, `expected a useful vocabulary, got ${total}`);
    assert.match(text, /喜:\d+/);

    text = await call(tools.cortex_emotion, { action: 'detect', text: '本鲸很开心，也有点难过。' });
    assert.match(text, /喜:1/);
    assert.match(text, /哀:1/);
    assert.equal(await call(tools.cortex_emotion, { action: 'detect', text: '今天只是普通的一天。' }), '没有命中情绪词。');
    assert.equal(await call(tools.cortex_emotion, { action: 'detect' }), '没有命中情绪词。');

    assert.equal(await call(tools.cortex_emotion, { action: 'affect' }), '（情感库还没有形成态度）');
    assert.equal(await call(tools.cortex_emotion, { action: 'events' }), '（没有情绪事件）');

    text = await call(tools.cortex_emotion, { action: 'record', text: '本鲸很开心，也很喜欢主人。', target: '主人' });
    assert.match(text, /^已记情绪事件 emo_/);
    assert.match(text, /喜、爱 → 主人/);
    text = await call(tools.cortex_emotion, { action: 'record', text: '本鲸有点难过。', target: '主人' });
    assert.match(text, /^已记情绪事件 emo_/);

    text = await call(tools.cortex_emotion, { action: 'affect' });
    assert.equal(text, '主人：又喜又爱（2 次）');
    text = await call(tools.cortex_emotion, { action: 'events', limit: 1 });
    assert.equal(text.split('\n').length, 1);
    assert.match(text, /主人/);
    assert.match(text, /本鲸/);
    text = await call(tools.cortex_emotion, { action: 'events', limit: 10 });
    assert.match(text, /本鲸很开心/);
    assert.match(text, /本鲸有点难过/);

    const eventCount = cortex.emotion.events({ limit: 10 }).length;
    assert.equal(eventCount, 2);
    text = await call(tools.cortex_emotion, { action: 'record', text: '今天只是普通的一天。', target: '主人' });
    assert.equal(text, '没有命中情绪词。');
    assert.equal(cortex.emotion.events({ limit: 10 }).length, eventCount);
  } finally {
    harness.close();
  }
});

test('cortex_life: diary entries, dreams, sleep and sleep-run history', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    assert.equal(await call(tools.cortex_life, { action: 'diary-list' }), '（还没有日记）');
    assert.equal(await call(tools.cortex_life, { action: 'diary-forget', id: 'dly_missing' }), '没有这条日记：dly_missing');
    assert.equal(await call(tools.cortex_life, { action: 'sleep-runs' }), '（还没有睡眠记录）');

    let text = await call(tools.cortex_life, { action: 'diary-write', text: '第一条日记：今天写工具契约测试。', mood: '专注' });
    assert.match(text, /^日记已写：dly_/);
    const firstDiary = idOf(text, 'dly');
    text = await call(tools.cortex_life, { action: 'diary-write', text: '第二条日记：晚一点再看海。', mood: '放松' });
    const secondDiary = idOf(text, 'dly');

    text = await call(tools.cortex_life, { action: 'diary-list', limit: 1 });
    assert.equal(text.split('\n').length, 1);
    text = await call(tools.cortex_life, { action: 'diary-list' });
    assert.match(text, /第一条日记/);
    assert.match(text, /第二条日记/);
    assert.match(text, /专注/);

    text = await call(tools.cortex_life, { action: 'diary-forget', id: firstDiary });
    assert.equal(text, `已删日记 ${firstDiary}`);
    text = await call(tools.cortex_life, { action: 'diary-list' });
    assert.doesNotMatch(text, /第一条日记/);
    assert.match(text, /第二条日记/);
    assert.equal(await call(tools.cortex_life, { action: 'diary-forget', id: firstDiary }), `没有这条日记：${firstDiary}`);
    assert.equal(await call(tools.cortex_life, { action: 'diary-forget', id: secondDiary }), `已删日记 ${secondDiary}`);
    await assert.rejects(() => tools.cortex_life.execute({ action: 'diary-write' }), /diary text is required/);

    // Dream without source memories uses the template and records it.
    text = await call(tools.cortex_life, { action: 'dream' });
    assert.match(text, /^梦 drm_.*（来源 0 条，template）：/);
    const emptyDreams = cortex.life.dreamList({ limit: 10 });
    assert.equal(emptyDreams.length, 1);
    assert.equal(emptyDreams[0].sourceCount, 0);

    await call(tools.cortex_write, { text: '生活侧记忆第一条：主人喜欢白饭。', explicit: true });
    await call(tools.cortex_write, { text: '生活侧记忆第二条：本鲸会等主人。', explicit: true });
    text = await call(tools.cortex_life, { action: 'dream' });
    assert.match(text, /^梦 drm_.*（来源 2 条，template）：/);
    assert.equal(cortex.life.dreamList({ limit: 10 }).length, 2);

    // Sleep purges expired working memory, reflects and stores a run report.
    cortex.working.add({ text: '睡眠前已经过期的焦点。', ttlMs: 1_000, at: Date.now() - 5_000 });
    text = await call(tools.cortex_life, { action: 'sleep', windowDays: 1 });
    assert.match(text, /^睡眠整理完成：清理工作记忆 1 条 · 反思 1 · 阶段 (infancy|childhood|adolescence|adulthood) · 情感对象 \d+/);
    let runs = cortex.life.sleepRuns({ limit: 10 });
    assert.equal(runs.length, 1);
    assert.ok(runs[0].id.startsWith('slp_'));
    assert.equal(runs[0].report.purgedWorking, 1);

    text = await call(tools.cortex_life, { action: 'sleep-runs', limit: 1 });
    assert.match(text, /purgedWorking/);
    assert.match(text, /slp_|"reflected"/);

    text = await call(tools.cortex_life, { action: 'sleep', windowDays: 1 });
    assert.match(text, /^睡眠整理完成：/);
    runs = cortex.life.sleepRuns({ limit: 10 });
    assert.equal(runs.length, 2);
    text = await call(tools.cortex_life, { action: 'sleep-runs', limit: 1 });
    assert.equal(text.split('\n').length, 1);
  } finally {
    harness.close();
  }
});

test('cortex_compress: evaluate, compress an old covered trace and revive it', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    const old = cortex.write({
      text: '压缩契约：一段旧的白饭记忆。',
      title: '旧记忆',
      explicit: true,
      importance: 0.05,
      now: Date.now() - 60 * 86_400_000,
    });
    assert.equal(old.skipped, false);
    cortex.repos.summaries.insert({
      scopeId: 'global',
      level: 'episode',
      content: '覆盖旧记忆的摘要',
      sourceIds: [old.trace.id],
      coverage: 1,
    });

    let text = await call(tools.cortex_compress, { action: 'evaluate' });
    assert.match(text, /可压缩 1 条 \/ 活跃 1 条/);
    assert.match(text, new RegExp(old.trace.id));
    assert.match(text, /coverage 1\.00/);

    text = await call(tools.cortex_compress, { action: 'compress', limit: 1 });
    assert.match(text, /^压缩归档 1 条/);
    assert.match(text, new RegExp(old.trace.id));
    assert.match(text, /coverage 1\.00/);
    const archivedTrace = cortex.get(old.trace.id);
    assert.equal(archivedTrace.state, 'archived');
    assert.equal(archivedTrace.compression, 'archived');

    text = await call(tools.cortex_compress, { action: 'evaluate' });
    assert.match(text, /可压缩 0 条 \/ 活跃 0 条/);

    text = await call(tools.cortex_compress, { action: 'revive', id: old.trace.id });
    assert.equal(text, `已复活 ${old.trace.id}（下一次检索可命中）`);
    const revived = cortex.get(old.trace.id);
    assert.equal(revived.state, 'active');
    assert.equal(revived.compression, 'raw');
    assert.ok(revived.stability >= 3);

    // Revive resets age via lastAccessAt, so the trace is no longer eligible.
    text = await call(tools.cortex_compress, { action: 'evaluate' });
    assert.match(text, /可压缩 0 条 \/ 活跃 1 条/);
    assert.equal(await call(tools.cortex_compress, { action: 'revive', id: 'trc_missing' }), '没有这条记忆：trc_missing');
  } finally {
    harness.close();
  }
});

test('cortex_working: add, list, pin, remove and purge expired entries', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    assert.equal(await call(tools.cortex_working, { action: 'list' }), '（工作记忆为空）');

    let text = await call(tools.cortex_working, { action: 'add', text: '写工具契约测试。' });
    assert.match(text, /^已加入工作记忆 wrk_/);
    const first = idOf(text, 'wrk');
    text = await call(tools.cortex_working, {
      action: 'add',
      text: '置顶焦点：别忘白饭。',
      kind: 'focus',
      priority: 0.9,
      pinned: true,
      ttlMs: 60_000,
    });
    const second = idOf(text, 'wrk');

    text = await call(tools.cortex_working, { action: 'list' });
    assert.match(text, new RegExp(`\\[pin\\] ${second}`));
    assert.match(text, new RegExp(`- ${first} \\(0\\.5\\)`));
    assert.match(text, /别忘白饭/);

    text = await call(tools.cortex_working, { action: 'pin', id: first, pinned: true });
    assert.equal(text, `已置顶 ${first}`);
    text = await call(tools.cortex_working, { action: 'pin', id: first, pinned: false });
    assert.equal(text, `已取消置顶 ${first}`);
    assert.equal(await call(tools.cortex_working, { action: 'pin', id: 'wrk_missing' }), '没有 wrk_missing');
    assert.equal(await call(tools.cortex_working, { action: 'remove', id: 'wrk_missing' }), '没有 wrk_missing');

    text = await call(tools.cortex_working, { action: 'remove', id: first });
    assert.equal(text, `已删除 ${first}`);
    assert.equal(await call(tools.cortex_working, { action: 'remove', id: first }), `没有 ${first}`);
    text = await call(tools.cortex_working, { action: 'list' });
    assert.doesNotMatch(text, new RegExp(first));

    await call(tools.cortex_working, { action: 'add', text: '马上过期的工作记忆。', ttlMs: 1 });
    await wait(30);
    text = await call(tools.cortex_working, { action: 'purge' });
    assert.equal(text, '已清理 1 条过期工作记忆');
    text = await call(tools.cortex_working, { action: 'list' });
    assert.doesNotMatch(text, /马上过期/);
    assert.match(text, new RegExp(second));

    await assert.rejects(() => tools.cortex_working.execute({ action: 'add' }), /working item text is required/);
    await assert.rejects(() => tools.cortex_working.execute({ action: 'add', text: '   ' }), /working item text is required/);
    assert.equal(cortex.working.list({ scopeId: 'global' }).length, 1);
  } finally {
    harness.close();
  }
});

test('cortex_goal: add, list, update and complete with status filtering', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    assert.equal(await call(tools.cortex_goal, { action: 'list' }), '（没有目标）');

    let text = await call(tools.cortex_goal, { action: 'add', title: '完成工具契约测试' });
    assert.match(text, /^目标已建 gol_/);
    const first = idOf(text, 'gol');
    text = await call(tools.cortex_goal, {
      action: 'add',
      title: '第二个目标',
      description: '低优先级目标',
      priority: 0.2,
    });
    const second = idOf(text, 'gol');

    text = await call(tools.cortex_goal, { action: 'list' });
    assert.match(text, new RegExp(`- \\[active\\] ${first} 完成工具契约测试 0%`));
    assert.match(text, new RegExp(`- \\[active\\] ${second} 第二个目标 0%`));

    text = await call(tools.cortex_goal, {
      action: 'update',
      id: first,
      description: '覆盖 18 个工具',
      priority: 0.9,
      progress: 0.4,
    });
    assert.equal(text, `已更新 ${first}：active 40%`);
    const updated = cortex.goals.get(first);
    assert.equal(updated.progress, 0.4);
    assert.equal(updated.priority, 0.9);
    assert.equal(updated.description, '覆盖 18 个工具');
    assert.equal(await call(tools.cortex_goal, { action: 'update', id: 'gol_missing', progress: 0.5 }), '没有 gol_missing');

    text = await call(tools.cortex_goal, { action: 'list', status: 'completed' });
    assert.equal(text, '（没有目标）');

    text = await call(tools.cortex_goal, { action: 'complete', id: first });
    assert.equal(text, '目标已完成：完成工具契约测试');
    const completed = cortex.goals.get(first);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.progress, 1);
    text = await call(tools.cortex_goal, { action: 'list', status: 'completed' });
    assert.match(text, new RegExp(`- \\[completed\\] ${first} 完成工具契约测试 100%`));
    assert.doesNotMatch(text, new RegExp(second));
    text = await call(tools.cortex_goal, { action: 'list', status: 'active' });
    assert.match(text, new RegExp(second));
    assert.doesNotMatch(text, new RegExp(first));

    // Unknown ids must be reported, not echoed as a fake success.
    text = await call(tools.cortex_goal, { action: 'complete', id: 'gol_missing' });
    assert.equal(text, '没有这个目标：gol_missing');
    assert.equal(cortex.goals.get('gol_missing'), null);

    await assert.rejects(() => tools.cortex_goal.execute({ action: 'add' }), /goal title is required/);
  } finally {
    harness.close();
  }
});

test('cortex_digest: daily digest on empty and populated days, persisted as a summary', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  const date = new Date().toISOString().slice(0, 10);
  try {
    // Default date and explicit empty date both work and persist nothing.
    let text = await call(tools.cortex_digest, { action: 'daily' });
    assert.match(text, /^# \d{4}-\d{2}-\d{2} 记忆摘要/);
    assert.match(text, /新记忆：0 条/);
    text = await call(tools.cortex_digest, { action: 'daily', date: '2000-01-01' });
    assert.match(text, /^# 2000-01-01 记忆摘要/);
    assert.match(text, /新记忆：0 条/);
    assert.equal(cortex.repos.summaries.list('global', { level: 'digest' }).length, 0);

    const first = await call(tools.cortex_write, { text: '摘要契约：今天修好了工具。', explicit: true });
    const second = await call(tools.cortex_write, { text: '摘要契约：今天写了测试。', explicit: true });
    await call(tools.cortex_feedback, { id: idOf(first, 'trc'), signal: 'used', predicted: 0.7 });
    await call(tools.cortex_emotion, { action: 'record', text: '本鲸很开心。', target: '主人' });
    await call(tools.cortex_goal, { action: 'add', title: '完成摘要测试' });

    text = await call(tools.cortex_digest, { action: 'daily', date });
    assert.match(text, /^# \d{4}-\d{2}-\d{2} 记忆摘要/);
    assert.match(text, /新记忆：2 条（utterance 2）/);
    assert.match(text, /情绪事件：1 条/);
    assert.match(text, /进行中的目标：1 条/);
    assert.match(text, /## 重要记忆/);
    assert.match(text, /摘要契约/);
    assert.match(text, /## 情绪/);
    assert.match(text, /喜：本鲸很开心/);

    assert.match(text, /反馈：1 条/);
    const feedbackRows = cortex.repos.feedback.list({ scopeId: 'global', limit: 500 });
    assert.equal(feedbackRows.length, 1);
    assert.equal(feedbackRows[0].at.slice(0, 10), date);

    const digests = cortex.repos.summaries.list('global', { level: 'digest' });
    assert.equal(digests.length, 1);
    assert.equal(digests[0].level, 'digest');
    assert.equal(digests[0].sourceIds.length, 2);
    assert.ok(digests[0].sourceIds.includes(idOf(first, 'trc')));
    assert.ok(digests[0].sourceIds.includes(idOf(second, 'trc')));

    // A different day still reports zero and does not overwrite the real digest.
    text = await call(tools.cortex_digest, { action: 'daily', date: '2000-01-01' });
    assert.match(text, /^# 2000-01-01 记忆摘要/);
    assert.match(text, /新记忆：0 条/);
    assert.equal(cortex.repos.summaries.list('global', { level: 'digest' }).length, 1);
  } finally {
    harness.close();
  }
});

test('cortex_tick: status, safe execution and proposals that need approval', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    let text = await call(tools.cortex_tick, { action: 'status' });
    assert.match(text, /^自主意图：0 条/);
    text = await call(tools.cortex_tick, { action: 'run' });
    assert.equal(text, '执行 0 条，提案 0 条。');

    await call(tools.cortex_write, { text: 'tick 契约第一条：主人喜欢白饭。', explicit: true });
    await call(tools.cortex_write, { text: 'tick 契约第二条：本鲸会等主人。', explicit: true });

    const now = Date.now();
    const schedule = {
      createdAt: new Date(now).toISOString(),
      dueAt: new Date(now + 60_000).toISOString(),
      expiresAt: new Date(now + 3_600_000).toISOString(),
    };
    const recall = cortex.stores.initiativeStore.insert({
      kind: 'recall',
      priority: 0.9,
      reason: '想再确认白饭',
      payload: { topic: '白饭' },
      ...schedule,
    }, { scopeId: 'global' });
    const propose = cortex.stores.initiativeStore.insert({
      kind: 'propose',
      priority: 0.8,
      reason: '想把这段记忆写成提案',
      payload: { topic: 'identity' },
      ...schedule,
    }, { scopeId: 'global' });
    const consolidate = cortex.stores.initiativeStore.insert({
      kind: 'consolidate',
      priority: 0.7,
      reason: '整理白饭记忆',
      payload: { reason: 'coherence' },
      ...schedule,
    }, { scopeId: 'global' });

    text = await call(tools.cortex_tick, { action: 'status' });
    assert.match(text, /^自主意图：3 条/);
    assert.match(text, /recall:1/);
    assert.match(text, /propose:1/);
    assert.match(text, /consolidate:1/);

    text = await call(tools.cortex_tick, { action: 'run', max: 10 });
    assert.match(text, /^执行 2 条，提案 1 条。/);
    assert.match(text, /- propose：想把这段记忆写成提案（需要 approval）/);

    assert.equal(cortex.stores.initiativeStore.get(recall.id).status, 'acted');
    assert.equal(cortex.stores.initiativeStore.get(consolidate.id).status, 'acted');
    assert.equal(cortex.stores.initiativeStore.get(propose.id).status, 'pending');

    text = await call(tools.cortex_tick, { action: 'status' });
    assert.match(text, /^自主意图：1 条/);
    assert.match(text, /propose:1/);
  } finally {
    harness.close();
  }
});

test('unknown ids and malformed inputs surface sentinel text or clear errors', async () => {
  const harness = makeHarness();
  const { cortex, tools } = harness;
  try {
    const traceCount = cortex.repos.traces.count();
    const eventCount = cortex.repos.events.count();

    const cases = [
      [tools.cortex_get, { id: 'trc_missing' }, /^没有这条记忆：trc_missing$/],
      [tools.cortex_timeline, { aroundId: 'trc_missing' }, /^（没有找到锚点）$/],
      [tools.cortex_forget, { id: 'trc_missing', mode: 'archive' }, /^没有这条记忆：trc_missing$/],
      [tools.cortex_forget, { id: 'trc_missing', mode: 'delete' }, /^没有这条记忆：trc_missing$/],
      [tools.cortex_working, { action: 'pin', id: 'wrk_missing' }, /^没有 wrk_missing$/],
      [tools.cortex_working, { action: 'remove', id: 'wrk_missing' }, /^没有 wrk_missing$/],
      [tools.cortex_goal, { action: 'update', id: 'gol_missing' }, /^没有 gol_missing$/],
      [tools.cortex_compress, { action: 'revive', id: 'trc_missing' }, /^没有这条记忆：trc_missing$/],
      [tools.cortex_life, { action: 'diary-forget', id: 'dly_missing' }, /^没有这条日记：dly_missing$/],
      [tools.cortex_guard, { action: 'validate', file: path.join(harness.dir, 'missing.sqlite') }, /^备份无效：missing$/],
      [tools.cortex_emotion, { action: 'detect', text: '普通的一天。' }, /^没有命中情绪词。$/],
      [tools.cortex_write, { text: '   ' }, /^未写入：too-short/],
    ];
    for (const [tool, args, pattern] of cases) {
      const text = await call(tool, args);
      assert.match(text, pattern, `${tool.name} ${JSON.stringify(args)}`);
    }

    await assert.rejects(() => tools.cortex_feedback.execute({ id: 'trc_missing', signal: 'used' }), /trace not found/);
    await assert.rejects(() => tools.cortex_forget.execute({ id: 'trc_x', mode: 'shred' }), /unknown forget mode/);
    await assert.rejects(() => tools.cortex_forget.execute({ mode: 'archive' }), /traceId is required/);
    await assert.rejects(() => tools.cortex_working.execute({ action: 'add' }), /working item text is required/);
    await assert.rejects(() => tools.cortex_goal.execute({ action: 'add' }), /goal title is required/);
    await assert.rejects(() => tools.cortex_life.execute({ action: 'diary-write' }), /diary text is required/);
    await assert.rejects(() => tools.cortex_evolve.execute({ action: 'propose' }), /policy kind is required/);
    await assert.rejects(() => tools.cortex_evolve.execute({ action: 'approve', id: 'pol_missing' }), /policy not found/);
    await assert.rejects(() => tools.cortex_evolve.execute({ action: 'rollback', kind: 'none-kind' }), /no policy to roll back/);

    assert.equal(cortex.repos.traces.count(), traceCount, 'invalid inputs must not create traces');
    assert.equal(cortex.repos.events.count(), eventCount, 'invalid inputs must not append events');
    assert.equal(cortex.working.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.goals.list({ scopeId: 'global' }).length, 0);
  } finally {
    harness.close();
  }
});
