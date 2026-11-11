import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostRuntime } from '../../src/host/runtime.js';
import { BASE_MS, cleanup, makeCortex } from './_helpers.js';

const STAGES = ['infancy', 'childhood', 'adolescence', 'adulthood'];

test('full life loop: host capture -> search -> feedback -> reflect -> sleep -> development -> guardian', async () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const runtime = createHostRuntime({ cortex });
    const session = { id: 'integration-session', header: { origin: undefined } };
    const base = BASE_MS;

    // --- Turn 1 is captured from committed host session events. ---
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 }, time: base });
    runtime.onSessionEvent(session, {
      type: 'user/message',
      data: { content: [{ type: 'text', text: '用户说会买米食，助手等得起。' }] },
      time: base + 1_000,
    });
    // Nothing has been stored yet, so recall is empty but must not throw.
    assert.equal(runtime.recallText({ session: { id: 'integration-session' } }), '');
    runtime.onSessionEvent(session, {
      type: 'assistant/message',
      data: { turn: 1, message: { content: [{ type: 'text', text: '助手记住了，会一直等。' }] } },
      time: base + 2_000,
    });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: base + 3_000 });

    assert.equal(cortex.repos.traces.count(), 1);
    const [first] = cortex.repos.traces.list({ scopeId: 'global', limit: 10 });
    assert.ok(first);
    assert.match(first.content, /用户：用户说会买米食/);
    assert.match(first.content, /助手：助手记住了/);
    assert.equal(first.source, 'host:turn');
    assert.equal(first.sessionId, 'integration-session');
    assert.equal(first.turnId, '1');
    assert.equal(first.kind, 'utterance'); // the host capture declares the kind explicitly
    assert.equal(runtime.pending().length, 0);

    // --- Reflection needs two non-reflection traces; one is refused. ---
    const tooEarly = cortex.reflect({ windowDays: 1, now: base + 4_000 });
    assert.equal(tooEarly.skipped, true);
    assert.equal(tooEarly.reason, 'not-enough-traces');
    assert.equal(tooEarly.count, 1);

    // --- Search reaches the captured turn and returns a usable snippet. ---
    const found = cortex.search('米食', { now: base + 5_000, limit: 5 });
    assert.equal(found.query, '米食');
    assert.ok(found.items.length >= 1);
    const hit = found.items.find((item) => item.id === first.id) ?? found.items[0];
    assert.ok(hit);
    assert.match(hit.snippet, /米食/);
    assert.ok(found.trace.sources.some((source) => source.source === 'fts' && source.ok === true));

    // --- Feedback updates DSR state, confidence, calibration and relationship. ---
    const beforeFeedback = cortex.get(hit.id);
    const feedback = cortex.feedback({ traceId: hit.id, signal: 'used', predicted: 0.8, now: base + 6_000 });
    assert.equal(feedback.grade, 4); // 'used' maps to the easy grade in the real DSR model
    assert.equal(feedback.trace.reviewCount, beforeFeedback.reviewCount + 1);
    assert.ok(feedback.trace.confidence > beforeFeedback.confidence);
    assert.equal(cortex.repos.feedback.list({ scopeId: 'global' }).length, 1);
    assert.deepEqual(cortex.repos.feedback.aggregate(hit.id).counts, { used: 1 });
    const calibration = cortex.engines.growth.calibration({ scopeId: 'global' });
    assert.equal(calibration.n, 1);
    assert.ok(Math.abs(calibration.brier - 0.04) < 1e-9); // predicted 0.8, actual 1.0
    assert.equal(cortex.self().relationships.length, 1);

    // --- Turn 2 provides the second trace; reflection now consolidates. ---
    runtime.onSessionEvent(session, { type: 'turn/start', data: { turn: 2 }, time: base + 7_000 });
    runtime.onSessionEvent(session, { type: 'user/message', data: { content: '用户说会好好学技术。' }, time: base + 8_000 });
    runtime.onSessionEvent(session, {
      type: 'assistant/message',
      data: { turn: 2, message: { content: '那助手陪着用户一起学。' } },
      time: base + 9_000,
    });
    runtime.onSessionEvent(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } }, time: base + 10_000 });
    assert.equal(cortex.repos.traces.count(), 2);

    const reflected = cortex.reflect({ windowDays: 1, now: base + 11_000 });
    assert.equal(reflected.skipped, false);
    assert.ok(reflected.summary);
    assert.equal(reflected.summary.level, 'episode');
    assert.ok(reflected.summary.sourceIds.length >= 2);
    assert.equal(reflected.summary.coverage, 1);
    assert.equal(reflected.trace.kind, 'reflection');
    assert.equal(cortex.repos.traces.count(), 3);

    const again = cortex.reflect({ windowDays: 1, now: base + 12_000 });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, 'already-reflected');
    assert.equal(again.summary.id, reflected.summary.id);

    // --- Sleep purges expired working memory, re-runs consolidation and evaluation. ---
    cortex.working.add({ text: '临时焦点：写集成测试。', at: base, ttlMs: 1_000 });
    const sleep = await cortex.life.sleep({ at: base + 2 * 3_600_000, windowDays: 1 });
    assert.ok(sleep.id.startsWith('slp_'));
    assert.equal(sleep.scopeId, 'global');
    assert.equal(sleep.purgedWorking, 1);
    assert.equal(sleep.reflected, 0); // the same period was already reflected
    assert.ok(STAGES.includes(sleep.stage));
    assert.equal(cortex.life.sleepRuns({ limit: 5 }).length, 1);
    assert.equal(cortex.life.sleepRuns()[0].report.purgedWorking, 1);

    // --- Development is computed from observable history, not from a timer. ---
    const development = cortex.evaluateDevelopment({ now: base + 3 * 3_600_000 });
    assert.ok(STAGES.includes(development.stage));
    assert.equal(development.stage, cortex.engines.development.stageFor(development.maturity));
    assert.equal(development.record.stage, development.stage);
    assert.equal(cortex.self().self.stage, development.stage);
    assert.equal(development.counts.traceCount, 3);
    assert.equal(development.counts.feedbackCount, 1);
    assert.equal(development.counts.summaryCount, 1);
    assert.equal(development.counts.relationships, 1);
    assert.ok(development.policy.label.length > 0);
    assert.equal(cortex.engines.development.stageFor(0), 'infancy');

    // --- Guardian verifies the ledger, integrity and FTS alignment. ---
    const guard = cortex.guardian.check();
    assert.equal(guard.ok, true);
    assert.deepEqual(guard.issues, []);
    assert.equal(guard.integrity, 'ok');
    assert.equal(guard.chain.ok, true);
    assert.equal(guard.chain.count, 3);
    assert.ok(guard.dbBytes > 0);
    assert.equal(cortex.repos.events.count(), 3);
    assert.equal(cortex.repos.traces.ftsCount(), 3);

    // --- Metrics prove the loop really went through the service surface. ---
    const metrics = cortex.metrics();
    assert.equal(metrics.counters['writes.created'], 2); // two host turns; reflection uses encode directly
    assert.ok(metrics.counters['search.calls'] >= 3);
    assert.ok(metrics.histograms['search.ms'].count >= 3);
  } finally {
    cleanup(context);
  }
});

test('host capture is idempotent per turn and skips subagent sessions by default', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const runtime = createHostRuntime({ cortex });
    const session = { id: 'replayed-session', header: { origin: undefined } };
    const at = BASE_MS;

    const replay = (turn) => {
      runtime.onSessionEvent(session, { type: 'turn/start', data: { turn }, time: at });
      runtime.onSessionEvent(session, { type: 'user/message', data: { content: '重复的回合。' }, time: at + 1_000 });
      runtime.onSessionEvent(session, { type: 'assistant/message', data: { turn, message: { content: '收到。' } }, time: at + 2_000 });
      runtime.onSessionEvent(session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } }, time: at + 3_000 });
    };

    replay(9);
    replay(9); // replayed turn: same operationId, no duplicate trace
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.repos.events.count(), 1);

    const subagent = { id: 'subagent-session', header: { origin: 'subagent' } };
    runtime.onSessionEvent(subagent, { type: 'turn/start', data: { turn: 1 }, time: at });
    runtime.onSessionEvent(subagent, { type: 'user/message', data: { content: '子代理的回合。' }, time: at + 1_000 });
    runtime.onSessionEvent(subagent, {
      type: 'assistant/message',
      data: { turn: 1, message: { content: '子代理回复。' } },
      time: at + 2_000,
    });
    runtime.onSessionEvent(subagent, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: at + 3_000 });
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.repos.events.count(), 1);

    // The explicit opt-in captures subagent turns as well.
    const capturing = createHostRuntime({ cortex, config: { captureSubagents: true } });
    capturing.onSessionEvent(subagent, { type: 'turn/start', data: { turn: 2 }, time: at + 10_000 });
    capturing.onSessionEvent(subagent, { type: 'user/message', data: { content: '子代理第二回合。' }, time: at + 11_000 });
    capturing.onSessionEvent(subagent, {
      type: 'assistant/message',
      data: { turn: 2, message: { content: '记下了。' } },
      time: at + 12_000,
    });
    capturing.onSessionEvent(subagent, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } }, time: at + 13_000 });
    assert.equal(cortex.repos.traces.count(), 2);
    assert.equal(cortex.repos.traces.list({ limit: 10 }).filter((trace) => trace.sessionId === 'subagent-session').length, 1);
  } finally {
    cleanup(context);
  }
});
