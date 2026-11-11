/**
 * HTTP contract coverage for the dsh-cortex loopback API.
 *
 * This suite drives the real `createApiHandler` from `src/api/routes.js` with a
 * fake node:http request/response pair and a real cortex on a throwaway
 * database. It is deliberately black-box: nothing in `src/` is imported except
 * the handler factory and the route base constant, and nothing is mocked.
 *
 * Coverage is organised in four layers:
 *   1. every GET route in the handler, with envelope/shape assertions;
 *   2. every POST route, including validation and state-changing flows;
 *   3. security invariants (origin, peer, token, body parsing, methods);
 *   4. scope precedence and isolation (header > query > body).
 *
 * The tests assert stable structure, never volatile values such as ids,
 * timestamps, scores or row counts that depend on wall-clock behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { API_BASE, createApiHandler } from '../../src/api/routes.js';
import {
  apiResponse,
  cleanup,
  invokeApi,
  makeCortex,
} from './_helpers.js';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Local fake-HTTP helpers
// ---------------------------------------------------------------------------

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Request stream for bodies that cannot be produced by JSON.stringify. */
function rawApiRequest({ method = 'POST', route = '/write', raw = '', headers = {} } = {}) {
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
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  stream.headers = merged;
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

async function invokeRaw(handler, options = {}) {
  const response = apiResponse();
  await handler(rawApiRequest(options), response);
  return {
    status: response.statusCode,
    headers: response.headers,
    json: response.body ? JSON.parse(response.body) : {},
  };
}

function post(handler, route, body = {}, headers = {}) {
  return invokeApi(handler, {
    method: 'POST',
    route,
    body,
    headers: { 'x-cortex': '1', ...headers },
  });
}

// ---------------------------------------------------------------------------
// Envelope assertions
// ---------------------------------------------------------------------------

function assertIso(value, label) {
  assert.equal(typeof value, 'string', `${label} should be a string`);
  assert.ok(Number.isFinite(Date.parse(value)), `${label} should be an ISO timestamp, got ${value}`);
}

/** Assert the documented `{ ok: true, data: ... }` envelope and return data. */
function expectData(result, label) {
  assert.equal(
    result.status,
    200,
    `${label}: expected 200, got ${result.status} ${JSON.stringify(result.json)}`,
  );
  assert.equal(result.json.ok, true, `${label}: expected ok:true`);
  assert.ok(hasOwn(result.json, 'data'), `${label}: expected a data member`);
  assert.equal(hasOwn(result.json, 'error'), false, `${label}: a success envelope must not carry error`);
  return result.json.data;
}

/** Assert the documented `{ ok: false, error: string }` failure envelope. */
function expectError(result, { label = 'request', status = 400, match = null } = {}) {
  assert.equal(
    result.status,
    status,
    `${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)}`,
  );
  assert.equal(result.json.ok, false, `${label}: expected ok:false`);
  assert.equal(typeof result.json.error, 'string', `${label}: expected an error string`);
  assert.equal(hasOwn(result.json, 'data'), false, `${label}: a failure envelope must not carry data`);
  if (match) assert.match(result.json.error, match, `${label}: error should mention ${match}`);
}

function assertInteger(value, label, { min = Number.MIN_SAFE_INTEGER } = {}) {
  assert.ok(Number.isInteger(value), `${label} should be an integer, got ${typeof value} ${value}`);
  assert.ok(value >= min, `${label} should be >= ${min}, got ${value}`);
}

function writeTrace(cortex, text, extra = {}) {
  return cortex.write({ text, explicit: true, ...extra });
}

// ---------------------------------------------------------------------------
// 1. GET routes
// ---------------------------------------------------------------------------

test('GET contract: every read route returns the documented status and envelope', async (t) => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const firstTrace = writeTrace(cortex, '主人喜欢白饭，本鲸记着。', {
      title: '白饭',
      tags: ['约定'],
      importance: 0.8,
    });
    writeTrace(cortex, '本鲸昨天修了记忆插件。', {
      title: '插件',
      tags: ['技术'],
      importance: 0.4,
    });
    const focus = cortex.working.add({ text: '写 API 契约测试', priority: 0.9, pinned: true });
    const activeGoal = cortex.goals.add({ title: '完成 API 契约测试', priority: 0.9 });
    const doneGoal = cortex.goals.add({ title: '旧的完成项', priority: 0.3 });
    cortex.goals.complete(doneGoal.id);
    cortex.emotion.record({ text: '本鲸很喜欢主人，也很心疼主人。', target: '主人' });
    cortex.life.diaryWrite({ text: '今天补契约测试。', mood: '踏实' });
    await cortex.life.dreamGenerate();
    await cortex.life.sleep({ windowDays: 1 });

    const traceId = firstTrace.trace.id;
    const traceDate = firstTrace.trace.recordedAt.slice(0, 10);

    const routes = [
      ['/ping', (result) => {
        assert.equal(result.status, 200);
        assert.equal(result.json.ok, true);
        assert.equal(hasOwn(result.json, 'data'), false, 'ping has no data member');
        assertIso(result.json.at, 'ping.at');
        assert.match(result.headers['content-type'], /application\/json/);
        assert.equal(result.headers['cache-control'], 'no-store');
      }],
      ['/health', (result) => {
        const data = expectData(result, '/health');
        assert.equal(data.scopeId, 'global');
        assert.equal(typeof data.score, 'number');
        assert.ok(data.score >= 0 && data.score <= 100);
        assert.ok(Array.isArray(data.issues));
        assert.ok(Array.isArray(data.ok));
        assert.equal(typeof data.counts, 'object');
        assertIso(data.at, 'health.at');
      }],
      ['/self', (result) => {
        const data = expectData(result, '/self');
        assert.equal(typeof data.self, 'object');
        assert.equal(data.self.scopeId, 'global');
        assert.equal(typeof data.self.stage, 'string');
        assert.equal(typeof data.identity, 'object');
        assert.ok(Array.isArray(data.relationships));
        assert.ok(Array.isArray(data.intentions));
        assert.ok(Array.isArray(data.working));
        assert.ok(Array.isArray(data.goals));
        assert.equal(typeof data.emotion, 'string');
        assert.equal(typeof data.calibration, 'object');
      }],
      ['/stats', (result) => {
        const data = expectData(result, '/stats');
        assert.equal(data.config.scope, 'global');
        assert.equal(data.config.dbFile, cortex.config.dbFile);
        assert.ok(data.vector === null || typeof data.vector === 'object');
      }],
      ['/settings', (result) => {
        const data = expectData(result, '/settings');
        assert.equal(data.scope, 'global');
        assert.equal(data.dataRoot, cortex.config.dataRoot);
        assert.equal(data.dbFile, cortex.config.dbFile);
        assert.equal(typeof data.contextBudget, 'number');
        assert.equal(typeof data.features, 'object');
        assert.equal(data.features.vector, false);
        assert.ok(data.vector === null || typeof data.vector === 'object');
      }],
      ['/metrics', (result) => {
        const data = expectData(result, '/metrics');
        assert.equal(typeof data.at, 'string');
        assert.equal(typeof data.counters, 'object');
        assert.equal(typeof data.histograms, 'object');
        assert.ok(Number.isInteger(data.counters['writes.created']));
        assert.ok(data.counters['writes.created'] >= 2);
        assert.equal(typeof data.histograms['write.ms'], 'object');
      }],
      ['/graph', (result) => {
        const data = expectData(result, '/graph');
        for (const key of ['nodes', 'edges', 'components', 'communities']) {
          assertInteger(data[key], `graph.${key}`, { min: 0 });
        }
        assert.ok(Array.isArray(data.top));
      }],
      ['/graph/edges', (result) => {
        const data = expectData(result, '/graph/edges');
        assert.ok(Array.isArray(data.nodes));
        assert.ok(Array.isArray(data.edges));
        assert.equal(typeof data.summary, 'object');
        for (const key of ['nodes', 'edges', 'components', 'communities']) {
          assertInteger(data.summary[key], `graph.edges.summary.${key}`, { min: 0 });
        }
        assert.ok(Array.isArray(data.summary.top));
      }],
      ['/retention', (result) => {
        const data = expectData(result, '/retention');
        assert.equal(data.scopeId, 'global');
        assertInteger(data.active, 'retention.active', { min: 0 });
        assert.ok(Array.isArray(data.candidates));
        assertInteger(data.count, 'retention.count', { min: 0 });
        assert.equal(data.count, data.candidates.length);
        assertIso(data.at, 'retention.at');
      }],
      [`/digest?date=${traceDate}`, (result) => {
        const data = expectData(result, '/digest');
        assert.equal(data.date, traceDate);
        assert.equal(typeof data.content, 'string');
        assert.match(data.content, /记忆摘要/);
        assert.equal(typeof data.counts, 'object');
        assertInteger(data.counts.traces, 'digest.counts.traces', { min: 2 });
        assert.equal(typeof data.byKind, 'object');
        assert.ok(Array.isArray(data.important));
        assert.ok(data.summary === null || typeof data.summary === 'object');
        assertIso(data.at, 'digest.at');
      }],
      ['/digest?date=1900-01-02', (result) => {
        const data = expectData(result, '/digest empty day');
        assert.equal(data.date, '1900-01-02');
        assert.equal(data.counts.traces, 0);
        assert.deepEqual(data.important, []);
        assert.match(data.content, /1900-01-02/);
      }],
      ['/audit', (result) => {
        const data = expectData(result, '/audit');
        assert.ok(Array.isArray(data));
        assert.ok(data.length >= 1);
        for (const row of data) {
          assert.equal(typeof row.id, 'string');
          assert.equal(typeof row.action, 'string');
          assert.equal(typeof row.detail, 'object');
          assertIso(row.at, 'audit.at');
        }
      }],
      ['/audit?limit=0', (result) => {
        const data = expectData(result, '/audit limit clamp');
        assert.ok(Array.isArray(data));
        assert.equal(data.length, 1, 'limit 0 is clamped up to 1');
      }],
      ['/working', (result) => {
        const data = expectData(result, '/working');
        assert.ok(Array.isArray(data));
        assert.ok(data.some((item) => item.id === focus.id));
        const item = data.find((entry) => entry.id === focus.id);
        assert.equal(item.text, '写 API 契约测试');
        assert.equal(item.scopeId, 'global');
        assert.equal(item.pinned, true);
        assert.equal(typeof item.priority, 'number');
      }],
      ['/goals', (result) => {
        const data = expectData(result, '/goals');
        assert.ok(Array.isArray(data));
        assert.ok(data.some((goal) => goal.id === activeGoal.id));
        assert.ok(data.some((goal) => goal.id === doneGoal.id));
      }],
      ['/goals?status=active', (result) => {
        const data = expectData(result, '/goals active');
        assert.ok(data.every((goal) => goal.status === 'active'));
        assert.ok(data.some((goal) => goal.id === activeGoal.id));
        assert.equal(data.some((goal) => goal.id === doneGoal.id), false);
      }],
      ['/goals?status=completed', (result) => {
        const data = expectData(result, '/goals completed');
        assert.ok(data.every((goal) => goal.status === 'completed'));
        assert.ok(data.some((goal) => goal.id === doneGoal.id));
      }],
      ['/emotion', (result) => {
        const data = expectData(result, '/emotion');
        assert.equal(typeof data.text, 'string');
        assert.ok(Array.isArray(data.targets));
        assert.ok(Array.isArray(data.events));
        assert.ok(data.targets.some((target) => target.target === '主人'));
        assert.ok(data.events.length >= 1);
        assert.equal(typeof data.events[0].emotions, 'object');
        assert.ok(Array.isArray(data.events[0].emotions));
      }],
      ['/life', (result) => {
        const data = expectData(result, '/life');
        assert.ok(Array.isArray(data.diary));
        assert.ok(Array.isArray(data.dreams));
        assert.ok(Array.isArray(data.sleeps));
        assert.ok(data.diary.length >= 1);
        assert.ok(data.dreams.length >= 1);
        assert.ok(data.sleeps.length >= 1);
        assert.equal(typeof data.diary[0].text, 'string');
        assert.equal(typeof data.dreams[0].text, 'string');
        assert.equal(typeof data.sleeps[0].report, 'object');
      }],
      ['/skills', (result) => {
        const data = expectData(result, '/skills');
        assert.ok(Array.isArray(data));
      }],
      ['/guard', (result) => {
        const data = expectData(result, '/guard');
        assert.equal(typeof data.ok, 'boolean');
        assert.ok(Array.isArray(data.issues));
        assert.equal(data.integrity, 'ok');
        assert.equal(typeof data.chain, 'object');
        assert.equal(data.chain.ok, true);
        assertInteger(data.chain.count, 'guard.chain.count', { min: 1 });
        assertIso(data.at, 'guard.at');
        assertInteger(data.dbBytes, 'guard.dbBytes', { min: 1 });
      }],
      ['/evolution', (result) => {
        const data = expectData(result, '/evolution');
        assert.equal(typeof data.active, 'object');
        for (const kind of ['retrieval', 'maintenance', 'repair', 'skill']) {
          assert.ok(hasOwn(data.active, kind), `evolution.active.${kind}`);
        }
        assert.ok(Array.isArray(data.candidates));
        assert.equal(typeof data.identity, 'object');
        assert.equal(data.identity.scopeId, 'global');
      }],
      [`/search?q=${encodeURIComponent('白饭')}`, (result) => {
        const data = expectData(result, '/search');
        assert.equal(data.query, '白饭');
        assert.equal(data.scopeId, 'global');
        assert.ok(Array.isArray(data.items));
        assert.ok(data.items.some((item) => item.id === traceId));
        assert.equal(typeof data.budget, 'object');
        assert.equal(typeof data.budget.used, 'number');
        assert.equal(typeof data.budget.total, 'number');
        assert.equal(typeof data.trace, 'object');
        assert.ok(Array.isArray(data.trace.sources));
        assertIso(data.at, 'search.at');
      }],
      ['/search', (result) => {
        const data = expectData(result, '/search empty query');
        assert.equal(data.query, '');
        assert.ok(Array.isArray(data.items));
      }],
      ['/search?limit=999&budget=1', (result) => {
        const data = expectData(result, '/search clamps');
        assert.equal(data.budget.total, 200, 'GET budget is clamped up to 200');
        assert.ok(data.items.length <= 20, 'GET limit is clamped down to 20');
      }],
      [`/trace?id=${traceId}`, (result) => {
        const data = expectData(result, '/trace');
        assert.equal(data.id, traceId);
        assert.equal(data.scopeId, 'global');
        assert.equal(data.content, '主人喜欢白饭，本鲸记着。');
        assertIso(data.recordedAt, 'trace.recordedAt');
      }],
      [`/timeline?id=${traceId}`, (result) => {
        const data = expectData(result, '/timeline');
        assert.equal(typeof data.anchor, 'object');
        assert.equal(data.anchor.id, traceId);
        assert.ok(Array.isArray(data.items));
        assert.ok(data.items.some((item) => item.isAnchor === true && item.id === traceId));
        assertIso(data.at, 'timeline.at');
      }],
      ['/timeline', (result) => {
        const data = expectData(result, '/timeline without id');
        assert.equal(data.anchor, null);
        assert.deepEqual(data.items, []);
      }],
      ['/timeline?id=trc_does_not_exist', (result) => {
        const data = expectData(result, '/timeline unknown id');
        assert.equal(data.anchor, null);
        assert.deepEqual(data.items, []);
      }],
      ['/trace', (result) => {
        expectError(result, { status: 404, label: '/trace without id', match: /not found/ });
      }],
      ['/trace?id=trc_does_not_exist', (result) => {
        expectError(result, { status: 404, label: '/trace unknown id', match: /not found/ });
      }],
    ];

    for (const [route, check] of routes) {
      await t.test(route, async () => {
        const result = await invokeApi(handler, { route });
        check(result);
      });
    }
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 2. POST: memory write/search/feedback/forget
// ---------------------------------------------------------------------------

test('POST /write accepts one memory, deduplicates, and writes batches atomically', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const bad = await post(handler, '/write', { text: '   ' });
    expectError(bad, { label: 'write blank', match: /text/ });

    const single = await post(handler, '/write', {
      text: '主人喜欢白饭。',
      title: '白饭',
      tags: ['约定', '日常'],
      importance: 0.9,
      explicit: true,
      operationId: 'contract:write:1',
    });
    const written = expectData(single, 'write single');
    assert.equal(written.skipped, false);
    assert.equal(written.trace.content, '主人喜欢白饭。');
    assert.equal(written.trace.title, '白饭');
    assert.equal(written.trace.scopeId, 'global');
    assert.deepEqual(written.trace.tags, ['约定', '日常']);
    assert.equal(typeof written.trace.id, 'string');
    assert.equal(typeof written.event, 'object');
    assert.equal(typeof written.event.id, 'string');
    assertIso(written.trace.recordedAt, 'write.trace.recordedAt');

    const duplicate = await post(handler, '/write', { text: '主人喜欢白饭。', explicit: true });
    const deduped = expectData(duplicate, 'write duplicate');
    assert.equal(deduped.skipped, true);
    assert.equal(deduped.reason, 'duplicate');
    assert.equal(deduped.trace.id, written.trace.id);

    const batch = await post(handler, '/write', {
      items: [
        { text: '批量第一条。', title: '一', explicit: true },
        { text: '批量第二条。', title: '二', explicit: true },
      ],
    });
    const batchData = expectData(batch, 'write batch');
    assert.ok(Array.isArray(batchData));
    assert.equal(batchData.length, 2);
    assert.equal(batchData[0].trace.content, '批量第一条。');
    assert.equal(batchData[1].trace.content, '批量第二条。');
    assert.equal(batchData.every((entry) => entry.skipped === false), true);

    const before = cortex.repos.traces.count();
    const invalidBatch = await post(handler, '/write', {
      items: [{ text: '合法项。', explicit: true }, { text: '   ' }],
    });
    expectError(invalidBatch, { label: 'write invalid batch', match: /text/ });
    assert.equal(cortex.repos.traces.count(), before, 'validation happens before any batch write');

    const emptyBatch = await post(handler, '/write', { items: [] });
    const emptyData = expectData(emptyBatch, 'empty batch');
    assert.deepEqual(emptyData, []);
  } finally {
    cleanup(context);
  }
});

test('POST /search validates its body and returns the retrieval envelope', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const written = writeTrace(cortex, '主人喜欢白饭，本鲸记着。', { title: '白饭' });

    const found = await post(handler, '/search', { query: '白饭', limit: 5, budget: 500 });
    const data = expectData(found, 'search post');
    assert.equal(data.query, '白饭');
    assert.equal(data.scopeId, 'global');
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.some((item) => item.id === written.trace.id));
    assert.equal(typeof data.intent, 'string');
    assert.equal(typeof data.trace, 'object');
    assert.ok(Array.isArray(data.trace.sources));
    assertIso(data.at, 'search.at');

    const wide = await post(handler, '/search', { query: '白饭', limit: 20, budget: 64 });
    expectData(wide, 'search lower budget');

    const invalid = [
      [{}, /query/],
      [{ query: '' }, /query/],
      [{ query: '   ' }, /query/],
      [{ query: 'x', limit: 0 }, /limit/],
      [{ query: 'x', limit: 21 }, /limit/],
      [{ query: 'x', budget: 63 }, /budget/],
      [{ query: 'x', budget: 20001 }, /budget/],
    ];
    for (const [body, match] of invalid) {
      const result = await post(handler, '/search', body);
      expectError(result, { label: `search ${JSON.stringify(body)}`, match });
    }
  } finally {
    cleanup(context);
  }
});

test('POST /feedback and POST /forget update or remove traces with documented shapes', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const active = writeTrace(cortex, '反馈测试用的记忆。', { title: '反馈' });
    const forgotten = writeTrace(cortex, '删除测试用的记忆。', { title: '删除' });

    const feedback = await post(handler, '/feedback', {
      id: active.trace.id,
      signal: 'used',
      predicted: 0.8,
      outcome: 1,
    });
    const feedbackData = expectData(feedback, 'feedback');
    assert.equal(feedbackData.trace.id, active.trace.id);
    assert.equal(typeof feedbackData.feedback, 'object');
    assert.equal(feedbackData.feedback.signal, 'used');
    assertIso(feedbackData.feedback.at, 'feedback.at');

    expectError(await post(handler, '/feedback', { signal: 'used' }), {
      label: 'feedback missing id',
      match: /id/,
    });
    expectError(await post(handler, '/feedback', { id: active.trace.id }), {
      label: 'feedback missing signal',
      match: /signal/,
    });

    const archived = await post(handler, '/forget', { id: active.trace.id, mode: 'archive' });
    const archivedData = expectData(archived, 'forget archive');
    assert.equal(archivedData.removed, true);
    assert.equal(archivedData.trace.state, 'archived');
    const rawArchived = expectData(await invokeApi(handler, { route: `/trace?id=${active.trace.id}` }), 'trace archived');
    assert.equal(rawArchived.state, 'archived');

    const deleted = await post(handler, '/forget', { id: forgotten.trace.id, mode: 'delete' });
    const deletedData = expectData(deleted, 'forget delete');
    assert.equal(deletedData.removed, true);
    assert.equal(deletedData.eventRetained, true);
    expectError(await invokeApi(handler, { route: `/trace?id=${forgotten.trace.id}` }), {
      status: 404,
      label: 'trace after delete',
    });

    expectError(await post(handler, '/forget', { id: active.trace.id, mode: 'purge' }), {
      label: 'forget bad mode',
      match: /mode/,
    });
    expectError(await post(handler, '/forget', { mode: 'archive' }), {
      label: 'forget missing id',
      match: /id/,
    });
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 3. POST: reflection, compression, QA, autonomy, retention
// ---------------------------------------------------------------------------

test('POST /reflect creates a summary, then reports already-reflected and honours force', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    writeTrace(cortex, '第一条用于反思的记忆。', { title: '一' });
    writeTrace(cortex, '第二条用于反思的记忆。', { title: '二' });

    const first = await post(handler, '/reflect', {});
    const firstData = expectData(first, 'reflect first');
    assert.equal(firstData.skipped, false);
    assert.equal(typeof firstData.summary, 'object');
    assert.equal(typeof firstData.summary.content, 'string');
    assert.ok(Array.isArray(firstData.summary.sourceIds));
    assert.equal(typeof firstData.trace, 'object');
    assert.equal(firstData.trace.kind, 'reflection');
    assert.equal(typeof firstData.coverage, 'number');
    assert.ok(Array.isArray(firstData.sources));
    assertIso(firstData.at, 'reflect.at');

    const second = await post(handler, '/reflect', {});
    const secondData = expectData(second, 'reflect second');
    assert.equal(secondData.skipped, true);
    assert.equal(secondData.reason, 'already-reflected');
    assert.equal(typeof secondData.summary, 'object');

    const forced = await post(handler, '/reflect', { force: true, windowDays: 1 });
    const forcedData = expectData(forced, 'reflect force');
    assert.equal(forcedData.skipped, false);
    assert.equal(typeof forcedData.summary.id, 'string');
  } finally {
    cleanup(context);
  }
});

test('POST /compress archives eligible covered traces and clamps its limit', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const old = cortex.write({
      text: '一条三十天前的低价值记忆，已经被摘要覆盖。',
      title: '旧记忆',
      explicit: true,
      importance: 0.1,
      now: Date.now() - 30 * DAY_MS,
    });
    cortex.repos.summaries.insert({
      content: '摘要覆盖了那条旧记忆。',
      sourceIds: [old.trace.id],
      coverage: 1,
    });

    const compressed = await post(handler, '/compress', { limit: 10 });
    const data = expectData(compressed, 'compress');
    assertInteger(data.archived, 'compress.archived', { min: 1 });
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.length >= 1);
    const item = data.items.find((entry) => entry.id === old.trace.id);
    assert.ok(item, 'the eligible old trace should be compressed');
    assert.equal(item.trace.state, 'archived');
    assert.equal(typeof item.coverage, 'number');
    assert.equal(typeof item.retrieved, 'number');
    assert.equal(typeof item.ageDays, 'number');
    assertIso(data.at, 'compress.at');
    assert.equal(cortex.get(old.trace.id).state, 'archived');

    const clamped = await post(handler, '/compress', { limit: 100000 });
    const clampedData = expectData(clamped, 'compress clamp');
    assertInteger(clampedData.archived, 'compress.clamped.archived', { min: 0 });
  } finally {
    cleanup(context);
  }
});

test('POST /qa abstains without memories and answers from evidence after a write', async () => {
  const emptyContext = makeCortex();
  try {
    const emptyHandler = createApiHandler({ cortex: emptyContext.cortex });
    const abstain = await post(emptyHandler, '/qa', { question: '主人喜欢什么？' });
    const abstainData = expectData(abstain, 'qa abstain');
    assert.equal(abstainData.mode, 'abstain');
    assert.equal(typeof abstainData.answer, 'string');
    assert.ok(Array.isArray(abstainData.sources));
    assert.equal(abstainData.sources.length, 0);

    expectError(await post(emptyHandler, '/qa', {}), { label: 'qa missing question', match: /question/ });
    expectError(await post(emptyHandler, '/qa', { question: '   ' }), { label: 'qa blank question', match: /question/ });
  } finally {
    cleanup(emptyContext);
  }

  const context = makeCortex();
  try {
    const handler = createApiHandler({ cortex: context.cortex });
    writeTrace(context.cortex, '主人喜欢白饭，本鲸记着。', { title: '白饭' });
    const answered = await post(handler, '/qa', { question: '主人喜欢什么？' });
    const data = expectData(answered, 'qa answered');
    assert.ok(['extractive', 'llm'].includes(data.mode));
    assert.equal(typeof data.answer, 'string');
    assert.ok(data.answer.length > 0);
    assert.ok(Array.isArray(data.sources));
    assert.ok(data.sources.length >= 1);
  } finally {
    cleanup(context);
  }
});

test('POST /tick executes safe pending intentions and reports the queue', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    writeTrace(cortex, '主人喜欢白饭，本鲸记着。', { title: '白饭' });
    const now = new Date();
    const intention = cortex.stores.initiativeStore.insert({
      kind: 'recall',
      priority: 0.9,
      reason: '契约测试想主动回忆',
      payload: { topic: '白饭' },
      createdAt: now.toISOString(),
      dueAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    });

    const tick = await post(handler, '/tick', { max: 1 });
    const data = expectData(tick, 'tick');
    assert.ok(Array.isArray(data.executed));
    assert.ok(Array.isArray(data.proposals));
    assert.equal(typeof data.pending, 'number');
    assert.equal(data.pending, 1);
    assert.equal(data.executed.length, 1);
    assert.equal(data.executed[0].id, intention.id);
    assert.equal(data.executed[0].kind, 'recall');
    assert.equal(typeof data.executed[0].result.count, 'number');
    assert.ok(Array.isArray(data.executed[0].result.ids));
    assertIso(data.at, 'tick.at');
    assert.equal(cortex.stores.initiativeStore.get(intention.id).status, 'acted');
  } finally {
    cleanup(context);
  }
});

test('POST /retention/apply honours dryRun and then archives the plan', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const old = cortex.write({
      text: '四百天前的一条低价值旧记忆。',
      title: '旧记录',
      explicit: true,
      importance: 0.05,
      now: Date.now() - 400 * DAY_MS,
    });

    const dry = await post(handler, '/retention/apply', { dryRun: true });
    const dryData = expectData(dry, 'retention dry run');
    assert.equal(dryData.dryRun, true);
    assertInteger(dryData.archived, 'retention.dryRun.archived', { min: 1 });
    assert.ok(Array.isArray(dryData.ids));
    assert.ok(dryData.ids.includes(old.trace.id));
    assert.equal(cortex.get(old.trace.id).state, 'active', 'dryRun must not archive');

    const applied = await post(handler, '/retention/apply', {});
    const appliedData = expectData(applied, 'retention apply');
    assertInteger(appliedData.archived, 'retention.applied.archived', { min: 1 });
    assert.ok(appliedData.ids.includes(old.trace.id));
    assert.equal(cortex.get(old.trace.id).state, 'archived');
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 4. POST: guardian
// ---------------------------------------------------------------------------

test('POST /guard/* backs up, validates, exports, repairs and restores safely', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    writeTrace(cortex, '备份之前的记忆。', { title: '备份' });

    const backupPath = path.join(context.dir, 'contract-backup.sqlite');
    const backup = await post(handler, '/guard/backup', { file: backupPath });
    const backupData = expectData(backup, 'guard backup');
    assert.equal(backupData.path, path.resolve(backupPath));
    assertInteger(backupData.bytes, 'backup.bytes', { min: 1 });
    assertIso(backupData.at, 'backup.at');
    assert.equal(existsSync(backupPath), true);

    const implicit = await post(handler, '/guard/backup', {});
    const implicitData = expectData(implicit, 'guard backup default file');
    assert.equal(implicitData.path.startsWith(path.join(cortex.config.dataRoot, 'backups')), true);
    assert.equal(existsSync(implicitData.path), true);

    const valid = await post(handler, '/guard/validate', { file: backupPath });
    const validData = expectData(valid, 'guard validate');
    assert.equal(validData.ok, true);
    assert.equal(validData.integrity, 'ok');
    assert.ok(Array.isArray(validData.missing));
    assertInteger(validData.tables, 'validate.tables', { min: 1 });

    const missing = await post(handler, '/guard/validate', { file: path.join(context.dir, 'missing.sqlite') });
    const missingData = expectData(missing, 'guard validate missing');
    assert.equal(missingData.ok, false);
    assert.equal(missingData.reason, 'missing');

    const corruptPath = path.join(context.dir, 'corrupt.sqlite');
    writeFileSync(corruptPath, Buffer.from('this is not a sqlite database', 'utf8'));
    const corrupt = await post(handler, '/guard/validate', { file: corruptPath });
    const corruptData = expectData(corrupt, 'guard validate corrupt');
    assert.equal(corruptData.ok, false);

    expectError(await post(handler, '/guard/validate', {}), {
      label: 'guard validate missing field',
      match: /file/,
    });

    const restorePath = path.join(context.dir, 'restored', 'copy.sqlite');
    const restored = await post(handler, '/guard/restore', { file: backupPath, target: restorePath });
    const restoredData = expectData(restored, 'guard restore');
    assert.equal(restoredData.restored, true);
    assert.equal(restoredData.target, path.resolve(restorePath));
    assert.equal(restoredData.validation.ok, true);
    assert.equal(existsSync(restorePath), true);

    const invalidRestore = await post(handler, '/guard/restore', {
      file: path.join(context.dir, 'missing.sqlite'),
      target: path.join(context.dir, 'never.sqlite'),
    });
    const invalidData = expectData(invalidRestore, 'guard restore invalid');
    assert.equal(invalidData.restored, false);
    assert.equal(invalidData.reason, 'invalid-backup');
    assert.equal(invalidData.validation.ok, false);

    const liveRestore = await post(handler, '/guard/restore', {
      file: backupPath,
      target: cortex.config.dbFile,
    });
    const liveData = expectData(liveRestore, 'guard restore live');
    assert.equal(liveData.restored, false);
    assert.equal(liveData.reason, 'live-db');

    expectError(await post(handler, '/guard/restore', { file: backupPath }), {
      label: 'guard restore missing target',
      match: /target/,
    });
    expectError(await post(handler, '/guard/restore', { target: restorePath }), {
      label: 'guard restore missing file',
      match: /file/,
    });

    const exportDir = path.join(context.dir, 'markdown-export');
    const exported = await post(handler, '/guard/export', { dir: exportDir });
    const exportData = expectData(exported, 'guard export');
    assert.equal(exportData.root, path.resolve(exportDir));
    assert.deepEqual(exportData.files, ['MEMORY.md', 'SELF.md', 'FACTS.md', 'SKILLS.md']);
    assertInteger(exportData.traces, 'export.traces', { min: 1 });
    assertInteger(exportData.facts, 'export.facts', { min: 0 });
    assertInteger(exportData.skills, 'export.skills', { min: 0 });
    for (const file of exportData.files) {
      assert.equal(existsSync(path.join(exportDir, file)), true, `${file} should exist`);
    }
    assert.match(readFileSync(path.join(exportDir, 'MEMORY.md'), 'utf8'), /备份之前的记忆/);

    expectError(await post(handler, '/guard/export', {}), {
      label: 'guard export missing dir',
      match: /dir/,
    });

    const repaired = await post(handler, '/guard/repair', {});
    const repairData = expectData(repaired, 'guard repair');
    assertInteger(repairData.before, 'repair.before', { min: 0 });
    assertInteger(repairData.after, 'repair.after', { min: 0 });
    assertInteger(repairData.reindexed, 'repair.reindexed', { min: 0 });
    assert.equal(repairData.after, cortex.repos.traces.ftsCount());
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 5. POST: evolution
// ---------------------------------------------------------------------------

test('POST /evolve/* proposes, lists, approves and rolls back candidate policies', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const optimized = await post(handler, '/evolve/optimize', {});
    const optimizedData = expectData(optimized, 'evolve optimize');
    assert.ok(Array.isArray(optimizedData.proposals));
    assertInteger(optimizedData.count, 'optimize.count', { min: 0 });
    assertIso(optimizedData.at, 'optimize.at');

    const first = await post(handler, '/evolve/propose', {
      kind: 'retrieval',
      config: { budget: 400 },
      rationale: 'contract first',
    });
    const firstPolicy = expectData(first, 'evolve propose first');
    assert.equal(firstPolicy.kind, 'retrieval');
    assert.equal(firstPolicy.version, 1);
    assert.equal(firstPolicy.status, 'candidate');
    assert.deepEqual(firstPolicy.config, { budget: 400 });
    assert.equal(typeof firstPolicy.id, 'string');

    const second = await post(handler, '/evolve/propose', {
      kind: 'retrieval',
      config: { budget: 500 },
    });
    const secondPolicy = expectData(second, 'evolve propose second');
    assert.equal(secondPolicy.version, 2);
    assert.equal(secondPolicy.status, 'candidate');

    const approved = await post(handler, '/evolve/approve', { id: secondPolicy.id });
    const approvedData = expectData(approved, 'evolve approve');
    assert.equal(approvedData.id, secondPolicy.id);
    assert.equal(approvedData.status, 'active');
    assertIso(approvedData.activatedAt, 'approved.activatedAt');

    const evolution = expectData(await invokeApi(handler, { route: '/evolution' }), 'evolution after approve');
    assert.equal(evolution.active.retrieval.id, secondPolicy.id);
    assert.ok(evolution.candidates.some((policy) => policy.id === firstPolicy.id));

    const rolledBack = await post(handler, '/evolve/rollback', {
      kind: 'retrieval',
      id: firstPolicy.id,
    });
    const rolledBackData = expectData(rolledBack, 'evolve rollback');
    assert.equal(rolledBackData.id, firstPolicy.id);
    assert.equal(rolledBackData.status, 'active');

    expectError(await post(handler, '/evolve/propose', {}), {
      label: 'evolve propose missing kind',
      match: /kind/,
    });
    expectError(await post(handler, '/evolve/approve', { id: 'pol_missing' }), {
      label: 'evolve approve unknown id',
      match: /policy not found/,
    });
    expectError(await post(handler, '/evolve/rollback', { kind: 'missing-kind' }), {
      label: 'evolve rollback unknown kind',
    });
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 6. POST: working memory
// ---------------------------------------------------------------------------

test('POST /working/* adds, updates, removes and purges working memory', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const added = await post(handler, '/working/add', {
      text: '写契约测试',
      kind: 'focus',
      priority: 0.9,
      pinned: true,
    });
    const item = expectData(added, 'working add');
    assert.equal(typeof item.id, 'string');
    assert.equal(item.scopeId, 'global');
    assert.equal(item.text, '写契约测试');
    assert.equal(item.kind, 'focus');
    assert.equal(item.priority, 0.9);
    assert.equal(item.pinned, true);
    assertIso(item.createdAt, 'working.createdAt');

    expectError(await post(handler, '/working/add', {}), {
      label: 'working add missing text',
      match: /text/,
    });

    const updated = await post(handler, '/working/update', {
      id: item.id,
      text: '写 API 契约测试',
      priority: 0.8,
      pinned: false,
    });
    const updatedItem = expectData(updated, 'working update');
    assert.equal(updatedItem.id, item.id);
    assert.equal(updatedItem.text, '写 API 契约测试');
    assert.equal(updatedItem.priority, 0.8);
    assert.equal(updatedItem.pinned, false);

    const unknown = await post(handler, '/working/update', { id: 'wrk_missing', text: 'x' });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.json.ok, true);
    assert.equal(unknown.json.data, null);

    const removed = await post(handler, '/working/remove', { id: item.id });
    assert.deepEqual(expectData(removed, 'working remove'), { removed: true });
    const removedAgain = await post(handler, '/working/remove', { id: item.id });
    assert.deepEqual(expectData(removedAgain, 'working remove again'), { removed: false });

    cortex.working.add({ text: '已过期的焦点', at: Date.now() - 60_000, ttlMs: 1_000 });
    cortex.working.add({ text: '还活着的焦点' });
    const purged = await post(handler, '/working/purge', {});
    const purgeData = expectData(purged, 'working purge');
    assertInteger(purgeData.purged, 'purge.purged', { min: 1 });
    const list = expectData(await invokeApi(handler, { route: '/working' }), 'working after purge');
    assert.equal(list.some((entry) => entry.text === '已过期的焦点'), false);
    assert.equal(list.some((entry) => entry.text === '还活着的焦点'), true);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 7. POST: goals
// ---------------------------------------------------------------------------

test('POST /goals/* creates, updates, filters and completes goals', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const added = await post(handler, '/goals/add', {
      title: '完成契约测试',
      description: '覆盖全部路由',
      priority: 0.9,
      dueAt: '2026-12-01',
    });
    const goal = expectData(added, 'goals add');
    assert.equal(typeof goal.id, 'string');
    assert.equal(goal.title, '完成契约测试');
    assert.equal(goal.description, '覆盖全部路由');
    assert.equal(goal.priority, 0.9);
    assert.equal(goal.progress, 0);
    assert.equal(goal.status, 'active');
    assert.equal(goal.dueAt, '2026-12-01');
    assertIso(goal.createdAt, 'goal.createdAt');

    expectError(await post(handler, '/goals/add', {}), {
      label: 'goals add missing title',
      match: /title/,
    });

    const updated = await post(handler, '/goals/update', {
      id: goal.id,
      title: '完成 API 契约测试',
      priority: 0.7,
      progress: 0.5,
      dueAt: '2027-01-01',
    });
    const updatedGoal = expectData(updated, 'goals update');
    assert.equal(updatedGoal.title, '完成 API 契约测试');
    assert.equal(updatedGoal.priority, 0.7);
    assert.equal(updatedGoal.progress, 0.5);
    assert.equal(updatedGoal.status, 'active');
    assert.equal(updatedGoal.dueAt, '2026-12-01', 'goals/update does not accept dueAt');

    const unknown = await post(handler, '/goals/update', { id: 'gol_missing' });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.json.ok, true);
    assert.equal(unknown.json.data, null);

    const completed = await post(handler, '/goals/complete', { id: goal.id });
    const completedGoal = expectData(completed, 'goals complete');
    assert.equal(completedGoal.status, 'completed');
    assert.equal(completedGoal.progress, 1);

    const active = expectData(await invokeApi(handler, { route: '/goals?status=active' }), 'goals active');
    assert.equal(active.some((entry) => entry.id === goal.id), false);
    const done = expectData(await invokeApi(handler, { route: '/goals?status=completed' }), 'goals completed');
    assert.ok(done.some((entry) => entry.id === goal.id));
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 8. POST: emotion and life
// ---------------------------------------------------------------------------

test('POST /emotion/record detects emotions, updates affect, and tolerates neutral text', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const recorded = await post(handler, '/emotion/record', {
      text: '本鲸很喜欢主人，也很心疼主人。',
      target: '主人',
    });
    const recordData = expectData(recorded, 'emotion record');
    assert.ok(Array.isArray(recordData.emotions));
    assert.ok(recordData.emotions.length >= 1);
    assert.equal(typeof recordData.event, 'object');
    assert.equal(recordData.event.target, '主人');
    assert.equal(typeof recordData.target, 'object');
    assert.equal(recordData.target.name, '主人');
    assert.equal(typeof recordData.target.attitude, 'string');
    assertInteger(recordData.target.count, 'emotion.count', { min: 1 });
    assertIso(recordData.event.at, 'emotion.event.at');

    const defaultTarget = await post(handler, '/emotion/record', { text: '主人今天很开心。' });
    const defaultData = expectData(defaultTarget, 'emotion default target');
    assert.equal(defaultData.event.target, '主人');

    const neutral = await post(handler, '/emotion/record', { text: '今天是星期三。' });
    const neutralData = expectData(neutral, 'emotion neutral');
    assert.deepEqual(neutralData.emotions, []);
    assert.equal(neutralData.top, null);
    assert.equal(neutralData.event, null);
    assert.equal(neutralData.target, null);

    const empty = await post(handler, '/emotion/record', {});
    const emptyData = expectData(empty, 'emotion empty');
    assert.equal(emptyData.event, null);
    assert.equal(emptyData.text, '');

    const status = expectData(await invokeApi(handler, { route: '/emotion' }), 'emotion status');
    assert.ok(status.targets.some((target) => target.target === '主人'));
    assert.ok(status.events.length >= 2);
  } finally {
    cleanup(context);
  }
});

test('POST /life/* writes diary, dreams and a sleep report', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    writeTrace(cortex, '今天把生命循环接上了。', { title: '生命循环' });

    expectError(await post(handler, '/life/diary', {}), {
      label: 'diary missing text',
      match: /text/,
    });
    const diary = await post(handler, '/life/diary', { text: '今天补契约测试。', mood: '踏实' });
    const diaryData = expectData(diary, 'life diary');
    assert.equal(typeof diaryData.id, 'string');
    assert.equal(diaryData.scopeId, 'global');
    assert.equal(diaryData.text, '今天补契约测试。');
    assert.equal(diaryData.mood, '踏实');
    assert.equal(diaryData.source, 'user');
    assertIso(diaryData.at, 'diary.at');

    const dream = await post(handler, '/life/dream', {});
    const dreamData = expectData(dream, 'life dream');
    assert.equal(typeof dreamData.id, 'string');
    assert.equal(typeof dreamData.text, 'string');
    assert.equal(typeof dreamData.model, 'string');
    assertInteger(dreamData.sourceCount, 'dream.sourceCount', { min: 0 });
    assertIso(dreamData.at, 'dream.at');

    const sleep = await post(handler, '/life/sleep', { windowDays: 1 });
    const sleepData = expectData(sleep, 'life sleep');
    assert.equal(typeof sleepData.id, 'string');
    assert.equal(sleepData.scopeId, 'global');
    assertIso(sleepData.at, 'sleep.at');
    assertInteger(sleepData.purgedWorking, 'sleep.purgedWorking', { min: 0 });
    assertInteger(sleepData.reflected, 'sleep.reflected', { min: 0 });
    assert.ok(sleepData.stage === null || typeof sleepData.stage === 'string');
    assertInteger(sleepData.affectTargets, 'sleep.affectTargets', { min: 0 });

    const life = expectData(await invokeApi(handler, { route: '/life' }), 'life overview');
    assert.ok(life.diary.some((entry) => entry.id === diaryData.id));
    assert.ok(life.dreams.some((entry) => entry.id === dreamData.id));
    assert.ok(life.sleeps.some((entry) => entry.id === sleepData.id));
    assert.equal(life.sleeps.find((entry) => entry.id === sleepData.id).report.at, sleepData.at);
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 9. Security invariants
// ---------------------------------------------------------------------------

test('security: origin, peer and token checks reject untrusted requests', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const crossOrigin = await invokeApi(handler, {
      route: '/ping',
      headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expectError(crossOrigin, { status: 403, label: 'cross-origin', match: /forbidden/ });

    const crossSite = await invokeApi(handler, {
      route: '/ping',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expectError(crossSite, { status: 403, label: 'cross-site', match: /forbidden/ });

    const hostMismatch = await invokeApi(handler, {
      route: '/ping',
      headers: { origin: 'http://127.0.0.1:9999' },
    });
    expectError(hostMismatch, { status: 403, label: 'origin/host mismatch', match: /forbidden/ });

    const remote = await invokeApi(handler, { route: '/ping', remoteAddress: '10.0.0.5' });
    expectError(remote, { status: 403, label: 'non-loopback peer', match: /forbidden/ });

    const noHost = await invokeApi(handler, { route: '/ping', host: '' });
    expectError(noHost, { status: 403, label: 'empty host', match: /forbidden/ });

    const noOrigin = await invokeApi(handler, { route: '/health', origin: undefined });
    expectData(noOrigin, 'loopback without origin');

    const noToken = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '没有令牌的写入。', explicit: true },
    });
    expectError(noToken, { status: 403, label: 'missing x-cortex', match: /x-cortex/ });

    const wrongToken = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '错误令牌的写入。', explicit: true },
      headers: { 'x-cortex': 'true' },
    });
    expectError(wrongToken, { status: 403, label: 'wrong x-cortex', match: /x-cortex/ });

    const getWithoutToken = await invokeApi(handler, { route: '/health' });
    expectData(getWithoutToken, 'GET does not need x-cortex');
  } finally {
    cleanup(context);
  }
});

test('security: malformed, non-object and oversized bodies are rejected with 400', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    for (const raw of ['{"text":', '[]', 'null', '42', '"a string"', 'true']) {
      const result = await invokeRaw(handler, { raw });
      expectError(result, {
        label: `malformed body ${raw}`,
        match: /invalid json body/,
      });
    }

    const oversized = await invokeRaw(handler, {
      raw: JSON.stringify({ text: 'x'.repeat(300_000), explicit: true }),
    });
    expectError(oversized, { label: 'oversized body', match: /invalid json body/ });

    const valid = await post(handler, '/write', { text: '坏请求之后仍能写入。', explicit: true });
    expectData(valid, 'write after bad bodies');
    assert.equal(cortex.repos.traces.count(), 1);
  } finally {
    cleanup(context);
  }
});

test('security: invalid fields return 400 instead of mutating state', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const cases = [
      ['/write', { text: '' }, /text/],
      ['/write', { text: 'x', importance: 2 }, /importance/],
      ['/write', { text: 'x', tags: [1] }, /tags/],
      ['/write', { text: 'x', explicit: 'yes' }, /explicit/],
      ['/write', { items: [{ text: 'ok' }, null] }, /text|Cannot read/],
      ['/search', { query: 'x', limit: 99 }, /limit/],
      ['/search', { query: 'x', budget: 10 }, /budget/],
      ['/feedback', { signal: 'used' }, /id/],
      ['/forget', { id: 'trc_x', mode: 'purge' }, /mode/],
      ['/guard/validate', {}, /file/],
      ['/guard/restore', { file: 'x' }, /target/],
      ['/guard/export', {}, /dir/],
      ['/qa', {}, /question/],
      ['/evolve/propose', {}, /kind/],
      ['/working/add', {}, /text/],
      ['/goals/add', {}, /title/],
    ];
    for (const [route, body, match] of cases) {
      const result = await post(handler, route, body);
      expectError(result, { label: `${route} invalid ${JSON.stringify(body)}`, match });
    }
    assert.equal(cortex.repos.traces.count(), 0, 'invalid fields must not write traces');
  } finally {
    cleanup(context);
  }
});

test('security: unknown routes, wrong methods, OPTIONS and HEAD are handled predictably', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const unknownGet = await invokeApi(handler, { route: '/does-not-exist' });
    expectError(unknownGet, { status: 404, label: 'unknown GET', match: /not found/ });

    const unknownPost = await post(handler, '/does-not-exist', {});
    expectError(unknownPost, { status: 404, label: 'unknown POST', match: /not found/ });

    const unknownPostNoToken = await invokeApi(handler, {
      method: 'POST',
      route: '/does-not-exist',
      body: {},
    });
    expectError(unknownPostNoToken, {
      status: 403,
      label: 'unknown POST without token is rejected before routing',
      match: /x-cortex/,
    });

    for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const response = await invokeApi(handler, { method, route: '/write' });
      assert.equal(response.status, 405, `${method} should be rejected`);
      assert.equal(response.headers.allow, 'GET, HEAD, POST', `${method} advertises allowed methods`);
      assert.deepEqual(response.json, {}, `${method} has no JSON body`);
    }

    const headHealth = await invokeApi(handler, { method: 'HEAD', route: '/health' });
    const headData = expectData(headHealth, 'HEAD /health');
    assert.equal(typeof headData.score, 'number');

    const headUnknown = await invokeApi(handler, { method: 'HEAD', route: '/does-not-exist' });
    expectError(headUnknown, { status: 404, label: 'HEAD unknown route' });
  } finally {
    cleanup(context);
  }
});

// ---------------------------------------------------------------------------
// 10. Scope precedence and isolation
// ---------------------------------------------------------------------------

test('scope: header > query > body on POST write and POST search', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const byHeader = await post(
      handler,
      '/write?scope=query-scope',
      { text: 'header 作用域优先。', explicit: true, scopeId: 'body-scope' },
      { 'x-cortex-scope': 'header-scope' },
    );
    const headerTrace = expectData(byHeader, 'scope write header');
    assert.equal(headerTrace.trace.scopeId, 'header-scope');

    const searchByHeader = await post(
      handler,
      '/search?scope=query-scope',
      { query: 'header 作用域', scopeId: 'body-scope' },
      { 'x-cortex-scope': 'header-scope' },
    );
    const headerSearch = expectData(searchByHeader, 'scope search header');
    assert.equal(headerSearch.scopeId, 'header-scope');
    assert.ok(headerSearch.items.some((item) => item.id === headerTrace.trace.id));

    const byQuery = await post(handler, '/write?scope=query-scope', {
      text: 'query 作用域优先。',
      explicit: true,
      scopeId: 'body-scope',
    });
    const queryTrace = expectData(byQuery, 'scope write query');
    assert.equal(queryTrace.trace.scopeId, 'query-scope');

    const searchByQuery = await post(handler, '/search?scope=query-scope', {
      query: 'query 作用域',
      scopeId: 'body-scope',
    });
    const querySearch = expectData(searchByQuery, 'scope search query');
    assert.equal(querySearch.scopeId, 'query-scope');
    assert.ok(querySearch.items.some((item) => item.id === queryTrace.trace.id));

    const byBody = await post(handler, '/write', {
      text: 'body 作用域优先。',
      explicit: true,
      scopeId: 'body-scope',
    });
    const bodyTrace = expectData(byBody, 'scope write body');
    assert.equal(bodyTrace.trace.scopeId, 'body-scope');

    const searchByBody = await post(handler, '/search', {
      query: 'body 作用域',
      scopeId: 'body-scope',
    });
    const bodySearch = expectData(searchByBody, 'scope search body');
    assert.equal(bodySearch.scopeId, 'body-scope');
    assert.ok(bodySearch.items.some((item) => item.id === bodyTrace.trace.id));

    const getByHeader = expectData(
      await invokeApi(handler, {
        route: '/search?q=header&scope=query-scope',
        headers: { 'x-cortex-scope': 'header-scope' },
      }),
      'scope GET search header',
    );
    assert.equal(getByHeader.scopeId, 'header-scope');

    const self = expectData(
      await invokeApi(handler, { route: '/self?scope=query-scope', headers: { 'x-cortex-scope': 'header-scope' } }),
      'scope self header',
    );
    assert.equal(self.self.scopeId, 'header-scope');
  } finally {
    cleanup(context);
  }
});

test('scope: search results and working/goals lists stay inside their scope', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });
    const scoped = await post(
      handler,
      '/write',
      { text: 's2 独有的作用域记忆。', explicit: true },
      { 'x-cortex-scope': 's2' },
    );
    const scopedTrace = expectData(scoped, 'scope s2 write');
    assert.equal(scopedTrace.trace.scopeId, 's2');

    const s2Search = expectData(
      await invokeApi(handler, { route: '/search?q=作用域&scope=s2' }),
      'scope s2 search',
    );
    assert.ok(s2Search.items.some((item) => item.id === scopedTrace.trace.id));
    assert.equal(
      s2Search.items.every((item) => cortex.get(item.id)?.scopeId === 's2'),
      true,
      's2 search must not leak global traces',
    );

    const globalSearch = expectData(
      await invokeApi(handler, { route: '/search?q=作用域&scope=global' }),
      'scope global search',
    );
    assert.equal(globalSearch.items.some((item) => item.id === scopedTrace.trace.id), false);

    const s2Working = await post(
      handler,
      '/working/add',
      { text: 's2 焦点' },
      { 'x-cortex-scope': 's2' },
    );
    const workingItem = expectData(s2Working, 'scope s2 working');
    assert.equal(workingItem.scopeId, 's2');

    const s2Goals = await post(
      handler,
      '/goals/add',
      { title: 's2 目标' },
      { 'x-cortex-scope': 's2' },
    );
    const goalItem = expectData(s2Goals, 'scope s2 goals');
    assert.equal(goalItem.scopeId, 's2');

    const globalWorking = expectData(await invokeApi(handler, { route: '/working' }), 'global working');
    assert.equal(globalWorking.some((item) => item.id === workingItem.id), false);
    const s2WorkingList = expectData(
      await invokeApi(handler, { route: '/working?scope=s2' }),
      's2 working list',
    );
    assert.ok(s2WorkingList.some((item) => item.id === workingItem.id));

    const globalGoals = expectData(await invokeApi(handler, { route: '/goals' }), 'global goals');
    assert.equal(globalGoals.some((item) => item.id === goalItem.id), false);
    const s2GoalList = expectData(await invokeApi(handler, { route: '/goals?scope=s2' }), 's2 goal list');
    assert.ok(s2GoalList.some((item) => item.id === goalItem.id));

    const batch = await post(handler, '/write', {
      items: [
        { text: '批量里的 s3 记忆。', explicit: true, scopeId: 's3' },
        { text: '批量里的默认记忆。', explicit: true },
      ],
    });
    const batchData = expectData(batch, 'scope batch');
    assert.equal(batchData[0].trace.scopeId, 's3');
    assert.equal(batchData[1].trace.scopeId, 'global');
  } finally {
    cleanup(context);
  }
});
