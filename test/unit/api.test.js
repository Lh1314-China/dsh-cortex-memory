import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createCortex } from '../../src/service/cortex.js';
import { createApiHandler, API_BASE } from '../../src/api/routes.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-api-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  const handler = createApiHandler({ cortex });
  return { dir, cortex, handler };
}

function request({ method = 'GET', route = '/ping', body = null, headers = {} } = {}) {
  const stream = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]);
  stream.method = method;
  stream.url = `${API_BASE}${route}`;
  stream.headers = {
    host: '127.0.0.1:37990',
    origin: 'http://127.0.0.1:37990',
    'sec-fetch-site': 'same-origin',
    ...(body == null ? {} : { 'content-type': 'application/json', 'x-cortex': '1' }),
    ...headers,
  };
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function response() {
  return {
    statusCode: 0,
    body: '',
    writeHead(code) { this.statusCode = code; },
    end(chunk) { this.body += chunk ? String(chunk) : ''; },
  };
}

async function invoke(handler, options) {
  const res = response();
  await handler(request(options), res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

test('api serves health/self/search and writes through POST', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const ping = await invoke(handler);
    assert.equal(ping.status, 200);
    assert.equal(ping.json.ok, true);
    const health = await invoke(handler, { route: '/health' });
    assert.equal(health.status, 200);
    assert.ok(health.json.data.score > 0);
    const write = await invoke(handler, { method: 'POST', route: '/write', body: { text: '用户说会买米食。', explicit: true } });
    assert.equal(write.status, 200);
    assert.equal(write.json.data.trace.content, '用户说会买米食。');
    const search = await invoke(handler, { route: '/search?q=米食' });
    assert.equal(search.status, 200);
    assert.ok(search.json.data.items.length >= 1);
    const self = await invoke(handler, { route: '/self' });
    assert.equal(self.status, 200);
    assert.ok(self.json.data.self);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('api rejects cross-origin and missing POST header', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const cross = await invoke(handler, { headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403);
    const noHeader = await invoke(handler, { method: 'POST', route: '/write', body: { text: 'x' }, headers: { 'x-cortex': '' } });
    assert.equal(noHeader.status, 403);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('api timeline, trace and evolution endpoints work', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const write = await invoke(handler, { method: 'POST', route: '/write', body: { text: '第一次测试。', explicit: true } });
    const id = write.json.data.trace.id;
    const trace = await invoke(handler, { route: `/trace?id=${id}` });
    assert.equal(trace.status, 200);
    assert.equal(trace.json.data.id, id);
    const wrongScope = await invoke(handler, { route: `/trace?id=${id}&scope=s2` });
    assert.equal(wrongScope.status, 404);
    const timeline = await invoke(handler, { route: `/timeline?id=${id}` });
    assert.equal(timeline.status, 200);
    assert.equal(timeline.json.data.anchor.id, id);
    const status = await invoke(handler, { route: '/evolution' });
    assert.equal(status.status, 200);
    assert.ok(status.json.data.active);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('api rejects invalid write/search bodies with 400', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const badWrite = await invoke(handler, { method: 'POST', route: '/write', body: { text: '' } });
    assert.equal(badWrite.status, 400);
    assert.match(badWrite.json.error, /text/);
    const badSearch = await invoke(handler, { method: 'POST', route: '/search', body: { query: 'x', limit: 99 } });
    assert.equal(badSearch.status, 400);
    assert.match(badSearch.json.error, /limit/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('api scope header/query isolates writes and working memory', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const wrote = await invoke(handler, { method: 'POST', route: '/write', body: { text: 'scope s2 的记忆。', explicit: true }, headers: { 'x-cortex-scope': 's2' } });
    assert.equal(wrote.status, 200);
    assert.equal(wrote.json.data.trace.scopeId, 's2');
    const own = await invoke(handler, { route: '/search?q=scope&scope=s2' });
    assert.equal(own.json.data.items.length, 1);
    const asyncSearch = await invoke(handler, { route: '/search?q=scope&async=true&scope=s2' });
    assert.equal(asyncSearch.status, 200);
    assert.equal(asyncSearch.json.data.items.length, 1);
    const other = await invoke(handler, { route: '/search?q=scope&scope=global' });
    assert.equal(other.json.data.items.length, 0);
    await invoke(handler, { method: 'POST', route: '/working/add', body: { text: 's2 焦点' }, headers: { 'x-cortex-scope': 's2' } });
    const working = await invoke(handler, { route: '/working?scope=s2' });
    assert.equal(working.json.data.length, 1);
    const global = await invoke(handler, { route: '/working?scope=global' });
    assert.equal(global.json.data.length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('api exposes digest, tick, retention apply, evolve propose and guard validate', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const digest = await invoke(handler, { route: '/digest?date=2026-11-11' });
    assert.equal(digest.status, 200);
    assert.match(digest.json.data.content, /记忆摘要/);
    const tick = await invoke(handler, { method: 'POST', route: '/tick', body: { max: 2 } });
    assert.equal(tick.status, 200);
    assert.ok(Array.isArray(tick.json.data.executed));
    const retention = await invoke(handler, { method: 'POST', route: '/retention/apply', body: { dryRun: true } });
    assert.equal(retention.status, 200);
    assert.ok(Number.isInteger(retention.json.data.archived));
    const propose = await invoke(handler, { method: 'POST', route: '/evolve/propose', body: { kind: 'retrieval', config: { budget: 300 }, rationale: 'api' } });
    assert.equal(propose.status, 200);
    assert.equal(propose.json.data.kind, 'retrieval');
    const validate = await invoke(handler, { method: 'POST', route: '/guard/validate', body: { file: path.join(dir, 'missing.sqlite') } });
    assert.equal(validate.status, 200);
    assert.equal(validate.json.data.ok, false);
    const purge = await invoke(handler, { method: 'POST', route: '/working/purge', body: {} });
    assert.equal(purge.status, 200);
    const qa = await invoke(handler, { method: 'POST', route: '/qa', body: { question: '用户喜欢什么？' } });
    assert.equal(qa.status, 200);
    assert.ok(['extractive', 'abstain'].includes(qa.json.data.mode));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('api exposes working, goals, emotion and life actions', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const working = await invoke(handler, { method: 'POST', route: '/working/add', body: { text: '写 UI', priority: 0.9 } });
    assert.equal(working.status, 200);
    assert.match(working.json.data.text, /写 UI/);
    const list = await invoke(handler, { route: '/working' });
    assert.equal(list.json.data.length, 1);
    const goal = await invoke(handler, { method: 'POST', route: '/goals/add', body: { title: '完成 API' } });
    assert.equal(goal.status, 200);
    const goals = await invoke(handler, { route: '/goals' });
    assert.equal(goals.json.data.length, 1);
    const emotion = await invoke(handler, { method: 'POST', route: '/emotion/record', body: { text: '助手有点心疼用户。', target: '用户' } });
    assert.equal(emotion.status, 200);
    assert.ok(emotion.json.data.event);
    const affect = await invoke(handler, { route: '/emotion' });
    assert.ok(affect.json.data.targets.length >= 1);
    const diary = await invoke(handler, { method: 'POST', route: '/life/diary', body: { text: '今天把 API 接上了。', mood: '踏实' } });
    assert.equal(diary.status, 200);
    const life = await invoke(handler, { route: '/life' });
    assert.ok(life.json.data.diary.length >= 1);
    const settings = await invoke(handler, { route: '/settings' });
    assert.equal(settings.status, 200);
    assert.equal(settings.json.data.scope, 'global');
    assert.ok(settings.json.data.permissions);
    assert.equal(settings.json.data.permissions.localApi, true);
    const report = await invoke(handler, { route: '/report' });
    assert.equal(report.status, 200);
    assert.ok(report.json.data.health);
    assert.ok(report.json.data.metrics);
    const noConfirm = await invoke(handler, { method: 'POST', route: '/permissions', body: { key: 'llm', value: true } });
    assert.equal(noConfirm.status, 400);
    const changed = await invoke(handler, { method: 'POST', route: '/permissions', body: { key: 'llm', value: true, confirm: true } });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.data.restartRequired, true);
    const permissions = await invoke(handler, { route: '/permissions' });
    assert.equal(permissions.json.data.current.llm, true);
    const restored = await invoke(handler, { method: 'POST', route: '/permissions/rollback', body: {} });
    assert.equal(restored.status, 200);
    assert.equal(restored.json.data.rolledBack, true);
    const models = await invoke(handler, { route: '/models' });
    assert.equal(models.status, 200);
    assert.equal(models.json.data.embedding.mode, 'hash');
    const modelSave = await invoke(handler, { method: 'POST', route: '/models', body: { embedding: { mode: 'local' }, confirm: true } });
    assert.equal(modelSave.status, 200);
    assert.equal(modelSave.json.data.restartRequired, true);
    const savedModels = await invoke(handler, { route: '/models' });
    assert.equal(savedModels.json.data.embedding.mode, 'local');
    assert.equal(savedModels.json.data.embedding.model, 'bge-m3');
    assert.doesNotMatch(JSON.stringify(savedModels.json.data), /"apiKey"/);
    const graph = await invoke(handler, { route: '/graph' });
    assert.equal(graph.status, 200);
    assert.ok(Number.isInteger(graph.json.data.nodes));
    const asOf = await invoke(handler, { route: '/as-of?subject=missing&mode=strict' });
    assert.equal(asOf.status, 200);
    assert.deepEqual(asOf.json.data.facts, []);
    const playbook = await invoke(handler, { route: '/playbook' });
    assert.equal(playbook.status, 200);
    assert.deepEqual(playbook.json.data, []);
    const added = await invoke(handler, { method: 'POST', route: '/playbook', body: { action: 'add', title: '先测试', body: '改完先跑测试' } });
    assert.equal(added.status, 200);
    assert.match(added.json.data.title, /先测试/);
    const rendered = await invoke(handler, { method: 'POST', route: '/playbook', body: { action: 'render' } });
    assert.equal(rendered.status, 200);
    assert.match(rendered.json.data.text, /先测试/);
    const runs = await invoke(handler, { route: '/dream-runs' });
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray(runs.json.data));
    const consolidate = await invoke(handler, { method: 'POST', route: '/consolidate', body: { dryRun: true } });
    assert.equal(consolidate.status, 200);
    assert.ok(consolidate.json.data.run);
    const edges = await invoke(handler, { route: '/graph/edges' });
    assert.equal(edges.status, 200);
    assert.ok(Array.isArray(edges.json.data.edges));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
