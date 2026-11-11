import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../../src/api/routes.js';
import { BASE_MS, DAY_MS, cleanup, invokeApi, makeCortex } from './_helpers.js';

function idsOf(result) {
  return result.items.map((item) => item.id).sort();
}

test('policy propose -> approve -> live retrieval budget -> rollback', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    // No policy is active yet: the request budget wins.
    assert.equal(cortex.policies.active('retrieval'), null);
    assert.equal(cortex.search('anything', { budget: 9_999 }).budget.total, 9_999);

    const tight = cortex.evolution.propose({
      kind: 'retrieval',
      config: { budget: 300 },
      rationale: 'first policy',
      metrics: { note: 'integration' },
    });
    const roomy = cortex.evolution.propose({
      kind: 'retrieval',
      config: { budget: 900 },
      rationale: 'second policy',
    });
    assert.equal(tight.status, 'candidate');
    assert.equal(tight.version, 1);
    assert.equal(roomy.status, 'candidate');
    assert.equal(roomy.version, 2);
    assert.equal(cortex.policies.list({ kind: 'retrieval' }).length, 2);
    assert.equal(cortex.policies.active('retrieval'), null);

    const activatedTight = cortex.evolution.approve(tight.id);
    assert.equal(activatedTight.id, tight.id);
    assert.equal(activatedTight.status, 'active');
    assert.ok(Number.isFinite(Date.parse(activatedTight.activatedAt)));
    assert.equal(cortex.search('anything', { budget: 9_999 }).budget.total, 300);
    assert.equal(cortex.evolution.status().active.retrieval.id, tight.id);

    const activatedRoomy = cortex.evolution.approve(roomy.id);
    assert.equal(activatedRoomy.status, 'active');
    assert.equal(cortex.policies.get(tight.id).status, 'superseded');
    assert.equal(cortex.search('anything', { budget: 9_999 }).budget.total, 900);

    // Rollback by explicit target restores the earlier version.
    const rolledBack = cortex.evolution.rollback('retrieval', tight.id);
    assert.equal(rolledBack.id, tight.id);
    assert.equal(rolledBack.status, 'active');
    assert.equal(cortex.policies.get(roomy.id).status, 'superseded');
    assert.equal(cortex.search('anything', { budget: 9_999 }).budget.total, 300);

    // Rollback without a target picks the newest non-active version.
    const implicitRollback = cortex.evolution.rollback('retrieval');
    assert.equal(implicitRollback.id, roomy.id);
    assert.equal(cortex.search('anything', { budget: 9_999 }).budget.total, 900);
    const status = cortex.evolution.status();
    assert.equal(status.active.retrieval.id, roomy.id);
    assert.equal(status.active.maintenance, null);

    const audit = cortex.repos.audit.list({ limit: 50 });
    const actions = audit.map((entry) => entry.action);
    assert.ok(actions.includes('policy.propose'));
    assert.ok(actions.includes('policy.activate'));
    assert.ok(actions.includes('policy.rollback'));
    assert.equal(audit.filter((entry) => entry.action === 'policy.propose').length, 2);

    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});

test('query filter syntax (kind:, tag:, after:/before:, importance:>) flows through cortex.search', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const oldDecision = cortex.write({
      text: '过滤测试：重要的决定。',
      kind: 'decision',
      tags: ['过滤', '旧'],
      importance: 0.6,
      explicit: true,
      now: BASE_MS - 40 * DAY_MS,
    });
    const recentChat = cortex.write({
      text: '过滤测试：普通对话。',
      kind: 'utterance',
      tags: ['过滤'],
      importance: 0.9,
      explicit: true,
      now: BASE_MS - 2 * DAY_MS,
    });
    const newDecision = cortex.write({
      text: '过滤测试：另一个决定。',
      kind: 'decision',
      tags: ['过滤'],
      importance: 0.6,
      explicit: true,
      now: BASE_MS - DAY_MS,
    });
    const all = [oldDecision.trace.id, recentChat.trace.id, newDecision.trace.id];

    const baseline = cortex.search('过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(baseline), [...all].sort());
    assert.equal(baseline.query, '过滤测试');
    assert.equal(baseline.intent, 'fact');

    const byKind = cortex.search('kind:decision 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(byKind), [oldDecision.trace.id, newDecision.trace.id].sort());
    assert.equal(byKind.query, '过滤测试'); // the filter token is not free text

    const byTag = cortex.search('tag:旧 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(byTag), [oldDecision.trace.id]);
    const byBothTags = cortex.search('tag:过滤 tag:旧 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(byBothTags), [oldDecision.trace.id]);
    const missingTag = cortex.search('tag:不存在 过滤测试', { now: BASE_MS, limit: 10 });
    assert.equal(missingTag.items.length, 0);

    const after = cortex.search('after:2026-11-01 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(after), [recentChat.trace.id, newDecision.trace.id].sort());
    const before = cortex.search('before:2026-11-05 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(before), [oldDecision.trace.id]);

    const important = cortex.search('importance:>0.8 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(important), [recentChat.trace.id]);
    const lessImportant = cortex.search('importance:<=0.8 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(lessImportant), [oldDecision.trace.id, newDecision.trace.id].sort());

    const combined = cortex.search('kind:decision tag:过滤 after:2026-11-01 过滤测试', { now: BASE_MS, limit: 10 });
    assert.deepEqual(idsOf(combined), [newDecision.trace.id]);

    const noMatch = cortex.search('kind:reflection 过滤测试', { now: BASE_MS, limit: 10 });
    assert.equal(noMatch.items.length, 0);
    const invalidImportance = cortex.search('importance:>abc 过滤测试', { now: BASE_MS, limit: 10 });
    assert.equal(invalidImportance.items.length, 0);

    // Unknown prefixes are not filters and stay in the free-text query.
    const unknown = cortex.search('unknown:value 过滤测试', { now: BASE_MS, limit: 10 });
    assert.equal(unknown.query, 'unknown:value 过滤测试');
    assert.ok(unknown.items.length >= 1);

    // state: combines with includeArchived instead of hiding the fact that an
    // archived trace is still in the database.
    assert.equal(cortex.forget({ traceId: oldDecision.trace.id, mode: 'archive' }).removed, true);
    assert.equal(cortex.get(oldDecision.trace.id).state, 'archived');
    const activeOnly = cortex.search('state:archived 过滤测试', { now: BASE_MS, limit: 10 });
    assert.equal(activeOnly.items.length, 0);
    const withArchived = cortex.search('state:archived 过滤测试', { now: BASE_MS, limit: 10, includeArchived: true });
    assert.deepEqual(idsOf(withArchived), [oldDecision.trace.id]);

    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});

test('API security: loopback same-origin allowed, cross-origin and unsafe POSTs refused', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const handler = createApiHandler({ cortex });

    const ping = await invokeApi(handler);
    assert.equal(ping.status, 200);
    assert.equal(ping.json.ok, true);
    assert.ok(Number.isFinite(Date.parse(ping.json.at)));
    assert.match(ping.headers['content-type'], /application\/json/);

    const head = await invokeApi(handler, { method: 'HEAD', route: '/ping' });
    assert.equal(head.status, 200);
    assert.equal(head.json.ok, true);

    const health = await invokeApi(handler, { route: '/health' });
    assert.equal(health.status, 200);
    assert.ok(health.json.data.score > 0);

    const missingTrace = await invokeApi(handler, { route: '/trace?id=trc_missing' });
    assert.equal(missingTrace.status, 404);
    assert.equal(missingTrace.json.ok, false);

    // Browser cross-origin requests are refused even on loopback.
    const crossOrigin = await invokeApi(handler, {
      route: '/ping',
      headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.json.error, 'forbidden');

    const sameSite = await invokeApi(handler, { route: '/ping', site: 'same-site' });
    assert.equal(sameSite.status, 403);

    // Non-loopback peer addresses are refused regardless of headers.
    const remote = await invokeApi(handler, { route: '/ping', remoteAddress: '203.0.113.7' });
    assert.equal(remote.status, 403);

    // A loopback-looking Host header without an origin is accepted; a
    // non-loopback Host header is not.
    const noOrigin = await invokeApi(handler, { route: '/ping', origin: undefined });
    assert.equal(noOrigin.status, 200);
    const badHost = await invokeApi(handler, { route: '/ping', headers: { host: 'evil.example' } });
    assert.equal(badHost.status, 403);
    const missingHost = await invokeApi(handler, { route: '/ping', headers: { host: undefined } });
    assert.equal(missingHost.status, 403);

    // POST needs the CSRF-style header before anything is read or written.
    const noHeader = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '没有 x-cortex 的写入。', explicit: true },
    });
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.json.error, 'missing x-cortex header');
    assert.equal(cortex.repos.traces.count(), 0);

    const crossPost = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '跨域写入。', explicit: true },
      headers: { 'x-cortex': '1', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossPost.status, 403);
    assert.equal(cortex.repos.traces.count(), 0);

    // A proper same-origin POST writes, and the trace is then readable by GET.
    const write = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '主人说会买白饭。', title: '白饭', explicit: true },
      headers: { 'x-cortex': '1' },
    });
    assert.equal(write.status, 200);
    assert.equal(write.json.ok, true);
    assert.equal(write.json.data.skipped, false);
    const traceId = write.json.data.trace.id;
    assert.ok(traceId);

    const trace = await invokeApi(handler, { route: `/trace?id=${traceId}` });
    assert.equal(trace.status, 200);
    assert.equal(trace.json.data.id, traceId);
    assert.equal(trace.json.data.content, '主人说会买白饭。');
    assert.equal(trace.json.data.title, '白饭');

    const search = await invokeApi(handler, { route: '/search?q=白饭' });
    assert.equal(search.status, 200);
    assert.ok(search.json.data.items.some((item) => item.id === traceId));

    // Body validation returns 400 rather than a corrupt write.
    const invalidWrite = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: { title: '没有正文' },
      headers: { 'x-cortex': '1' },
    });
    assert.equal(invalidWrite.status, 400);
    assert.match(invalidWrite.json.error, /text/);
    assert.equal(cortex.repos.traces.count(), 1);

    const invalidSearch = await invokeApi(handler, {
      method: 'POST',
      route: '/search',
      body: { limit: 5 },
      headers: { 'x-cortex': '1' },
    });
    assert.equal(invalidSearch.status, 400);

    // Batch writes are validated per item and remain idempotent through the API.
    const batchBody = {
      items: [
        { text: '批量 API 第一条。', explicit: true, operationId: 'api-batch:1' },
        { text: '批量 API 第二条。', explicit: true, operationId: 'api-batch:2' },
      ],
    };
    const batch = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: batchBody,
      headers: { 'x-cortex': '1' },
    });
    assert.equal(batch.status, 200);
    assert.equal(batch.json.data.length, 2);
    assert.equal(cortex.repos.traces.count(), 3);
    const replayedBatch = await invokeApi(handler, {
      method: 'POST',
      route: '/write',
      body: batchBody,
      headers: { 'x-cortex': '1' },
    });
    assert.equal(replayedBatch.status, 200);
    assert.equal(replayedBatch.json.data.every((item) => item.skipped === true), true);
    assert.equal(cortex.repos.traces.count(), 3);

    // Unsupported methods are rejected with an Allow header.
    const method = await invokeApi(handler, { method: 'DELETE', route: '/write' });
    assert.equal(method.status, 405);
    assert.equal(method.headers.allow.includes('GET'), true);

    const guard = await invokeApi(handler, { route: '/guard' });
    assert.equal(guard.status, 200);
    assert.equal(guard.json.data.ok, true);
  } finally {
    cleanup(context);
  }
});
