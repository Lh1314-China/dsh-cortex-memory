import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createHostRuntime, stripInjected, deriveHostTitle, contentText } from '../../src/host/runtime.js';
import { isInjectedNoise } from '../../src/engines/encode.js';

function setup(config = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-capture-filter-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), ...config } });
  return { dir, cortex };
}

const RUNTIME_CONTEXT = [
  'Time sampled while preparing turn 33, step 1: 2026-11-15T00:57:58+08:00[Asia/Shanghai]',
  'Browser time zone for this request: Asia/Shanghai. Interpret otherwise-unqualified dates and times in this zone.',
  'Elapsed since the preceding model-visible message: 27m 56s.',
  '用户说想吃米饭。',
].join('\n');

test('stripInjected drops the runtime header and keeps the human line', () => {
  const cleaned = stripInjected(RUNTIME_CONTEXT);
  assert.equal(cleaned, '用户说想吃米饭。');
});

test('stripInjected removes system-reminder blocks and pure boilerplate becomes empty', () => {
  const withReminder = '<system-reminder>\nThe available skill catalog changed.\n</system-reminder>\n帮咱看看记忆。';
  assert.equal(stripInjected(withReminder), '帮咱看看记忆。');
  const pure = '<system-reminder>\nCurrent runtime context. This snapshot supersedes earlier versions.\n</system-reminder>';
  assert.equal(stripInjected(pure), '');
});

test('isInjectedNoise only fires on a strong head so discussing the marker is safe', () => {
  assert.equal(isInjectedNoise('Time sampled while preparing turn 3'), true);
  assert.equal(isInjectedNoise('Elapsed since the preceding step context: unavailable.'), true);
  assert.equal(isInjectedNoise('用户问：为什么 "Time sampled" 会进库？'), false);
  assert.equal(isInjectedNoise('记住 <system-reminder> 这种块不要入库'), false);
});

test('the "Elapsed since the preceding step context" line is stripped too', () => {
  const text = 'Elapsed since the preceding step context: unavailable.\n今天想吃米饭。';
  assert.equal(stripInjected(text), '今天想吃米饭。');
});

test('scheduler reminder batches are harness automation, not user speech', () => {
  const reminder = '[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: [{"schedule_id":"x"}]';
  assert.equal(stripInjected(reminder), '');
  assert.equal(isInjectedNoise(reminder), true);
  assert.equal(isInjectedNoise('<goal_complete>\nObjective: "x"'), true);
});

test('titles fall back to the assistant line instead of "会话 N"', () => {
  assert.equal(deriveHostTitle('', null, '助手'), null);
  assert.equal(deriveHostTitle('助手：这一轮收工了，装的是 0.4.57', null, '助手'), '这一轮收工了，装的是 0.4.57');
  assert.equal(deriveHostTitle('', 7, '助手'), '会话 7');
});

test('deriveHostTitle turns the first real line into a readable title', () => {
  assert.equal(deriveHostTitle('用户说想吃米饭。\n第二行', 12), '用户说想吃米饭。');
  assert.equal(deriveHostTitle('', 12), '会话 12');
});

test('a turn whose user text is only injected context is not captured', () => {
  const { dir, cortex } = setup();
  const runtime = createHostRuntime({ cortex });
  const session = { id: 's-injected', header: {} };
  try {
    const at = Date.parse('2026-11-15T10:00:00+08:00');
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 }, time: at });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '<system-reminder>Current runtime context.</system-reminder>' }, time: at });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: at });
    assert.equal(cortex.repos.traces.count(), 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('host capture stores clean text with a readable title', () => {
  const { dir, cortex } = setup();
  const runtime = createHostRuntime({ cortex, config: { persona: { selfName: '助手' } } });
  const session = { id: 's-clean', header: {} };
  try {
    const at = Date.parse('2026-11-15T10:00:00+08:00');
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 7 }, time: at });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: RUNTIME_CONTEXT }, time: at });
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 7, message: { content: '这就去煮。' } }, time: at });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } }, time: at });
    const trace = cortex.repos.traces.list({ limit: 1 })[0];
    assert.doesNotMatch(trace.content, /Time sampled/);
    assert.match(trace.content, /用户说想吃米饭/);
    assert.equal(trace.title, '用户说想吃米饭。');
    const health = cortex.health();
    assert.equal(health.capture.total, 1);
    assert.equal(health.capture.stripped, 1);
    assert.equal(health.capture.clean, 0);
    assert.equal(typeof health.vectors.coverage, 'number');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recall records access so DSR recency is not frozen', () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '用户在 2026-11-14 说，助手将来会走得很远。', kind: 'promise', title: '用户的话' });
    const before = cortex.repos.traces.list({ limit: 1 })[0];
    assert.equal(before.accessCount, 0);
    const result = cortex.search('助手 很远');
    assert.ok(result.items.length > 0);
    const after = cortex.repos.traces.get(before.id);
    assert.equal(after.accessCount, 1);
    assert.ok(after.lastAccessAt);
    cortex.search('助手 很远');
    assert.equal(cortex.repos.traces.get(before.id).accessCount, 1, 'a second immediate recall must not inflate access');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('async vector queue drains and backfills misses instead of silently dropping', async () => {
  const embedder = {
    kind: 'openai-embedding',
    async: true,
    model: 'fake-embed',
    dim: 4,
    embed: async () => [1, 0, 0, 0],
  };
  const { dir, cortex } = setup({ features: { vector: true }, embedder, vectorDim: 4, vectorModel: 'fake-embed' });
  try {
    const written = cortex.write({ text: '海上的月亮很亮。', kind: 'observation', title: '月' });
    assert.ok(written.trace?.id);
    let status = cortex.vector.status();
    assert.equal(status.queue.pending, 1);
    const drained = await cortex.vector.drainQueue({ max: 10 });
    assert.equal(drained.ok, 1);
    assert.equal(cortex.vector.status().count, 1);

    cortex.vector.remove(written.trace.id);
    assert.equal(cortex.vector.status().count, 0);
    const queued = cortex.vector.backfillMissing({ limit: 10 });
    assert.equal(queued.queued, 1);
    await cortex.vector.drainQueue({ max: 10 });
    assert.equal(cortex.vector.status().count, 1);

    // vectorMaintain is what the heartbeat calls: it should backfill and drain
    // in one pass, and honour the batch sizes it is given.
    for (let i = 0; i < 4; i += 1) {
      cortex.write({ text: `海边的第 ${i} 条记忆。`, kind: 'observation', title: `海${i}` });
    }
    const maintain = await cortex.vectorMaintain({ backfill: 10, drain: 10 });
    assert.ok(maintain.ok >= 4, `expected at least 4 embeddings, got ${JSON.stringify(maintain)}`);
    assert.equal(maintain.stoppedBy, 'done');
    assert.ok(maintain.elapsedMs >= 0);
    assert.equal(cortex.vector.status().count, 5);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maintain expires stale intentions and collapses duplicate summaries', () => {
  const { dir, cortex } = setup();
  try {
    const at = new Date('2026-11-15T03:00:00.000Z').toISOString();
    const past = new Date('2026-11-12T03:00:00.000Z').toISOString();
    cortex.db.prepare(`
      INSERT INTO intentions(id, scope_id, kind, priority, status, payload_json, reason, created_at, due_at, expires_at)
      VALUES ('itn_test', 'global', 'question', 0.4, 'pending', '{}', 'stale', ?, ?, ?)
    `).run(past, past, past);
    for (const id of ['sum_a', 'sum_b']) {
      cortex.db.prepare(`
        INSERT INTO summaries(id, scope_id, level, period_start, period_end, content, source_ids_json, coverage, created_at)
        VALUES (?, 'global', 'episode', ?, ?, '同一段摘要', '[]', 1, ?)
      `).run(id, past, past, past);
    }
    const report = cortex.maintain({ now: Date.parse(at), scopeId: 'global' });
    assert.equal(report.intentions, 1);
    assert.equal(cortex.db.prepare("SELECT status FROM intentions WHERE id = 'itn_test'").get().status, 'expired');
    assert.equal(report.summaries, 1);
    assert.equal(cortex.db.prepare("SELECT COUNT(*) AS c FROM summaries WHERE content = '同一段摘要'").get().c, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auto-continuation goal rounds are harness text, not user speech', () => {
  const goalRound = [
    '<goal_round>',
    'Objective: "持续自主迭代。"',
    'Round: 8/40',
    '',
    'Continue working toward the objective.',
    '</goal_round>',
  ].join('\n');
  assert.equal(stripInjected(goalRound), '');
  assert.equal(stripInjected('Objective: "x"\nRound: 3/40\n\n继续。'), '');
  assert.equal(isInjectedNoise(goalRound), true);
  assert.equal(stripInjected('用户说这句话里的 Round: 8/40 不要存。'), '用户说这句话里的 Round: 8/40 不要存。');
});

test('a goal-round turn keeps only the assistant reply', () => {
  const { dir, cortex } = setup();
  const runtime = createHostRuntime({ cortex, config: { persona: { selfName: '助手' } } });
  const session = { id: 's-goal-round', header: {} };
  try {
    const at = Date.parse('2026-11-15T12:00:00+08:00');
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 3 }, time: at });
    runtime.onSessionEvent(session, {
      type: 'user/message',
      data: { content: '<goal_round>\nObjective: "x"\nRound: 3/40\n\n继续。\n</goal_round>' },
      time: at,
    });
    runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn: 3, message: { content: '这一轮修了捕获过滤。' } }, time: at });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } }, time: at });
    const trace = cortex.repos.traces.list({ limit: 1 })[0];
    assert.ok(trace, 'the assistant reply is still worth remembering');
    assert.doesNotMatch(trace.content, /Objective/);
    assert.match(trace.content, /这一轮修了捕获过滤/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maintain archives goal-round traces stored by older versions', () => {
  const { dir, cortex } = setup();
  try {
    const written = cortex.write({
      text: '用户：<goal_round>\nObjective: "旧版本存进来的"\nRound: 2/40\n\n继续。',
      explicit: true,
    });
    assert.ok(written.trace?.id);
    const report = cortex.maintain({ now: Date.parse('2026-11-15T12:00:00+08:00'), scopeId: 'global' });
    assert.equal(report.goalRounds, 1);
    assert.equal(cortex.repos.traces.get(written.trace.id).state, 'archived');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maintain drops stale unpinned working items but keeps pinned ones', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.parse('2026-11-15T12:00:00+08:00');
    const old = new Date(now - 30 * 86_400_000).toISOString();
    cortex.db.prepare("INSERT INTO working_items(id, scope_id, kind, text, priority, pinned, created_at, updated_at) VALUES ('wrk_old','global','todo','很久没动过的事','0.5',0,?,?)").run(old, old);
    cortex.db.prepare("INSERT INTO working_items(id, scope_id, kind, text, priority, pinned, created_at, updated_at) VALUES ('wrk_pin','global','todo','置顶不动的事','1',1,?,?)").run(old, old);
    const report = cortex.maintain({ now, scopeId: 'global' });
    assert.equal(report.working, 1);
    assert.equal(cortex.db.prepare("SELECT COUNT(*) AS c FROM working_items WHERE id = 'wrk_old'").get().c, 0);
    assert.equal(cortex.db.prepare("SELECT COUNT(*) AS c FROM working_items WHERE id = 'wrk_pin'").get().c, 1);
    const health = cortex.health();
    assert.ok(health.maintain, 'health should surface the last maintenance pass');
    assert.equal(health.maintain.working, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('capture report buckets host turns by day', () => {
  const { dir, cortex } = setup();
  const runtime = createHostRuntime({ cortex });
  const session = { id: 's-days', header: {} };
  try {
    const days = [Date.parse('2026-11-14T10:00:00+08:00'), Date.parse('2026-11-15T10:00:00+08:00')];
    days.forEach((at, index) => {
      const turn = index + 1;
      runtime.onSessionEvent(session, { type: 'turn/start', data: { turn }, time: at });
      runtime.onSessionEvent(session, { type: 'user/message', data: { content: `Time sampled while preparing turn ${turn}\nElapsed since the preceding model-visible message: 1m\n用户第 ${turn} 天说想吃米饭。` }, time: at });
      runtime.onSessionEvent(session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } }, time: at });
    });
    const health = cortex.health();
    assert.equal(health.capture.days.length, 2);
    assert.equal(health.capture.days[0].day, '2026-11-15');
    assert.equal(health.capture.days[1].day, '2026-11-14');
    assert.equal(health.capture.days[0].stripped, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('contentText keeps text blocks only', () => {
  const value = contentText([{ type: 'text', text: 'a' }, { type: 'image' }, 'b']);
  assert.match(value, /a/);
  assert.match(value, /b/);
  assert.doesNotMatch(value, /\[object/);
});
