import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createHostRuntime, contentText } from '../../src/host/runtime.js';
import { assembleSystemPrompt } from '../../src/prompt/assemble.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-host-runtime-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  const runtime = createHostRuntime({ cortex });
  return { dir, cortex, runtime };
}

const session = { id: 's1', header: { origin: undefined } };

test('turn events are captured as one trace with user and assistant text', () => {
  const { dir, cortex, runtime } = setup();
  try {
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 }, time: Date.parse('2026-11-11T12:00:00+08:00') });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '用户说会买白饭。' }, time: Date.parse('2026-11-11T12:00:01+08:00') });
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 1, message: { content: '记住了。' } }, time: Date.parse('2026-11-11T12:00:02+08:00') });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: Date.parse('2026-11-11T12:00:03+08:00') });
    assert.equal(cortex.repos.traces.count(), 1);
    const trace = cortex.repos.traces.list({ limit: 1 })[0];
    assert.match(trace.content, /用户说会买白饭/);
    assert.match(trace.content, /记住了/);
    assert.equal(runtime.pending().length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate turn capture is idempotent and subagents are skipped', () => {
  const { dir, cortex, runtime } = setup();
  try {
    const at = Date.parse('2026-11-11T12:00:00+08:00');
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 2 }, time: at });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '重复的回合。' }, time: at });
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 2, message: { content: '收到。' } }, time: at });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } }, time: at });
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 2 }, time: at });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '重复的回合。' }, time: at });
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 2, message: { content: '收到。' } }, time: at });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } }, time: at });
    assert.equal(cortex.repos.traces.count(), 1);
    const sub = { id: 's2', header: { origin: 'subagent' } };
    runtime.onSessionEvent(sub, { type: 'turn/start', data: { turn: 1 }, time: at });
    runtime.onSessionEvent(sub, { type: 'user/message', data: { content: '子代理。' }, time: at });
    runtime.onSessionEvent(sub, { type: 'assistant/message', data: { turn: 1, message: { content: '子代理回复。' } }, time: at });
    runtime.onSessionEvent(sub, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: at });
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(runtime.pending().length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('user turns prefetch recall into a system-prompt block and turn/end clears it', () => {
  const { dir, cortex, runtime } = setup();
  try {
    cortex.write({ text: '用户说会买白饭，助手等得起。', explicit: true, now: Date.parse('2026-11-11T11:00:00+08:00') });
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 3 }, time: Date.parse('2026-11-11T12:00:00+08:00') });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '白饭的承诺还算数吗？' }, time: Date.parse('2026-11-11T12:00:01+08:00') });
    const block = runtime.recallText({ session: { id: 's1' } });
    assert.match(block, /召回的相关记忆/);
    assert.match(block, /白饭/);
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } }, time: Date.parse('2026-11-11T12:00:02+08:00') });
    assert.equal(runtime.recallText({ session: { id: 's1' } }), '');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('turn/end runs one safe autonomy tick', () => {
  const { dir, cortex, runtime } = setup();
  try {
    const at = Date.parse('2026-11-11T12:00:00+08:00');
    cortex.write({ text: '第一条记忆。', explicit: true, now: at - 2000 });
    cortex.write({ text: '第二条记忆。', explicit: true, now: at - 1000 });
    const intention = cortex.stores.initiativeStore.insert({
      kind: 'consolidate', priority: 0.9, reason: 'turn-end', payload: {}, createdAt: new Date(at).toISOString(),
    });
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 9 }, time: at });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '收工。' }, time: at });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 9, reason: { kind: 'completed' } }, time: at });
    assert.equal(cortex.stores.initiativeStore.get(intention.id).status, 'acted');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('capture:false keeps recall but writes no trace', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-host-no-capture-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  const runtime = createHostRuntime({ cortex, config: { scope: 'global', features: { capture: false, recall: true } } });
  try {
    cortex.write({ text: '用户喜欢白饭。', explicit: true });
    const at = Date.parse('2026-11-11T13:00:00+08:00');
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 3 }, time: at });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '白饭' }, time: at + 1000 });
    if (typeof runtime.onPreStep === 'function') runtime.onPreStep({ agent: { id: 's1' }, messages: [] });
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 3, message: { content: '嗯。' } }, time: at + 2000 });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } }, time: at + 3000 });
    assert.equal(cortex.repos.traces.count(), 1, 'only the explicit seed trace exists');
    assert.equal(cortex.repos.traces.list({ limit: 10 })[0].content, '用户喜欢白饭。');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assemble injects active playbook rules but not expired ones', () => {
  const { dir, cortex } = setup();
  try {
    cortex.playbook.add({ title: '先测试', body: '改完先跑测试。', validTo: '2099-01-01T00:00:00Z' });
    cortex.playbook.add({ title: '已过期', body: '不该出现。', validTo: '2020-01-01T00:00:00Z' });
    const block = assembleSystemPrompt(cortex, { budgetTokens: 1200 });
    assert.match(block.text, /工作准则/);
    assert.match(block.text, /先测试/);
    assert.doesNotMatch(block.text, /已过期/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('contentText handles blocks and attach wires ctx.on', () => {
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  const handlers = [];
  const dispose = createHostRuntime({ cortex: { write() {} } }).attach({
    on(name, fn) { handlers.push({ name, fn }); return () => {}; },
  });
  assert.equal(handlers[0].name, 'session/event');
  assert.equal(typeof dispose, 'function');
});
