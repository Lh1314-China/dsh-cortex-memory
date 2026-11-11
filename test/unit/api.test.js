import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
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
    const write = await invoke(handler, { method: 'POST', route: '/write', body: { text: '主人说会买白饭。', explicit: true } });
    assert.equal(write.status, 200);
    assert.equal(write.json.data.trace.content, '主人说会买白饭。');
    const search = await invoke(handler, { route: '/search?q=白饭' });
    assert.equal(search.status, 200);
    assert.ok(search.json.data.items.length >= 1);

    const withFacts = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: {
        text: 'API 事实写入：测试对象喜欢测试值。',
        explicit: true,
        facts: [{ subject: '测试对象', predicate: '喜欢', object: '测试值', confidence: 0.8 }],
      },
    });
    assert.equal(withFacts.status, 200);
    assert.equal(withFacts.json.data.facts.length, 1);
    assert.equal(withFacts.json.data.edgeCandidates.length, 1);
    const asOf = await invoke(handler, { route: '/as-of?subject=测试对象&predicate=喜欢&mode=historical' });
    assert.equal(asOf.status, 200);
    assert.equal(asOf.json.data.facts.length, 1);
    assert.equal(asOf.json.data.facts[0].object, '测试值');

    const withAttachment = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: {
        text: '带附件元数据的记忆。',
        explicit: true,
        attachments: [{ kind: 'image', uri: 'https://example.test/a.png', mime: 'image/png', bytes: 1234 }],
      },
    });
    assert.equal(withAttachment.status, 200);
    assert.equal(withAttachment.json.data.trace.metadata.attachments.length, 1);
    assert.equal(withAttachment.json.data.trace.metadata.attachments[0].kind, 'image');
    const attachmentSearch = await invoke(handler, { route: '/search?q=附件元数据' });
    assert.equal(attachmentSearch.json.data.items[0].attachments, 1);
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
    const badAttachment = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '坏附件', explicit: true, attachments: [{ kind: 'image', uri: '' }] },
    });
    assert.equal(badAttachment.status, 400);
    assert.match(badAttachment.json.error, /attachments/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('api read-only scopes reject writes but allow reads', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-api-readonly-'));
  const seed = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  const sharedWorking = seed.working.add({ scopeId: 'shared', text: '共享工作项', kind: 'focus' });
  const sharedGoal = seed.goals.add({ scopeId: 'shared', title: '共享目标' });
  const sharedRule = seed.playbook.add({ scopeId: 'shared', title: '共享准则', body: '只在共享 scope 生效的准则内容。' });
  const sharedTrace = seed.write({ scopeId: 'shared', text: '共享 scope 的记忆不应被外部删除。', explicit: true });
  seed.close();
  const cortex = createCortex({
    config: {
      dataRoot: dir,
      dbFile: path.join(dir, 'cortex.sqlite'),
      readOnlyScopes: ['shared'],
      scopeWriteGrants: [
        'shared:agent-a',
        { grant: 'shared:agent-old', until: '2000-01-01T00:00:00.000Z' },
        { grant: 'shared:agent-new', until: '2999-01-01T00:00:00.000Z' },
      ],
    },
  });
  const handler = createApiHandler({ cortex });
  try {
    const denied = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '共享 scope 不应写入。' },
      headers: { 'x-cortex-scope': 'shared' },
    });
    assert.equal(denied.status, 403);
    assert.match(denied.json.error, /scope-read-only/);
    const workingDenied = await invoke(handler, {
      method: 'POST',
      route: '/working/add',
      body: { text: '只读工作项' },
      headers: { 'x-cortex-scope': 'shared' },
    });
    assert.equal(workingDenied.status, 403);
    const goalDenied = await invoke(handler, {
      method: 'POST',
      route: '/goals/add',
      body: { title: '只读目标' },
      headers: { 'x-cortex-scope': 'shared' },
    });
    assert.equal(goalDenied.status, 403);
    const candidateDenied = await invoke(handler, {
      method: 'POST',
      route: '/graph/candidates/action',
      body: { action: 'add', fromId: 'a', toId: 'b' },
      headers: { 'x-cortex-scope': 'shared' },
    });
    assert.equal(candidateDenied.status, 403);
    const workingUpdate = await invoke(handler, { method: 'POST', route: '/working/update', body: { id: sharedWorking.id, text: '改名' } });
    assert.equal(workingUpdate.status, 403);
    const goalComplete = await invoke(handler, { method: 'POST', route: '/goals/complete', body: { id: sharedGoal.id } });
    assert.equal(goalComplete.status, 403);
    const ruleRetire = await invoke(handler, { method: 'POST', route: '/playbook', body: { action: 'retire', id: sharedRule.id } });
    assert.equal(ruleRetire.status, 403);
    const emotionDenied = await invoke(handler, { method: 'POST', route: '/emotion/record', body: { text: '主人有点担心' }, headers: { 'x-cortex-scope': 'shared' } });
    assert.equal(emotionDenied.status, 403);
    const lifeDenied = await invoke(handler, { method: 'POST', route: '/life/diary', body: { text: '共享日记' }, headers: { 'x-cortex-scope': 'shared' } });
    assert.equal(lifeDenied.status, 403);
    const suggestDenied = await invoke(handler, { method: 'POST', route: '/playbook', body: { action: 'suggest' }, headers: { 'x-cortex-scope': 'shared' } });
    assert.equal(suggestDenied.status, 403);
    const compressDenied = await invoke(handler, { method: 'POST', route: '/compress', body: { limit: 1 }, headers: { 'x-cortex-scope': 'shared' } });
    assert.equal(compressDenied.status, 403);
    const forgetDenied = await invoke(handler, { method: 'POST', route: '/forget', body: { id: sharedTrace.trace.id, mode: 'archive' } });
    assert.equal(forgetDenied.status, 403);
    const guardSyncDenied = await invoke(handler, { method: 'POST', route: '/guard/sync', body: { dir: path.join(dir, 'vault') }, headers: { 'x-cortex-scope': 'shared' } });
    assert.equal(guardSyncDenied.status, 403);
    const guardSyncDry = await invoke(handler, { method: 'POST', route: '/guard/sync', body: { dir: path.join(dir, 'vault'), dryRun: true }, headers: { 'x-cortex-scope': 'shared' } });
    assert.equal(guardSyncDry.status, 200);
    const allowed = await invoke(handler, { method: 'POST', route: '/write', body: { text: '本 scope 可以写入。' } });
    assert.equal(allowed.status, 200);
    const granted = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: 'agent-a 有显式写授权。' },
      headers: { 'x-cortex-scope': 'shared', 'x-cortex-agent': 'agent-a' },
    });
    assert.equal(granted.status, 200);
    const revoked = await invoke(handler, { method: 'POST', route: '/security/grants', body: { action: 'revoke', grant: 'shared:agent-a' } });
    assert.equal(revoked.status, 200);
    const afterRevoke = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '撤销后不应写入。' },
      headers: { 'x-cortex-scope': 'shared', 'x-cortex-agent': 'agent-a' },
    });
    assert.equal(afterRevoke.status, 403);
    const reAdded = await invoke(handler, { method: 'POST', route: '/security/grants', body: { action: 'add', grant: 'shared:agent-a' } });
    assert.equal(reAdded.status, 200);
    const afterAdd = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '恢复授权后可以写入。' },
      headers: { 'x-cortex-scope': 'shared', 'x-cortex-agent': 'agent-a' },
    });
    assert.equal(afterAdd.status, 200);
    const deniedAgent = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: 'agent-b 没有授权。' },
      headers: { 'x-cortex-scope': 'shared', 'x-cortex-agent': 'agent-b' },
    });
    assert.equal(deniedAgent.status, 403);
    const expiredAgent = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '过期授权不应写入。' },
      headers: { 'x-cortex-scope': 'shared', 'x-cortex-agent': 'agent-old' },
    });
    assert.equal(expiredAgent.status, 403);
    const futureAgent = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: { text: '未来授权可以写入。' },
      headers: { 'x-cortex-scope': 'shared', 'x-cortex-agent': 'agent-new' },
    });
    assert.equal(futureAgent.status, 200);
    const read = await invoke(handler, { route: '/search?q=共享', headers: { 'x-cortex-scope': 'shared' } });
    assert.equal(read.status, 200);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extractor API writes a derived trace and fails closed when unavailable', async () => {
  const { dir, cortex } = setup();
  const handler = createApiHandler({
    cortex,
    getExtractor: () => ({ extract: async ({ uri, mode }) => ({ text: '提取文本', uri, mode, engine: 'fake' }) }),
  });
  try {
    const target = await invoke(handler, { method: 'POST', route: '/write', body: { text: '目标记忆。', explicit: true } });
    const targetId = target.json.data.trace.id;
    const result = await invoke(handler, {
      method: 'POST',
      route: '/attachments/extract',
      body: { traceId: targetId, uri: 'file:///C:/tmp/a.png', mode: 'ocr' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.data.targetTraceId, targetId);
    assert.ok(result.json.data.extractedTraceId);
    const derived = cortex.get(result.json.data.extractedTraceId);
    assert.equal(derived.content, '提取文本');
    assert.equal(derived.metadata.derivedFrom, targetId);

    const unavailable = createApiHandler({ cortex });
    const denied = await invoke(unavailable, {
      method: 'POST',
      route: '/attachments/extract',
      body: { traceId: targetId, uri: 'file:///C:/tmp/a.png', mode: 'ocr' },
    });
    assert.equal(denied.status, 503);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('attachment metadata can be attached to an existing trace', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const written = await invoke(handler, { method: 'POST', route: '/write', body: { text: '已有记忆，稍后补附件。', explicit: true } });
    const id = written.json.data.trace.id;
    const attached = await invoke(handler, {
      method: 'POST',
      route: '/trace/attachments',
      body: { id, attachments: [{ kind: 'image', uri: 'https://example.test/later.png', name: 'later.png' }] },
    });
    assert.equal(attached.status, 200);
    assert.equal(attached.json.data.added, 1);
    assert.equal(attached.json.data.trace.metadata.attachments.length, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('attachment reader is opt-in and only returns local file metadata', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-api-attachment-'));
  const file = path.join(dir, 'rice.txt');
  writeFileSync(file, 'white rice', 'utf8');
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { attachmentReader: true } } });
  const handler = createApiHandler({ cortex });
  try {
    const result = await invoke(handler, { method: 'POST', route: '/attachments/inspect', body: { uri: pathToFileURL(file).href } });
    assert.equal(result.status, 200);
    assert.equal(result.json.data.name, 'rice.txt');
    assert.equal(result.json.data.bytes, 10);
    assert.equal(result.json.data.sha256, crypto.createHash('sha256').update('white rice').digest('hex'));
    assert.equal(result.json.data.content, undefined);
    const remote = await invoke(handler, { method: 'POST', route: '/attachments/inspect', body: { uri: 'https://example.test/rice.txt' } });
    assert.equal(remote.status, 400);
    const disabled = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'disabled.sqlite') } });
    const disabledHandler = createApiHandler({ cortex: disabled });
    try {
      const denied = await invoke(disabledHandler, { method: 'POST', route: '/attachments/inspect', body: { uri: pathToFileURL(file).href } });
      assert.equal(denied.status, 403);
    } finally { disabled.close(); }
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

test('api scope isolation covers facts, graph candidates and as-of', async () => {
  const { dir, cortex, handler } = setup();
  try {
    const s1 = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: {
        text: 'scope s1 的事实：测试对象喜欢值一。',
        explicit: true,
        facts: [{ subject: '测试对象', predicate: '喜欢', object: '值一', confidence: 0.8 }],
      },
      headers: { 'x-cortex-scope': 's1' },
    });
    assert.equal(s1.status, 200);
    const s2 = await invoke(handler, {
      method: 'POST',
      route: '/write',
      body: {
        text: 'scope s2 的事实：测试对象喜欢值二。',
        explicit: true,
        facts: [{ subject: '测试对象', predicate: '喜欢', object: '值二', confidence: 0.8 }],
      },
      headers: { 'x-cortex-scope': 's2' },
    });
    assert.equal(s2.status, 200);

    const factsS1 = await invoke(handler, { route: '/as-of?subject=测试对象&predicate=喜欢&scope=s1' });
    assert.equal(factsS1.status, 200);
    assert.equal(factsS1.json.data.facts.length, 1);
    assert.equal(factsS1.json.data.facts[0].object, '值一');
    const factsS2 = await invoke(handler, { route: '/as-of?subject=测试对象&predicate=喜欢&scope=s2' });
    assert.equal(factsS2.json.data.facts.length, 1);
    assert.equal(factsS2.json.data.facts[0].object, '值二');

    const candidatesS1 = await invoke(handler, { route: '/graph/candidates?scope=s1' });
    const candidatesS2 = await invoke(handler, { route: '/graph/candidates?scope=s2' });
    assert.equal(candidatesS1.json.data.length, 1);
    assert.equal(candidatesS2.json.data.length, 1);
    assert.notEqual(candidatesS1.json.data[0].id, candidatesS2.json.data[0].id);

    const graphS1 = await invoke(handler, { route: '/graph/edges?scope=s1' });
    assert.equal(graphS1.status, 200);
    assert.equal(graphS1.json.data.edges.length, 0);
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
    const qa = await invoke(handler, { method: 'POST', route: '/qa', body: { question: '主人喜欢什么？' } });
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
    const emotion = await invoke(handler, { method: 'POST', route: '/emotion/record', body: { text: '本鲸有点心疼主人。', target: '主人' } });
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
    cortex.graphCandidateAction({ action: 'add', fromId: 'ent_api_a', toId: 'ent_api_b', rel: 'test', confidence: 0.8 });
    cortex.graphCandidateAction({ action: 'add', fromId: 'ent_api_c', toId: 'ent_api_d', rel: 'test', confidence: 0.4 });
    const candidates = await invoke(handler, { route: '/graph/candidates' });
    assert.equal(candidates.status, 200);
    assert.equal(candidates.json.data.length, 2);

    const edges = await invoke(handler, { route: '/graph/edges' });
    assert.equal(edges.status, 200);
    assert.ok(Array.isArray(edges.json.data.edges));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
