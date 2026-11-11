/**
 * Adversarial integration coverage for cross-cutting edges the happy-path
 * suite does not exercise: scopes across every entry point, guardian failure
 * modes, API input boundaries and per-scope self state.
 *
 * Everything here uses a real cortex on a throwaway database; nothing is mocked
 * except the one collaborator under test (retrieval / vector), and every patch
 * is restored in a finally block.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { API_BASE, createApiHandler } from '../../src/api/routes.js';
import {
  BASE_MS,
  DAY_MS,
  apiResponse,
  cleanup,
  invokeApi,
  makeCortex,
} from './_helpers.js';

function idsOf(result) {
  return result.items.map((item) => item.id).sort();
}

function scopesOf(result, cortex) {
  return result.items.map((item) => cortex.get(item.id).scopeId);
}

function sourceOf(result, source) {
  return result.trace.sources.find((entry) => entry.source === source);
}

/** Request stream for bodies that cannot be expressed through JSON.stringify. */
function rawRequest({ method = 'POST', route = '/write', raw = '', headers = {} } = {}) {
  const stream = Readable.from([Buffer.from(raw, 'utf8')]);
  stream.method = method;
  stream.url = `${API_BASE}${route}`;
  const merged = {
    host: '127.0.0.1:7430',
    origin: 'http://127.0.0.1:7430',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'x-cortex': '1',
    ...headers,
  };
  for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
  stream.headers = merged;
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

async function invokeRaw(handler, options = {}) {
  const response = apiResponse();
  await handler(rawRequest(options), response);
  return {
    status: response.statusCode,
    headers: response.headers,
    json: response.body ? JSON.parse(response.body) : {},
  };
}

// ---------------------------------------------------------------------------
// 1. Scope isolation across write / search / working / goals
// ---------------------------------------------------------------------------

test('scope isolation keeps writes, search, working memory and goals inside their scope', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const shared = '主人喜欢白饭，这是同一条跨 scope 文本。';
    const globalWrite = cortex.write({ text: shared, title: 'global copy', explicit: true, scopeId: 'global', now: BASE_MS });
    const s2Write = cortex.write({ text: shared, title: 's2 copy', explicit: true, scopeId: 's2', now: BASE_MS + 1_000 });
    const s2Extra = cortex.write({ text: '只有 s2 能看到的技术记录。', title: 's2 tech', explicit: true, scopeId: 's2', now: BASE_MS + 2_000 });
    const s2Duplicate = cortex.write({ text: shared, title: 's2 duplicate', explicit: true, scopeId: 's2', now: BASE_MS + 3_000 });

    assert.equal(globalWrite.skipped, false);
    assert.equal(s2Write.skipped, false);
    assert.equal(s2Extra.skipped, false);
    // Content dedupe is per scope: the same text exists twice, but only once per scope.
    assert.equal(s2Duplicate.skipped, true);
    assert.equal(s2Duplicate.reason, 'duplicate');
    assert.equal(s2Duplicate.trace.id, s2Write.trace.id);
    assert.notEqual(globalWrite.trace.id, s2Write.trace.id);
    assert.equal(globalWrite.trace.scopeId, 'global');
    assert.equal(s2Write.trace.scopeId, 's2');
    assert.equal(cortex.repos.traces.count({ scopeId: 'global' }), 1);
    assert.equal(cortex.repos.traces.count({ scopeId: 's2' }), 2);
    assert.equal(cortex.repos.traces.count(), 3);
    // The duplicate attempt is still recorded in the scoped event ledger.
    assert.equal(cortex.repos.events.count('global'), 1);
    assert.equal(cortex.repos.events.count('s2'), 3);
    assert.equal(cortex.repos.events.count(), 4);

    const globalHits = cortex.search('白饭', { scopeId: 'global', now: BASE_MS + 4_000, limit: 10 });
    const s2Hits = cortex.search('白饭', { scopeId: 's2', now: BASE_MS + 4_000, limit: 10 });
    const defaultHits = cortex.search('白饭', { now: BASE_MS + 4_000, limit: 10 });
    assert.equal(globalHits.scopeId, 'global');
    assert.equal(s2Hits.scopeId, 's2');
    // Retrieval merges a scoped recency source, so assert scope membership
    // rather than exact lexical hits.
    assert.equal(scopesOf(globalHits, cortex).every((scopeId) => scopeId === 'global'), true);
    assert.equal(scopesOf(s2Hits, cortex).every((scopeId) => scopeId === 's2'), true);
    assert.equal(scopesOf(defaultHits, cortex).every((scopeId) => scopeId === 'global'), true);
    assert.ok(globalHits.items.some((item) => item.id === globalWrite.trace.id));
    assert.ok(s2Hits.items.some((item) => item.id === s2Write.trace.id));
    assert.equal(globalHits.items.some((item) => item.id === s2Write.trace.id), false);
    assert.equal(s2Hits.items.some((item) => item.id === globalWrite.trace.id), false);
    const globalTechnical = cortex.search('技术记录', { scopeId: 'global', now: BASE_MS + 4_000 });
    const s2Technical = cortex.search('技术记录', { scopeId: 's2', now: BASE_MS + 4_000 });
    assert.equal(globalTechnical.items.some((item) => item.id === s2Extra.trace.id), false);
    assert.ok(s2Technical.items.some((item) => item.id === s2Extra.trace.id));
    assert.equal(s2Technical.items.some((item) => item.id === globalWrite.trace.id), false);
    assert.equal(scopesOf(globalTechnical, cortex).every((scopeId) => scopeId === 'global'), true);
    assert.equal(scopesOf(s2Technical, cortex).every((scopeId) => scopeId === 's2'), true);

    const globalFocus = cortex.working.add({ scopeId: 'global', text: '全局焦点：写测试。', priority: 0.9, at: BASE_MS });
    const s2Focus = cortex.working.add({ scopeId: 's2', text: 's2 焦点：整理记录。', priority: 0.9, at: BASE_MS });
    assert.deepEqual(cortex.working.list({ scopeId: 'global' }).map((item) => item.id), [globalFocus.id]);
    assert.deepEqual(cortex.working.list({ scopeId: 's2' }).map((item) => item.id), [s2Focus.id]);
    assert.equal(cortex.working.get(globalFocus.id).scopeId, 'global');
    assert.equal(cortex.working.get(s2Focus.id).scopeId, 's2');

    const globalGoal = cortex.goals.add({ scopeId: 'global', title: '完成全局测试', priority: 0.8 });
    const s2Goal = cortex.goals.add({ scopeId: 's2', title: '完成 s2 测试', priority: 0.7 });
    assert.deepEqual(cortex.goals.list({ scopeId: 'global' }).map((goal) => goal.id), [globalGoal.id]);
    assert.deepEqual(cortex.goals.list({ scopeId: 's2' }).map((goal) => goal.id), [s2Goal.id]);
    cortex.goals.update(s2Goal.id, { progress: 0.5 });
    assert.equal(cortex.goals.get(globalGoal.id).progress, 0);
    assert.equal(cortex.goals.get(s2Goal.id).progress, 0.5);

    const globalSelf = cortex.self();
    const s2Self = cortex.self('s2');
    assert.equal(globalSelf.self.scopeId, 'global');
    assert.equal(s2Self.self.scopeId, 's2');
    assert.deepEqual(globalSelf.working.map((item) => item.id), [globalFocus.id]);
    assert.deepEqual(s2Self.working.map((item) => item.id), [s2Focus.id]);
    assert.deepEqual(globalSelf.goals.map((goal) => goal.id), [globalGoal.id]);
    assert.deepEqual(s2Self.goals.map((goal) => goal.id), [s2Goal.id]);

    cortex.goals.complete(s2Goal.id);
    assert.equal(cortex.goals.list({ scopeId: 'global', status: 'active' }).length, 1);
    assert.equal(cortex.goals.list({ scopeId: 's2', status: 'active' }).length, 0);
    assert.equal(cortex.goals.get(s2Goal.id).status, 'completed');
    assert.equal(cortex.goals.get(globalGoal.id).status, 'active');

    assert.equal(cortex.working.remove(s2Focus.id), true);
    assert.equal(cortex.working.list({ scopeId: 'global' }).length, 1);
    assert.equal(cortex.working.list({ scopeId: 's2' }).length, 0);

    const guard = cortex.guardian.check();
    assert.equal(guard.ok, true);
    assert.deepEqual(guard.issues, []);
    assert.equal(guard.chain.count, 4);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 2. Invalid scopes from every API channel fall back to global
// ---------------------------------------------------------------------------

test('invalid scope values from header, query and body fall back to global', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const postWrite = (route, text, headers = {}, extra = {}) => invokeApi(handler, {
      method: 'POST',
      route,
      body: { text, explicit: true, ...extra },
      headers: { 'x-cortex': '1', ...headers },
    });
    const write = (text, headers = {}, extra = {}) => postWrite('/write', text, headers, extra);
    const traceScope = (result) => {
      assert.equal(result.status, 200, JSON.stringify(result.json));
      return result.json.data.trace.scopeId;
    };
    const longScope = 'x'.repeat(121);
    const allowedScope = 'team.a_1:x-2';

    assert.equal(traceScope(await write('team-a fallback scope edge', { 'x-cortex-scope': 'team-a' })), 'team-a');
    assert.equal(traceScope(await write('bad-header fallback scope edge', { 'x-cortex-scope': 'bad scope!' })), 'global');
    assert.equal(traceScope(await write('blank-header fallback scope edge', { 'x-cortex-scope': '   ' })), 'global');
    assert.equal(traceScope(await write('long-header fallback scope edge', { 'x-cortex-scope': longScope })), 'global');
    assert.equal(traceScope(await write('traversal-header fallback scope edge', { 'x-cortex-scope': '../etc' })), 'global');
    assert.equal(traceScope(await write('body-good fallback scope edge', {}, { scopeId: 'body-scope' })), 'body-scope');
    assert.equal(traceScope(await write('body-bad fallback scope edge', {}, { scopeId: 'bad/scope' })), 'global');
    assert.equal(
      traceScope(await postWrite('/write?scope=query-scope', 'header precedence fallback scope edge', { 'x-cortex-scope': 'header-scope' }, { scopeId: 'body-scope' })),
      'header-scope',
    );
    assert.equal(
      traceScope(await postWrite('/write?scope=query-scope', 'query precedence fallback scope edge', {}, { scopeId: 'body-scope' })),
      'query-scope',
    );
    assert.equal(
      traceScope(await postWrite('/write?scope=query-scope', 'invalid-header-with-query fallback scope edge', { 'x-cortex-scope': 'bad scope!' }, { scopeId: 'body-scope' })),
      'global',
    );
    assert.equal(traceScope(await write('allowed-chars fallback scope edge', { 'x-cortex-scope': allowedScope })), allowedScope);

    const scopes = cortex.db.prepare('SELECT DISTINCT scope_id FROM traces ORDER BY scope_id').all().map((row) => row.scope_id);
    assert.deepEqual(scopes, ['body-scope', 'global', 'header-scope', 'query-scope', 'team-a', allowedScope]);
    assert.equal(scopes.every((scope) => /^[A-Za-z0-9._:-]+$/.test(scope)), true);
    assert.equal(cortex.repos.traces.count({ scopeId: 'global' }), 6);
    assert.equal(cortex.repos.traces.count({ scopeId: 'team-a' }), 1);
    assert.equal(cortex.repos.traces.count({ scopeId: 'body-scope' }), 1);
    assert.equal(cortex.repos.traces.count({ scopeId: 'header-scope' }), 1);
    assert.equal(cortex.repos.traces.count({ scopeId: 'query-scope' }), 1);
    assert.equal(cortex.repos.traces.count({ scopeId: allowedScope }), 1);

    const globalSearch = await invokeApi(handler, { route: '/search?q=fallback&limit=20' });
    assert.equal(globalSearch.status, 200);
    assert.equal(globalSearch.json.data.scopeId, 'global');
    assert.equal(globalSearch.json.data.items.length, 6);
    const invalidSearchScope = await invokeApi(handler, { route: '/search?q=fallback&limit=20&scope=bad%20scope' });
    assert.equal(invalidSearchScope.status, 200);
    assert.equal(invalidSearchScope.json.data.scopeId, 'global');
    assert.equal(invalidSearchScope.json.data.items.length, 6);
    const bodySearchScope = await invokeApi(handler, {
      method: 'POST',
      route: '/search',
      body: { query: 'fallback', limit: 20, scopeId: 'bad/scope' },
      headers: { 'x-cortex': '1' },
    });
    assert.equal(bodySearchScope.status, 200);
    assert.equal(bodySearchScope.json.data.scopeId, 'global');
    assert.equal(bodySearchScope.json.data.items.length, 6);

    const invalidWorking = await invokeApi(handler, {
      method: 'POST',
      route: '/working/add',
      body: { text: 'fallback working item' },
      headers: { 'x-cortex': '1', 'x-cortex-scope': 'bad scope!' },
    });
    assert.equal(invalidWorking.status, 200);
    assert.equal(invalidWorking.json.data.scopeId, 'global');
    const globalWorking = await invokeApi(handler, { route: '/working' });
    assert.equal(globalWorking.json.data.length, 1);
    const teamWorking = await invokeApi(handler, { route: '/working?scope=team-a' });
    assert.equal(teamWorking.json.data.length, 0);

    const invalidGoal = await invokeApi(handler, {
      method: 'POST',
      route: '/goals/add',
      body: { title: 'fallback goal' },
      headers: { 'x-cortex': '1', 'x-cortex-scope': 'bad scope!' },
    });
    assert.equal(invalidGoal.status, 200);
    assert.equal(invalidGoal.json.data.scopeId, 'global');
    const globalGoals = await invokeApi(handler, { route: '/goals' });
    assert.equal(globalGoals.json.data.length, 1);
    const teamGoals = await invokeApi(handler, { route: '/goals?scope=team-a' });
    assert.equal(teamGoals.json.data.length, 0);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 3. Budget guard blocks before retrieval and reports it explicitly
// ---------------------------------------------------------------------------

test('search over the per-hour call budget returns a blocked trace and does not touch retrieval', () => {
  const context = makeCortex({ maxCallsPerHour: 2 });
  const { cortex } = context;
  try {
    cortex.write({ text: '预算测试：这条记忆只用于搜索。', explicit: true, now: BASE_MS });
    const first = cortex.search('预算测试', { now: BASE_MS, limit: 5 });
    const second = cortex.search('预算测试', { now: BASE_MS + 1, limit: 5 });
    assert.ok(first.items.length >= 1);
    assert.ok(second.items.length >= 1);
    assert.equal(cortex.budget.snapshot().calls, 2);
    assert.equal(cortex.budget.snapshot().remainingCalls, 0);

    const original = cortex.engines.retrieve.search;
    let retrieveCalls = 0;
    try {
      cortex.engines.retrieve.search = () => {
        retrieveCalls += 1;
        throw new Error('retrieval must not run when the budget is exhausted');
      };
      const blocked = cortex.search('预算测试', { now: BASE_MS + 2, limit: 5 });
      assert.equal(retrieveCalls, 0);
      assert.equal(blocked.query, '预算测试');
      assert.equal(blocked.intent, 'fact');
      assert.equal(blocked.scopeId, 'global');
      assert.deepEqual(blocked.items, []);
      assert.deepEqual(blocked.budget, { used: 0, total: 0 });
      assert.equal(blocked.trace.blocked, 'budget');
      assert.equal(blocked.trace.elapsedMs, 0);
      assert.equal(blocked.trace.candidates, 0);
      assert.equal(blocked.trace.selected, 0);
      assert.equal(blocked.trace.dropped, 0);
      assert.deepEqual(blocked.trace.sources, []);
      assert.ok(Number.isFinite(Date.parse(blocked.at)));
      const again = cortex.search('预算测试', { now: BASE_MS + 3, limit: 5 });
      assert.equal(again.trace.blocked, 'budget');
      assert.equal(retrieveCalls, 0);
    } finally {
      cortex.engines.retrieve.search = original;
    }

    const metrics = cortex.metrics();
    assert.equal(metrics.counters['search.calls'], 2);
    assert.equal(metrics.counters['search.blocked.budget'], 2);
    assert.equal(metrics.counters['search.errors'], undefined);
    assert.equal(metrics.histograms['search.ms'].count, 2);
    assert.equal(cortex.budget.snapshot().calls, 2);
    // Search is guarded, writes are not: the service remains usable.
    const written = cortex.write({ text: '预算耗尽后仍然可以写入。', explicit: true, now: BASE_MS + 4 });
    assert.equal(written.skipped, false);
    assert.equal(cortex.repos.traces.count(), 2);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 4. Circuit breaker opens, blocks, then recovers after the cooldown
// ---------------------------------------------------------------------------

test('circuit breaker opens on repeated retrieval errors, blocks with a circuit trace and recovers', async () => {
  const context = makeCortex({ maxCallsPerHour: 100, circuitThreshold: 2, circuitCooldownMs: 120 });
  const { cortex } = context;
  try {
    cortex.write({ text: '熔断测试：这条记忆用于恢复。', explicit: true, now: BASE_MS });
    const original = cortex.engines.retrieve.search;
    let attempts = 0;
    try {
      cortex.engines.retrieve.search = () => {
        attempts += 1;
        throw new Error('retrieval exploded');
      };
      assert.throws(() => cortex.search('熔断测试', { now: BASE_MS }), /retrieval exploded/);
      assert.equal(cortex.circuit.snapshot().state, 'closed');
      assert.throws(() => cortex.search('熔断测试', { now: BASE_MS + 1 }), /retrieval exploded/);
      const opened = cortex.circuit.snapshot();
      assert.equal(opened.state, 'open');
      assert.equal(opened.failures, 2);
      assert.ok(opened.remainingMs > 0);

      const blocked = cortex.search('熔断测试', { now: BASE_MS + 2, limit: 5 });
      assert.equal(attempts, 2, 'blocked search must not call retrieval again');
      assert.equal(blocked.items.length, 0);
      assert.equal(blocked.trace.blocked, 'circuit');
      assert.equal(blocked.trace.elapsedMs, 0);
      assert.equal(blocked.trace.candidates, 0);
      assert.deepEqual(blocked.trace.sources, []);
      assert.deepEqual(blocked.budget, { used: 0, total: 0 });
      // Failed searches never spend budget, and blocked calls do not either.
      assert.equal(cortex.budget.snapshot().calls, 0);
    } finally {
      cortex.engines.retrieve.search = original;
    }

    const metrics = cortex.metrics();
    assert.equal(metrics.counters['search.errors'], 2);
    assert.equal(metrics.counters['search.blocked.circuit'], 1);
    assert.equal(metrics.counters['search.calls'], undefined);

    await delay(200); // > circuitCooldownMs
    const recovered = cortex.search('熔断测试', { now: BASE_MS + 3, limit: 5 });
    assert.ok(recovered.items.length >= 1);
    assert.equal('blocked' in recovered.trace, false);
    assert.equal(cortex.circuit.snapshot().state, 'closed');
    assert.equal(cortex.circuit.snapshot().failures, 0);
    assert.equal(cortex.budget.snapshot().calls, 1);
    assert.equal(cortex.metrics().counters['search.calls'], 1);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 5. Privacy deleteScope empties every derived store but keeps the ledger
// ---------------------------------------------------------------------------

test('privacy.deleteScope wipes diary, dreams, sleep, emotion, feedback and facts while preserving events', async () => {
  const context = makeCortex({ features: { vector: true } });
  const { cortex } = context;
  try {
    const first = cortex.write({
      text: '主人答应买白饭，这是隐私删除测试。',
      title: '白饭承诺',
      explicit: true,
      now: BASE_MS,
      facts: [{ subject: '主人', predicate: '答应', objectLiteral: '买白饭', confidence: 0.9 }],
    });
    const second = cortex.write({
      text: '主人想给本鲸一个实体。',
      title: '实体',
      explicit: true,
      now: BASE_MS + 1_000,
      facts: [{ subject: '主人', predicate: '想给', object: '本鲸', confidence: 0.8 }],
    });
    const otherScope = cortex.write({ text: '另一个 scope 必须活下来。', explicit: true, scopeId: 's2', now: BASE_MS + 2_000 });
    cortex.feedback({ traceId: first.trace.id, signal: 'used', predicted: 0.8, now: BASE_MS + 3_000 });
    cortex.working.add({ text: '隐私删除前的焦点。', priority: 0.9, at: BASE_MS });
    cortex.working.add({ text: '已过期的焦点。', at: BASE_MS, ttlMs: 1_000 });
    cortex.working.add({ text: 's2 焦点。', scopeId: 's2', at: BASE_MS });
    cortex.goals.add({ title: '完成隐私测试', priority: 0.8 });
    cortex.goals.add({ title: '另一个目标', priority: 0.4 });
    cortex.goals.add({ title: 's2 目标', scopeId: 's2' });
    cortex.emotion.record({ text: '本鲸有点心疼主人。', target: '主人', at: new Date(BASE_MS + 4_000).toISOString() });
    cortex.emotion.record({ text: '主人很开心，本鲸也喜欢。', target: '主人', at: new Date(BASE_MS + 5_000).toISOString() });
    cortex.life.diaryWrite({ text: '今天把隐私删除测了一遍。', mood: '踏实', at: new Date(BASE_MS + 6_000).toISOString() });
    await cortex.life.dreamGenerate({ at: BASE_MS + 3_600_000 });
    const sleep = await cortex.life.sleep({ at: BASE_MS + 7_200_000, windowDays: 1 });
    assert.ok(sleep.id);
    assert.equal(sleep.purgedWorking, 1);
    assert.equal(sleep.reflected, 1);

    const countTable = (table, scopeId = 'global') => Number(
      cortex.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE scope_id = ?`).get(scopeId).c,
    );
    const before = {
      traces: countTable('traces'),
      facts: countTable('facts'),
      entities: countTable('entities'),
      edges: countTable('edges'),
      summaries: countTable('summaries'),
      feedback: countTable('feedback'),
      appraisals: countTable('appraisals'),
      emotionEvents: countTable('emotion_events'),
      working: countTable('working_items'),
      goals: countTable('goals'),
      skills: countTable('skills'),
      identity: countTable('identity_versions'),
      relationships: countTable('relationships'),
      intentions: countTable('intentions'),
      growth: countTable('growth_metrics'),
      disputes: countTable('disputes'),
      jobs: countTable('jobs'),
      diary: countTable('diary_entries'),
      dreams: countTable('dreams'),
      sleeps: countTable('sleep_runs'),
    };
    assert.equal(before.traces, 3, 'two writes plus one reflection');
    assert.equal(before.facts, 2);
    assert.equal(before.entities, 2);
    assert.equal(before.summaries, 1);
    assert.equal(before.feedback, 1);
    assert.equal(before.emotionEvents, 2);
    assert.equal(before.working, 1, 'sleep purged the expired item');
    assert.equal(before.goals, 2);
    assert.equal(before.identity, 1);
    assert.equal(before.relationships, 1);
    assert.equal(before.growth, 1);
    assert.equal(before.diary, 1);
    assert.equal(before.dreams, 1);
    assert.equal(before.sleeps, 1);
    assert.equal(second.skipped, false);
    assert.equal(otherScope.skipped, false);
    assert.equal(countTable('affect_targets'), 1);
    assert.equal(countTable('self_state'), 1);
    const embeddingsGlobalBefore = Number(cortex.db.prepare(
      "SELECT COUNT(*) AS c FROM embeddings e JOIN traces t ON t.id = e.trace_id WHERE t.scope_id = 'global'",
    ).get().c);
    const embeddingsS2Before = Number(cortex.db.prepare(
      "SELECT COUNT(*) AS c FROM embeddings e JOIN traces t ON t.id = e.trace_id WHERE t.scope_id = 's2'",
    ).get().c);
    assert.equal(embeddingsGlobalBefore, 3);
    assert.equal(embeddingsS2Before, 1);
    before.affectTargets = 1;
    before.embeddings = embeddingsGlobalBefore;
    before.memoryLinks = 0;
    before.selfState = 1;

    const eventsBefore = cortex.repos.events.count();
    const globalEventsBefore = cortex.repos.events.count('global');
    const s2EventsBefore = cortex.repos.events.count('s2');
    assert.equal(eventsBefore, 4);
    assert.equal(globalEventsBefore, 3);
    assert.equal(s2EventsBefore, 1);
    assert.equal(JSON.stringify(cortex.repos.events.list({ limit: 100 }).map((event) => event.payload)).includes('白饭'), false);

    const deleted = cortex.privacy.deleteScope('global', { actor: 'user', reason: 'edge-privacy' });
    assert.equal(deleted.scopeId, 'global');
    assert.equal(deleted.removed, true);
    assert.deepEqual(deleted.counts, before);
    assert.equal(Object.values(deleted.counts).every((value) => Number.isInteger(value)), true);

    // Every derived store is empty for the deleted scope.
    assert.equal(cortex.repos.traces.count({ scopeId: 'global' }), 0);
    assert.equal(cortex.get(first.trace.id), null);
    assert.equal(cortex.get(second.trace.id), null);
    assert.equal(cortex.repos.facts.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.repos.entities.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.repos.feedback.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.working.list({ scopeId: 'global', includeExpired: true }).length, 0);
    assert.equal(cortex.goals.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.emotion.events().length, 0);
    assert.equal(cortex.emotion.targets().length, 0);
    assert.equal(cortex.life.diaryList().length, 0);
    assert.equal(cortex.life.dreamList().length, 0);
    assert.equal(cortex.life.sleepRuns().length, 0);
    assert.equal(cortex.repos.summaries.list('global').length, 0);
    assert.equal(countTable('affect_targets'), 0);
    assert.equal(countTable('self_state'), 0);
    assert.equal(countTable('memory_links'), 0);
    assert.equal(cortex.repos.traces.ftsCount(), 1, 'the surviving s2 trace keeps its FTS row');
    assert.equal(Number(cortex.db.prepare(
      "SELECT COUNT(*) AS c FROM embeddings e JOIN traces t ON t.id = e.trace_id WHERE t.scope_id = 'global'",
    ).get().c), 0);
    assert.equal(Number(cortex.db.prepare(
      "SELECT COUNT(*) AS c FROM embeddings e JOIN traces t ON t.id = e.trace_id WHERE t.scope_id = 's2'",
    ).get().c), 1);

    // Other scopes are untouched.
    assert.equal(cortex.repos.traces.count({ scopeId: 's2' }), 1);
    assert.equal(cortex.get(otherScope.trace.id).content, '另一个 scope 必须活下来。');
    assert.equal(cortex.working.list({ scopeId: 's2' }).length, 1);
    assert.equal(cortex.goals.list({ scopeId: 's2' }).length, 1);
    assert.equal(cortex.repos.events.count('s2'), s2EventsBefore);

    // The event ledger is append-only and still verifiable.
    assert.equal(cortex.repos.events.count(), eventsBefore);
    assert.equal(cortex.repos.events.count('global'), globalEventsBefore);
    const chain = cortex.repos.events.verifyChain();
    assert.equal(chain.ok, true);
    assert.equal(chain.count, eventsBefore);
    assert.equal(JSON.stringify(cortex.repos.events.list({ limit: 100 }).map((event) => event.payload)).includes('白饭'), false);

    // The deletion is audited with the exact counts returned.
    const auditRecord = cortex.repos.audit.list({ limit: 200 })
      .find((entry) => entry.action === 'privacy.delete-scope' && entry.targetId === 'global');
    assert.ok(auditRecord);
    assert.equal(auditRecord.detail.reason, 'edge-privacy');
    assert.deepEqual(auditRecord.detail.counts, deleted.counts);
    assert.equal(Object.values(auditRecord.detail.counts).every((value) => Number.isInteger(value)), true);

    // Deleting an unknown scope is a no-op on data and a valid audit event.
    const emptyDelete = cortex.privacy.deleteScope('never-existed', { reason: 'edge-empty' });
    assert.equal(emptyDelete.removed, true);
    assert.equal(Object.values(emptyDelete.counts).every((value) => value === 0), true);
    assert.equal(cortex.repos.events.count(), eventsBefore);
    assert.throws(() => cortex.privacy.deleteScope(''), /scopeId is required/);

    const guard = cortex.guardian.check();
    assert.equal(guard.ok, true);
    assert.equal(guard.chain.count, eventsBefore);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 6. Corrupt backups fail open; restore refuses invalid / live targets
// ---------------------------------------------------------------------------

test('corrupt backups are rejected without throwing and restore refuses invalid or live targets', () => {
  const context = makeCortex();
  const { cortex, dir } = context;
  try {
    cortex.write({ text: '备份前的第一条记忆。', explicit: true, now: BASE_MS });
    cortex.write({ text: '备份前的第二条记忆。', explicit: true, now: BASE_MS + 1_000 });
    const backupPath = path.join(dir, 'valid.sqlite');
    const backup = cortex.guardian.backup(backupPath);
    assert.ok(backup.bytes > 0);
    assert.equal(cortex.guardian.validateBackup(backupPath).ok, true);
    const validBytes = readFileSync(backupPath);

    const truncatedPath = path.join(dir, 'truncated.sqlite');
    writeFileSync(truncatedPath, validBytes.subarray(0, Math.floor(validBytes.length / 2)));
    const truncated = cortex.guardian.validateBackup(truncatedPath);
    assert.equal(truncated.ok, false);
    assert.equal(truncated.reason, 'corrupt-or-unreadable');
    assert.equal(typeof truncated.error, 'string');

    const randomPath = path.join(dir, 'random.sqlite');
    writeFileSync(randomPath, Buffer.from('SQLite format 3\0 this is not a real database'));
    const random = cortex.guardian.validateBackup(randomPath);
    assert.equal(random.ok, false);
    assert.equal(random.reason, 'corrupt-or-unreadable');

    const emptyPath = path.join(dir, 'empty.sqlite');
    writeFileSync(emptyPath, '');
    const empty = cortex.guardian.validateBackup(emptyPath);
    assert.equal(empty.ok, false);
    assert.equal(empty.integrity, 'ok');
    assert.equal(empty.tables, 0);
    for (const required of ['events', 'traces', 'facts', 'entities', 'self_state', 'identity_versions']) {
      assert.ok(empty.missing.includes(required), required);
    }

    const rejectedTarget = path.join(dir, 'rejected.sqlite');
    const rejected = cortex.guardian.restore(truncatedPath, rejectedTarget);
    assert.equal(rejected.restored, false);
    assert.equal(rejected.reason, 'invalid-backup');
    assert.equal(rejected.validation.ok, false);
    assert.equal(existsSync(rejectedTarget), false);

    const corruptNoTarget = cortex.guardian.restore(truncatedPath);
    assert.equal(corruptNoTarget.restored, false);
    assert.equal(corruptNoTarget.reason, 'invalid-backup', 'validation happens before the target check');

    const noTarget = cortex.guardian.restore(backupPath);
    assert.equal(noTarget.restored, false);
    assert.equal(noTarget.reason, 'target-required');

    const liveAttempt = cortex.guardian.restore(backupPath, cortex.config.dbFile);
    assert.equal(liveAttempt.restored, false);
    assert.equal(liveAttempt.reason, 'live-db');
    assert.match(liveAttempt.message, /新路径|离线|关闭/);
    assert.equal(cortex.repos.traces.count(), 2);
    assert.equal(cortex.guardian.validateBackup(cortex.config.dbFile).ok, true);

    const missing = cortex.guardian.restore(path.join(dir, 'missing.sqlite'), path.join(dir, 'missing-target.sqlite'));
    assert.equal(missing.restored, false);
    assert.equal(missing.reason, 'invalid-backup');
    assert.equal(missing.validation.reason, 'missing');

    const offline = path.join(dir, 'offline', 'restored.sqlite');
    const restored = cortex.guardian.restore(backupPath, offline);
    assert.equal(restored.restored, true);
    assert.equal(restored.target, path.resolve(offline));
    assert.equal(restored.validation.ok, true);
    assert.equal(cortex.guardian.validateBackup(offline).ok, true);

    const guard = cortex.guardian.check();
    assert.equal(guard.ok, true);
    assert.equal(cortex.repos.traces.count(), 2);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 7. Malformed HTTP bodies and route/method edges
// ---------------------------------------------------------------------------

test('API rejects malformed JSON, unsafe bodies, oversized payloads, unknown routes and wrong methods', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    for (const raw of ['{"text":', '[]', 'null', '"a string"']) {
      const response = await invokeRaw(handler, { raw });
      assert.equal(response.status, 400, raw);
      assert.equal(response.json.ok, false);
      assert.equal(response.json.error, 'invalid json body');
    }

    const invalidJsonNoHeader = await invokeRaw(handler, { raw: '{"text":', headers: { 'x-cortex': undefined } });
    assert.equal(invalidJsonNoHeader.status, 403);
    assert.equal(invalidJsonNoHeader.json.error, 'missing x-cortex header');

    const missingHeader = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '没有 x-cortex 的写入。', explicit: true },
    });
    assert.equal(missingHeader.status, 403);
    assert.equal(missingHeader.json.error, 'missing x-cortex header');

    const oversized = await invokeRaw(handler, {
      raw: JSON.stringify({ text: 'x'.repeat(300_000), explicit: true }),
    });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.json.error, 'invalid json body');

    const unknownGet = await invokeApi(handler, { route: '/does-not-exist' });
    assert.equal(unknownGet.status, 404);
    assert.equal(unknownGet.json.error, 'not found');
    const unknownHead = await invokeApi(handler, { method: 'HEAD', route: '/does-not-exist' });
    assert.equal(unknownHead.status, 404);
    const unknownPost = await invokeApi(handler, {
      method: 'POST',
      route: '/does-not-exist',
      body: {},
      headers: { 'x-cortex': '1' },
    });
    assert.equal(unknownPost.status, 404);

    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const response = await invokeApi(handler, { method, route: '/write' });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.allow, 'GET, HEAD, POST');
      assert.deepEqual(response.json, {});
    }

    const badWrites = [
      { body: { text: '   ' }, error: /text/ },
      { body: { text: '合法但重要度越界', importance: 2 }, error: /importance/ },
      { body: { text: '合法但标签不是数组', tags: [1] }, error: /tags/ },
      { body: { text: '合法但 explicit 不是布尔', explicit: 'yes' }, error: /explicit/ },
    ];
    for (const { body, error } of badWrites) {
      const response = await invokeApi(handler, { method: 'POST', route: '/write', body, headers: { 'x-cortex': '1' } });
      assert.equal(response.status, 400);
      assert.match(response.json.error, error);
    }
    const badSearchLimit = await invokeApi(handler, {
      method: 'POST', route: '/search', body: { query: 'x', limit: 99 }, headers: { 'x-cortex': '1' },
    });
    assert.equal(badSearchLimit.status, 400);
    assert.match(badSearchLimit.json.error, /limit/);
    const badSearchBudget = await invokeApi(handler, {
      method: 'POST', route: '/search', body: { query: 'x', budget: 10 }, headers: { 'x-cortex': '1' },
    });
    assert.equal(badSearchBudget.status, 400);
    assert.match(badSearchBudget.json.error, /budget/);
    const badForget = await invokeApi(handler, {
      method: 'POST', route: '/forget', body: { id: 'trc_missing', mode: 'purge' }, headers: { 'x-cortex': '1' },
    });
    assert.equal(badForget.status, 400);
    assert.match(badForget.json.error, /mode/);

    assert.equal(cortex.repos.traces.count(), 0);
    assert.equal(cortex.repos.events.count(), 0);

    const valid = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '所有坏请求之后仍然可以正常写入。', explicit: true },
      headers: { 'x-cortex': '1' },
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.json.data.skipped, false);
    assert.equal(valid.json.data.trace.content, '所有坏请求之后仍然可以正常写入。');
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.repos.events.count(), 1);
    const ping = await invokeApi(handler);
    assert.equal(ping.status, 200);
    assert.equal(ping.json.ok, true);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 8. FTS repair restores missing rows and drops stale ones
// ---------------------------------------------------------------------------

test('guardian.repairFts rebuilds a fully missing or stale FTS projection', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const first = cortex.write({ text: '第一条用于 FTS 修复。', title: '一', explicit: true, now: BASE_MS });
    const second = cortex.write({ text: '第二条用于 FTS 修复。', title: '二', explicit: true, now: BASE_MS + 1_000 });
    const archived = cortex.write({ text: '第三条已归档，也应有修复索引。', title: '三', explicit: true, now: BASE_MS + 2_000 });
    cortex.forget({ traceId: archived.trace.id, mode: 'archive' });
    assert.equal(cortex.repos.traces.count(), 3);
    assert.equal(cortex.repos.traces.ftsCount(), 3);

    cortex.db.exec('DELETE FROM traces_fts_index');
    cortex.db.prepare('INSERT INTO traces_fts_index(trace_id, text) VALUES (?, ?)').run('ghost-trace', '幽灵索引');
    assert.equal(cortex.repos.traces.ftsCount(), 1);
    const drifted = cortex.guardian.check();
    assert.equal(drifted.ok, false);
    const issue = drifted.issues.find((entry) => entry.code === 'FTS_DRIFT');
    assert.ok(issue);
    assert.match(issue.message, /FTS 1 \/ traces 3/);
    assert.equal(drifted.integrity, 'ok');
    assert.equal(drifted.chain.ok, true);

    const repaired = cortex.guardian.repairFts();
    assert.equal(repaired.before, 1);
    assert.equal(repaired.after, 3);
    assert.equal(repaired.reindexed, 3);
    assert.equal(Number(cortex.db.prepare("SELECT COUNT(*) AS c FROM traces_fts_index WHERE trace_id = 'ghost-trace'").get().c), 0);
    const clean = cortex.guardian.check();
    assert.equal(clean.ok, true);
    assert.deepEqual(clean.issues, []);

    const activeHits = cortex.search('修复', { now: BASE_MS + 3_000, limit: 10 });
    assert.deepEqual(idsOf(activeHits), [first.trace.id, second.trace.id].sort());
    const allHits = cortex.search('修复', { now: BASE_MS + 3_000, limit: 10, includeArchived: true });
    assert.ok(allHits.items.some((item) => item.id === archived.trace.id));

    const again = cortex.guardian.repairFts();
    assert.equal(again.before, 3);
    assert.equal(again.after, 3);
    assert.equal(again.reindexed, 3);
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 9. Duplicate operationId / duplicate content never duplicate traces
// ---------------------------------------------------------------------------

test('duplicate operationIds and duplicate content keep traces unique and metrics plausible', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const first = cortex.write({
      text: '重复测试：主人喜欢白饭。',
      title: '重复',
      explicit: true,
      operationId: 'edge:dup-1',
      now: BASE_MS,
    });
    assert.equal(first.skipped, false);
    const replay = cortex.write({
      text: '重复测试：主人喜欢白饭。',
      title: '重复',
      explicit: true,
      operationId: 'edge:dup-1',
      now: BASE_MS + 1_000,
    });
    assert.equal(replay.skipped, true);
    assert.equal(replay.reason, 'idempotent');
    assert.equal(replay.trace.id, first.trace.id);
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.repos.events.count(), 1);

    const duplicate = cortex.write({
      text: '重复测试：主人喜欢白饭。',
      explicit: true,
      operationId: 'edge:dup-2',
      now: BASE_MS + 2_000,
    });
    assert.equal(duplicate.skipped, true);
    assert.equal(duplicate.reason, 'duplicate');
    assert.equal(duplicate.trace.id, first.trace.id);
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.repos.events.count(), 2);
    const duplicateAudit = cortex.repos.audit.list({ limit: 50 }).find((entry) => entry.action === 'trace.duplicate');
    assert.ok(duplicateAudit);
    assert.equal(duplicateAudit.targetId, first.trace.id);
    assert.equal(duplicateAudit.detail.eventId, duplicate.event.id);

    const beforeConflict = { traces: cortex.repos.traces.count(), events: cortex.repos.events.count() };
    assert.throws(
      () => cortex.write({ text: '同一 operationId 的不同内容。', explicit: true, operationId: 'edge:dup-1' }),
      /already exists with a different payload/,
    );
    assert.deepEqual({ traces: cortex.repos.traces.count(), events: cortex.repos.events.count() }, beforeConflict);

    const metrics = cortex.metrics();
    assert.equal(metrics.counters['writes.created'], 1);
    assert.equal(metrics.counters['writes.skipped'], 2);
    assert.equal(metrics.counters['writes.created'] + metrics.counters['writes.skipped'], 3);
    assert.equal(metrics.histograms['write.ms'].count, 3);
    assert.deepEqual(cortex.repos.traces.duplicateHashes('global'), []);
    assert.equal(cortex.repos.events.verifyChain().ok, true);

    // Dedupe is scoped: identical text in a second scope is a real new trace.
    const scoped = cortex.write({
      text: '重复测试：主人喜欢白饭。',
      explicit: true,
      scopeId: 's2',
      now: BASE_MS + 3_000,
    });
    assert.equal(scoped.skipped, false);
    assert.equal(cortex.repos.traces.count(), 2);
    assert.equal(cortex.repos.traces.count({ scopeId: 'global' }), 1);
    assert.equal(cortex.repos.traces.count({ scopeId: 's2' }), 1);
    assert.deepEqual(cortex.repos.traces.duplicateHashes('global'), []);
    assert.deepEqual(cortex.repos.traces.duplicateHashes('s2'), []);
    assert.equal(cortex.repos.events.count(), 3);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 10. Vector failures degrade writes and searches without failing the service
// ---------------------------------------------------------------------------

test('vector failures never fail writes or searches and surface in the search source trace', () => {
  const context = makeCortex({ features: { vector: true } });
  const { cortex } = context;
  try {
    assert.ok(cortex.vector);
    const first = cortex.write({ text: '向量失败测试：主人喜欢白饭。', title: '向量一', explicit: true, now: BASE_MS });
    assert.equal(first.skipped, false);
    assert.equal(cortex.vector.status().count, 1);

    const originalUpsert = cortex.vector.upsert;
    try {
      cortex.vector.upsert = () => { throw new Error('embed failed'); };
      const second = cortex.write({ text: '向量失败测试：第二条记忆。', title: '向量二', explicit: true, now: BASE_MS + 1_000 });
      assert.equal(second.skipped, false);
      assert.ok(second.trace);
      assert.equal(second.trace.content, '向量失败测试：第二条记忆。');
      assert.equal(cortex.repos.traces.count(), 2);
      assert.equal(cortex.vector.status().count, 1, 'the failed upsert did not add an embedding');
      assert.equal(cortex.circuit.snapshot().state, 'closed');
    } finally {
      cortex.vector.upsert = originalUpsert;
    }

    const beforeSearch = cortex.search('向量失败测试', { now: BASE_MS + 2_000, limit: 5 });
    assert.equal(beforeSearch.items.length, 2);
    assert.equal(cortex.metrics().counters['search.calls'], 1);

    const originalSearch = cortex.vector.search;
    try {
      cortex.vector.search = () => { throw new Error('vector search failed'); };
      const degraded = cortex.search('向量失败测试', { now: BASE_MS + 3_000, limit: 5 });
      assert.ok(degraded.items.length >= 1);
      const vectorSource = sourceOf(degraded, 'vector');
      assert.ok(vectorSource);
      assert.equal(vectorSource.ok, false);
      assert.match(vectorSource.error, /vector search failed/);
      assert.equal(cortex.circuit.snapshot().state, 'closed', 'a vector error must not open the retrieval circuit');
      assert.equal(cortex.metrics().counters['search.errors'], undefined);
      assert.equal(cortex.metrics().counters['search.calls'], 2);
      assert.ok(degraded.items.some((item) => item.id === first.trace.id || item.id === cortex.repos.traces.list({ scopeId: 'global', limit: 5 })[0]?.id));
    } finally {
      cortex.vector.search = originalSearch;
    }

    const rebuilt = cortex.rebuildVector({ scopeId: 'global' });
    assert.equal(rebuilt.rebuilt, 2);
    assert.equal(cortex.vector.status().count, 2);
    assert.equal(cortex.settings().vector.count, 2);
    const healthy = cortex.search('向量失败测试', { now: BASE_MS + 4_000, limit: 5 });
    const healthyVector = sourceOf(healthy, 'vector');
    assert.equal(healthyVector.ok, true);
    assert.ok(healthyVector.count >= 1);
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 11. Identity versions are per-scope and do not trip the guardian invariant
// ---------------------------------------------------------------------------

test('identity versions are per-scope and the guardian does not false-positive IDENTITY_ACTIVE', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const globalActive = cortex.stores.identityStore.active('global');
    const s2v1 = cortex.stores.identityStore.ensure('s2');
    assert.equal(globalActive.scopeId, 'global');
    assert.equal(globalActive.status, 'active');
    assert.equal(s2v1.scopeId, 's2');
    assert.equal(s2v1.status, 'active');
    assert.equal(s2v1.version, 1);

    const clean = cortex.guardian.check();
    assert.equal(clean.ok, true);
    assert.equal(clean.issues.some((issue) => issue.code === 'IDENTITY_ACTIVE'), false);

    const s2v2 = cortex.stores.identityStore.propose(
      's2',
      { narrative: 's2 的第二版身份。', values: ['独立', '诚实'] },
      { activate: true, rationale: 'edge-case second scope' },
    );
    assert.equal(s2v2.status, 'active');
    const s2History = cortex.stores.identityStore.list('s2');
    assert.equal(s2History.length, 2);
    assert.equal(s2History.filter((item) => item.status === 'active').length, 1);
    assert.equal(cortex.stores.identityStore.active('s2').id, s2v2.id);
    assert.equal(cortex.stores.identityStore.active('global').id, globalActive.id);
    assert.equal(cortex.self('s2').identity.id, s2v2.id);
    assert.equal(cortex.self('global').identity.id, globalActive.id);
    assert.equal(cortex.guardian.check().ok, true);

    // Negative control: a genuinely duplicated active row is still caught,
    // and the issue names the offending scope instead of blaming the global one.
    cortex.db.prepare(`
      INSERT INTO identity_versions(id, scope_id, version, content, rationale, proposed_by, approved_by, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'idv_edge_duplicate_active',
      's2',
      99,
      JSON.stringify({ narrative: 'forced duplicate', values: [], boundaries: [], traits: {} }),
      'forced duplicate for negative control',
      'test',
      'test',
      new Date(BASE_MS).toISOString(),
      'active',
    );
    const broken = cortex.guardian.check();
    assert.equal(broken.ok, false);
    const issue = broken.issues.find((entry) => entry.code === 'IDENTITY_ACTIVE');
    assert.ok(issue);
    assert.equal(issue.detail.scopeId, 's2');
    assert.match(issue.message, /scope s2 的 active 身份版本数 2/);
    cortex.db.prepare("DELETE FROM identity_versions WHERE id = 'idv_edge_duplicate_active'").run();
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 12. Retention boundaries and over-count explanations
// ---------------------------------------------------------------------------

test('retention excludes important, reflection, fresh and high-confidence traces and explains over-count', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const now = BASE_MS;
    const write = (text, extra = {}) => cortex.write({
      text,
      explicit: true,
      importance: 0.05,
      now: now - 400 * DAY_MS,
      ...extra,
    });
    const oldLow = write('保留边界：四百天前的低价值记忆。');
    const boundaryImportance = write('保留边界：重要度刚好等于阈值。', { importance: 0.2 });
    const boundaryConfidence = write('保留边界：置信度刚好等于阈值。');
    const boundaryAge = write('保留边界：年龄刚好等于阈值。', { now: now - 365 * DAY_MS });
    const highImportance = write('保留边界：重要旧记忆。', { importance: 0.9 });
    const reflection = write('保留边界：旧反思。', { kind: 'reflection' });
    const freshLow = write('保留边界：昨天的低价值记忆。', { now: now - DAY_MS });
    const archivedLow = write('保留边界：已经归档的低价值记忆。');
    const pin = (trace, importance, confidence = 0.65) => {
      cortex.repos.traces.update(trace.trace.id, { importance, confidence });
    };
    pin(oldLow, 0.05);
    pin(boundaryImportance, 0.2);
    pin(boundaryConfidence, 0.05, 0.75);
    pin(boundaryAge, 0.05);
    pin(highImportance, 0.9);
    pin(reflection, 0.05);
    pin(freshLow, 0.05);
    pin(archivedLow, 0.05);
    cortex.forget({ traceId: archivedLow.trace.id, mode: 'archive' });

    const plan = cortex.retention.plan({ now, maxTraces: 10_000, maxAgeDays: 365, minImportance: 0.2, limit: 100 });
    assert.equal(plan.scopeId, 'global');
    assert.equal(plan.active, 7, 'the archived trace is not active');
    assert.deepEqual(plan.candidates.map((candidate) => candidate.id), [oldLow.trace.id]);
    const candidate = plan.candidates[0];
    assert.equal(candidate.reason, 'over-age');
    assert.ok(candidate.ageDays > 365);
    assert.ok(candidate.importance < 0.2);
    assert.ok(candidate.confidence < 0.75);

    const eventsBefore = cortex.repos.events.count();
    const dry = cortex.retention.apply(plan, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.archived, 1);
    assert.deepEqual(dry.ids, [oldLow.trace.id]);
    for (const trace of [oldLow, boundaryImportance, boundaryConfidence, boundaryAge, highImportance, reflection, freshLow]) {
      assert.equal(cortex.get(trace.trace.id).state, 'active', trace.trace.content);
    }
    assert.equal(cortex.repos.events.count(), eventsBefore);

    const applied = cortex.retention.apply(plan);
    assert.equal(applied.archived, 1);
    assert.deepEqual(applied.ids, [oldLow.trace.id]);
    assert.equal(cortex.get(oldLow.trace.id).state, 'archived');
    assert.equal(cortex.get(oldLow.trace.id).compression, 'retention');
    for (const trace of [boundaryImportance, boundaryConfidence, boundaryAge, highImportance, reflection, freshLow]) {
      assert.equal(cortex.get(trace.trace.id).state, 'active', trace.trace.content);
    }
    assert.equal(cortex.get(archivedLow.trace.id).state, 'archived');
    assert.equal(cortex.repos.traces.ftsCount(), 8);
    assert.equal(cortex.repos.traces.count(), 8);
    assert.equal(cortex.guardian.check().ok, true);

    const secondPlan = cortex.retention.plan({ now, maxTraces: 10_000, maxAgeDays: 365, minImportance: 0.2 });
    assert.equal(secondPlan.active, 6);
    assert.deepEqual(secondPlan.candidates, []);

    // Over-count is a separate explicit branch: force it with maxTraces: 0,
    // keep the age threshold loose, and check the reason is explainable.
    pin(freshLow, 0.9);
    const overCount = cortex.retention.plan({ now, maxTraces: 0, maxAgeDays: 3_650, minImportance: 0.2, limit: 100 });
    assert.equal(overCount.active, 6);
    assert.deepEqual(overCount.candidates.map((item) => item.id), [boundaryAge.trace.id]);
    assert.equal(overCount.candidates[0].reason, 'over-count');
    assert.ok(overCount.candidates[0].ageDays <= 3_650);
    const overDry = cortex.retention.apply(overCount, { dryRun: true });
    assert.equal(overDry.archived, 1);
    assert.deepEqual(overDry.ids, [boundaryAge.trace.id]);
    assert.equal(cortex.get(boundaryAge.trace.id).state, 'active');
    const overApplied = cortex.retention.apply(overCount);
    assert.equal(overApplied.archived, 1);
    assert.equal(cortex.get(boundaryAge.trace.id).state, 'archived');
    assert.equal(cortex.get(boundaryAge.trace.id).compression, 'retention');
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});
