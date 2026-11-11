import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError, API_BASE } from '../../src/api/client.js';

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function ok(data) {
  return json({ ok: true, data });
}

function harness(options = {}) {
  const calls = [];
  const queue = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (queue.length === 0) throw new Error(`unexpected fetch: ${url}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  const client = createApiClient({ fetchImpl, ...options });
  return { client, calls, queue };
}

function parseBody(call) {
  assert.equal(typeof call.init.body, 'string');
  return JSON.parse(call.init.body);
}

function pathOf(call) {
  return new URL(call.url).pathname;
}

test('default base URL targets /api/cortex and unwraps the ping envelope', async () => {
  const { client, calls, queue } = harness();
  const at = '2026-11-11T00:00:00.000Z';
  queue.push(json({ ok: true, at }));

  const result = await client.ping();

  assert.deepEqual(result, { ok: true, at });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:7430/api/cortex/ping');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers['x-cortex'], undefined);
});

test('base URL joining preserves paths and never creates a double slash', async () => {
  const cases = [
    ['http://127.0.0.1:9100/', '/api/cortex/ping'],
    ['http://127.0.0.1:9100/api/cortex', '/api/cortex/ping'],
    ['http://127.0.0.1:9100/api/cortex/', '/api/cortex/ping'],
    ['http://127.0.0.1:9100/proxy/', '/proxy/api/cortex/ping'],
  ];

  for (const [baseUrl, expected] of cases) {
    const { client, calls, queue } = harness({ baseUrl });
    queue.push(json({ ok: true, at: '2026-11-11T00:00:00.000Z' }));
    await client.ping();
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, expected, baseUrl);
    assert.ok(!url.pathname.includes('//'), `double slash in ${url.pathname}`);
  }
});

test('baseUrl and fetchImpl are validated up front', () => {
  assert.throws(() => createApiClient({ baseUrl: 'not a url' }), /absolute http/);
  assert.throws(() => createApiClient({ baseUrl: 'ftp://127.0.0.1:7430' }), /http or https/);
  assert.throws(() => createApiClient({ fetchImpl: null }), /fetchImpl/);
});

test('simple GET methods map to their exact routes and return data', async () => {
  const { client, calls, queue } = harness();
  const methods = [
    ['health', '/health'],
    ['self', '/self'],
    ['stats', '/stats'],
    ['settings', '/settings'],
    ['metrics', '/metrics'],
    ['graph', '/graph'],
    ['retention', '/retention'],
    ['skills', '/skills'],
  ];

  for (const [method, route] of methods) {
    queue.push(ok({ method }));
    const result = await client[method]();
    assert.deepEqual(result, { method });
    const call = calls.at(-1);
    assert.equal(call.init.method, 'GET');
    assert.equal(pathOf(call), `${API_BASE}${route}`);
  }
  assert.equal(calls.length, methods.length);
});

test('GET search sends q, limit and budget as query parameters', async () => {
  const { client, calls, queue } = harness();
  queue.push(ok({ items: [{ id: 't1' }] }));

  const result = await client.search('白 饭', { limit: 3, budget: 1500 });

  assert.equal(result.items[0].id, 't1');
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/api/cortex/search');
  assert.equal(url.searchParams.get('q'), '白 饭');
  assert.equal(url.searchParams.get('limit'), '3');
  assert.equal(url.searchParams.get('budget'), '1500');
});

test('GET search omits unset optional parameters', async () => {
  const { client, calls, queue } = harness();
  queue.push(ok({ items: [] }));

  await client.search('only-query');

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('q'), 'only-query');
  assert.equal(url.searchParams.has('limit'), false);
  assert.equal(url.searchParams.has('budget'), false);
});

test('trace, timeline, audit and goals list build their query strings', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok({ id: 'trace with space' }));
  await client.trace('trace with space');
  let url = new URL(calls.at(-1).url);
  assert.equal(url.pathname, '/api/cortex/trace');
  assert.equal(url.searchParams.get('id'), 'trace with space');

  queue.push(ok({ anchor: null, items: [] }));
  await client.timeline('t1', { before: 0, after: 7 });
  url = new URL(calls.at(-1).url);
  assert.equal(url.pathname, '/api/cortex/timeline');
  assert.equal(url.searchParams.get('id'), 't1');
  assert.equal(url.searchParams.get('before'), '0');
  assert.equal(url.searchParams.get('after'), '7');

  queue.push(ok([]));
  await client.audit({ limit: 25 });
  url = new URL(calls.at(-1).url);
  assert.equal(url.pathname, '/api/cortex/audit');
  assert.equal(url.searchParams.get('limit'), '25');

  queue.push(ok([]));
  await client.goals('list', { status: 'active' });
  url = new URL(calls.at(-1).url);
  assert.equal(url.pathname, '/api/cortex/goals');
  assert.equal(url.searchParams.get('status'), 'active');

  queue.push(ok([]));
  await client.audit();
  assert.equal(new URL(calls.at(-1).url).searchParams.has('limit'), false);
});

test('POST write sends JSON, x-cortex and the exact body', async () => {
  const { client, calls, queue } = harness();
  queue.push(ok({ trace: { id: 'tr1' } }));

  const input = { text: '主人说会买白饭。', tags: ['白饭'], explicit: true };
  const result = await client.write(input);

  assert.deepEqual(result, { trace: { id: 'tr1' } });
  const call = calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal(pathOf(call), '/api/cortex/write');
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.equal(call.init.headers['x-cortex'], '1');
  assert.deepEqual(parseBody(call), input);
});

test('custom tokenHeader is sent as the x-cortex value', async () => {
  const { client, calls, queue } = harness({ tokenHeader: '2' });
  queue.push(ok({ trace: { id: 'tr2' } }));

  await client.write({ text: 'x' });

  assert.equal(calls[0].init.headers['x-cortex'], '2');
});

test('scopeId is sent on every request and validated', async () => {
  const { client, calls, queue } = harness({ scopeId: 'session:42' });
  queue.push(ok({ items: [] }));
  await client.search('白饭');
  assert.equal(calls[0].init.headers['x-cortex-scope'], 'session:42');
  assert.throws(() => createApiClient({ fetchImpl: async () => new Response('{}'), scopeId: 'bad scope' }), /scopeId/);
});

test('writeMany wraps items in the documented batch body', async () => {
  const { client, calls, queue } = harness();
  const items = [{ text: 'a' }, { text: 'b' }];
  queue.push(ok([{ trace: { id: 'a' } }, { trace: { id: 'b' } }]));

  const result = await client.writeMany(items);

  assert.equal(result.length, 2);
  assert.deepEqual(parseBody(calls[0]), { items });
  assert.equal(pathOf(calls[0]), '/api/cortex/write');
});

test('feedback, forget, reflect and compress send only supported fields', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok({ updated: true }));
  await client.feedback({ id: 't1', signal: 'used', predicted: 0.75, outcome: 1, ignored: 'x' });
  assert.deepEqual(parseBody(calls.at(-1)), { id: 't1', signal: 'used', predicted: 0.75, outcome: 1 });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/feedback');

  queue.push(ok({ archived: true }));
  await client.forget({ id: 't1' });
  assert.deepEqual(parseBody(calls.at(-1)), { id: 't1' });

  queue.push(ok({ archived: true }));
  await client.forget({ id: 't2', mode: 'delete' });
  assert.deepEqual(parseBody(calls.at(-1)), { id: 't2', mode: 'delete' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/forget');

  queue.push(ok({ refreshed: true }));
  await client.reflect();
  assert.deepEqual(parseBody(calls.at(-1)), {});

  queue.push(ok({ refreshed: true }));
  await client.reflect({ windowDays: 3, force: true });
  assert.deepEqual(parseBody(calls.at(-1)), { windowDays: 3, force: true });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/reflect');

  queue.push(ok({ archived: 0 }));
  await client.compress({ limit: 10 });
  assert.deepEqual(parseBody(calls.at(-1)), { limit: 10 });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/compress');

  queue.push(ok({ archived: 0 }));
  await client.compress();
  assert.deepEqual(parseBody(calls.at(-1)), {});

  queue.push(ok({ answer: '白饭 [1]', mode: 'extractive' }));
  await client.qa({ question: '主人喜欢什么？' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/qa');
  assert.deepEqual(parseBody(calls.at(-1)), { question: '主人喜欢什么？' });
});

test('guard maps check, backup and repair to the real routes', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok({ issues: [] }));
  await client.guard();
  assert.equal(calls.at(-1).init.method, 'GET');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/guard');

  queue.push(ok({ path: 'C:/backup.sqlite' }));
  await client.guard('backup', { file: 'C:/backup.sqlite', target: 'ignored', dir: 'ignored' });
  assert.equal(calls.at(-1).init.method, 'POST');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/guard/backup');
  assert.deepEqual(parseBody(calls.at(-1)), { file: 'C:/backup.sqlite' });

  queue.push(ok({ before: 1, after: 1, reindexed: 1 }));
  await client.guard('repair');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/guard/repair');
  assert.deepEqual(parseBody(calls.at(-1)), {});

  queue.push(ok({ total: 0, removed: [] }));
  await client.guard('prune', { dir: 'C:/tmp/backups', retain: 3, dryRun: true });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/guard/prune');
  assert.deepEqual(parseBody(calls.at(-1)), { dir: 'C:/tmp/backups', retain: 3, dryRun: true });

  queue.push(ok({ facts: [] }));
  await client.asOf({ subject: '主人', mode: 'historical', asOf: '2026-11-10T00:00:00Z' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/as-of');
  assert.match(calls.at(-1).url, /subject=/);
  assert.match(calls.at(-1).url, /asOf=/);

  queue.push(ok({ ok: true }));
  await client.guard('validate', { file: 'C:/backup.sqlite', target: 'ignored' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/guard/validate');
  assert.deepEqual(parseBody(calls.at(-1)), { file: 'C:/backup.sqlite' });

  queue.push(ok({ restored: true }));
  await client.guard('restore', { file: 'C:/backup.sqlite', target: 'C:/restored.sqlite' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/guard/restore');
  assert.deepEqual(parseBody(calls.at(-1)), { file: 'C:/backup.sqlite', target: 'C:/restored.sqlite' });

  queue.push(ok({ root: 'C:/mirror' }));
  await client.guard('export', { dir: 'C:/mirror', file: 'ignored' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/guard/export');
  assert.deepEqual(parseBody(calls.at(-1)), { dir: 'C:/mirror' });

  const before = calls.length;
  assert.throws(() => client.guard('nonsense'), /guard action/);
  assert.equal(calls.length, before);
});

test('evolve maps status, optimize, approve and rollback', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok({ candidates: [] }));
  await client.evolve();
  assert.equal(calls.at(-1).init.method, 'GET');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/evolution');

  queue.push(ok({ proposals: [] }));
  await client.evolve('optimize');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/evolve/optimize');
  assert.deepEqual(parseBody(calls.at(-1)), {});

  queue.push(ok({ id: 'p1' }));
  await client.evolve('approve', { id: 'p1', config: { ignored: true }, rationale: 'ignored' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/evolve/approve');
  assert.deepEqual(parseBody(calls.at(-1)), { id: 'p1' });

  queue.push(ok({ id: 'p0' }));
  await client.evolve('rollback', { kind: 'retrieval', id: 'p0', config: { ignored: true } });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/evolve/rollback');
  assert.deepEqual(parseBody(calls.at(-1)), { kind: 'retrieval', id: 'p0' });

  queue.push(ok({ id: 'p2' }));
  await client.evolve('propose', { kind: 'retrieval', config: { budget: 400 }, rationale: 'try' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/evolve/propose');
  assert.deepEqual(parseBody(calls.at(-1)), { kind: 'retrieval', config: { budget: 400 }, rationale: 'try' });

  const before = calls.length;
  assert.throws(() => client.evolve('nonsense'), /evolve action/);
  assert.equal(calls.length, before);
});

test('working actions use list/add/update/remove and the update-based pin', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok([]));
  await client.working();
  assert.equal(calls.at(-1).init.method, 'GET');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/working');

  queue.push(ok({ id: 'w1' }));
  await client.working('add', { text: '写测试', kind: 'focus', priority: 0.9, pinned: true, ttlMs: 60000 });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/working/add');
  assert.deepEqual(parseBody(calls.at(-1)), { text: '写测试', kind: 'focus', priority: 0.9, pinned: true, ttlMs: 60000 });

  queue.push(ok({ id: 'w1' }));
  await client.working('update', { id: 'w1', text: '改', priority: 0.4, pinned: false });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/working/update');
  assert.deepEqual(parseBody(calls.at(-1)), { id: 'w1', text: '改', priority: 0.4, pinned: false });

  queue.push(ok({ removed: true }));
  await client.working('remove', { id: 'w1' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/working/remove');
  assert.deepEqual(parseBody(calls.at(-1)), { id: 'w1' });

  queue.push(ok({ id: 'w1', pinned: true }));
  await client.working('pin', { id: 'w1' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/working/update');
  assert.deepEqual(parseBody(calls.at(-1)), { id: 'w1', pinned: true });

  queue.push(ok({ purged: 2 }));
  await client.working('purge');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/working/purge');
  assert.deepEqual(parseBody(calls.at(-1)), {});

  const before = calls.length;
  assert.throws(() => client.working('nonsense'), /working action/);
  assert.equal(calls.length, before);
});

test('goals actions use list/add/update/complete', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok([]));
  await client.goals();
  assert.equal(calls.at(-1).init.method, 'GET');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/goals');

  queue.push(ok({ id: 'g1' }));
  await client.goals('add', { title: '完成客户端', description: 'd', priority: 0.8, dueAt: '2026-12-01' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/goals/add');
  assert.deepEqual(parseBody(calls.at(-1)), { title: '完成客户端', description: 'd', priority: 0.8, dueAt: '2026-12-01' });

  queue.push(ok({ id: 'g1' }));
  await client.goals('update', { id: 'g1', progress: 0.5, status: 'active', dueAt: 'ignored' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/goals/update');
  assert.deepEqual(parseBody(calls.at(-1)), { id: 'g1', progress: 0.5, status: 'active' });

  queue.push(ok({ id: 'g1', status: 'completed' }));
  await client.goals('complete', { id: 'g1' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/goals/complete');
  assert.deepEqual(parseBody(calls.at(-1)), { id: 'g1' });

  const before = calls.length;
  assert.throws(() => client.goals('remove', { id: 'g1' }), /goals action/);
  assert.equal(calls.length, before);
});

test('emotion and life actions map to their routes', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok({ text: '（空）', targets: [], events: [] }));
  await client.emotion();
  assert.equal(calls.at(-1).init.method, 'GET');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/emotion');

  queue.push(ok({ emotions: [] }));
  await client.emotion('record', { text: '有点心疼', target: '主人', traceId: 't1' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/emotion/record');
  assert.deepEqual(parseBody(calls.at(-1)), { text: '有点心疼', target: '主人', traceId: 't1' });

  queue.push(ok({ diary: [], dreams: [], sleeps: [] }));
  await client.life();
  assert.equal(calls.at(-1).init.method, 'GET');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/life');

  queue.push(ok({ id: 'd1' }));
  await client.life('diary', { text: '今天把 API 接上了。', mood: '踏实' });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/life/diary');
  assert.deepEqual(parseBody(calls.at(-1)), { text: '今天把 API 接上了。', mood: '踏实' });

  queue.push(ok({ id: 'dream1' }));
  await client.life('dream');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/life/dream');
  assert.deepEqual(parseBody(calls.at(-1)), {});

  queue.push(ok({ purgedWorking: 0 }));
  await client.life('sleep', { windowDays: 2 });
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/life/sleep');
  assert.deepEqual(parseBody(calls.at(-1)), { windowDays: 2 });
});

test('non-2xx responses become ApiError with status, code and context', async () => {
  const { client, queue } = harness();
  queue.push(json({ ok: false, error: 'not found' }, { status: 404 }));

  await assert.rejects(client.trace('missing'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.name, 'ApiError');
    assert.equal(error.status, 404);
    assert.equal(error.code, 'HTTP_404');
    assert.equal(error.message, 'not found');
    assert.equal(error.method, 'GET');
    assert.match(error.url, /\/api\/cortex\/trace\?id=missing$/);
    assert.deepEqual(error.payload, { ok: false, error: 'not found' });
    return true;
  });
});

test('400/403 responses keep their server messages and codes', async () => {
  const { client, queue } = harness();

  queue.push(json({ ok: false, error: 'text must be a string' }, { status: 400 }));
  await assert.rejects(client.write({ text: 7 }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'HTTP_400');
    assert.equal(error.message, 'text must be a string');
    return true;
  });

  queue.push(json({ ok: false, error: 'missing x-cortex header' }, { status: 403 }));
  await assert.rejects(client.write({ text: 'x' }), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'HTTP_403');
    assert.equal(error.message, 'missing x-cortex header');
    return true;
  });
});

test('an ok:false envelope on HTTP 200 is still an error', async () => {
  const { client, queue } = harness();
  queue.push(json({ ok: false, error: 'engine refused' }, { status: 200 }));

  await assert.rejects(client.health(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.equal(error.code, 'API_ERROR');
    assert.equal(error.message, 'engine refused');
    return true;
  });
});

test('non-JSON and empty error bodies produce HTTP_status errors', async () => {
  const { client, queue } = harness();
  queue.push(new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }));

  await assert.rejects(client.health(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 500);
    assert.equal(error.code, 'HTTP_500');
    assert.match(error.message, /HTTP 500/);
    return true;
  });
});

test('network failures are wrapped as NETWORK_ERROR with cause', async () => {
  const { client, queue } = harness();
  const cause = new Error('socket closed');
  queue.push(cause);

  await assert.rejects(client.health(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.match(error.message, /socket closed/);
    assert.equal(error.cause, cause);
    return true;
  });
});

test('invalid JSON on a successful response is INVALID_JSON', async () => {
  const { client, queue } = harness();
  queue.push(new Response('not json', { status: 200 }));

  await assert.rejects(client.health(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.equal(error.code, 'INVALID_JSON');
    return true;
  });
});

test('204 responses resolve to null without parsing a body', async () => {
  const { client, queue } = harness();
  queue.push(new Response(null, { status: 204 }));

  assert.equal(await client.health(), null);
});

test('tick and digest use the real HTTP routes', async () => {
  const { client, calls, queue } = harness();

  queue.push(ok({ executed: [], proposals: [] }));
  await client.tick({ max: 3 });
  assert.equal(calls.at(-1).init.method, 'POST');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/tick');
  assert.deepEqual(parseBody(calls.at(-1)), { max: 3 });

  queue.push(ok({ date: '2026-11-11', counts: { traces: 1 } }));
  await client.digest({ date: '2026-11-11' });
  assert.equal(calls.at(-1).init.method, 'GET');
  assert.equal(pathOf(calls.at(-1)), '/api/cortex/digest');
  assert.match(calls.at(-1).url, /[?&]date=2026-11-11/);
});

test('local misuse fails fast with TypeError before fetch', async () => {
  const { client, calls } = harness();

  assert.throws(() => client.search(42), /query must be a string/);
  assert.throws(() => client.trace(''), /trace id/);
  assert.throws(() => client.write(null), /write input/);
  assert.throws(() => client.writeMany({ items: [] }), /must be an array/);
  assert.throws(() => client.feedback(null), /feedback input/);
  assert.throws(() => client.forget(null), /forget input/);
  assert.throws(() => client.reflect(null), /reflect input/);
  assert.throws(() => client.working('list', null), /working options/);
  assert.throws(() => client.guard('backup', null), /guard options/);
  assert.throws(() => client.evolve('approve', null), /evolve options/);
  assert.throws(() => client.emotion('record', null), /emotion options/);
  assert.throws(() => client.life('sleep', null), /life options/);
  assert.throws(() => client.goals('list', null), /goals options/);
  assert.throws(() => client.compress(null), /compress options/);
  assert.equal(calls.length, 0);
});

test('envelope unwrapping handles null and primitive data values', async () => {
  const { client, queue } = harness();

  queue.push(json({ ok: true, data: null }));
  assert.equal(await client.health(), null);

  queue.push(json({ ok: true, data: 0 }));
  assert.equal(await client.health(), 0);

  queue.push(json({ ok: true, data: false }));
  assert.equal(await client.health(), false);
});
