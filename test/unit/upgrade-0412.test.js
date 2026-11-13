import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createHostRuntime } from '../../src/host/runtime.js';

function setup(extra = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-0412-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), ...extra } });
  return { dir, cortex };
}

function teardown({ dir, cortex }) {
  cortex.close();
  rmSync(dir, { recursive: true, force: true });
}

test('search keeps full memory while prompt injection gates weak matches', () => {
  const ctx = setup();
  try {
    ctx.cortex.write({ text: '主人说会买白饭，这是一条承诺。', title: '白饭承诺', importance: 0.5, explicit: true });
    ctx.cortex.write({ text: '今天颈椎有点疼，和吃饭无关。', title: '颈椎', importance: 0.5, explicit: true });
    ctx.cortex.write({ text: '插件更新了一条无关的日志。', title: '日志', importance: 0.5, explicit: true });

    const full = ctx.cortex.search('白饭 承诺', { limit: 5 });
    assert.ok(full.items.some((item) => item.title === '白饭承诺'));
    assert.ok(full.items.some((item) => item.title === '颈椎'));
    assert.equal(full.trace.gated, 0);

    const tiered = ctx.cortex.recallTiered({ query: '白饭 承诺' });
    assert.ok(tiered.result.items.some((item) => item.title === '白饭承诺'));
    assert.equal(tiered.result.items.some((item) => item.title === '颈椎'), false);
    assert.equal(tiered.result.items.some((item) => item.title === '日志'), false);
    assert.ok(tiered.result.trace.gated >= 1);
  } finally {
    teardown(ctx);
  }
});

test('high-importance memory keeps the 0.4.11 gate exemption', () => {
  const ctx = setup();
  try {
    ctx.cortex.write({ text: '身份：我是本鲸，边界是不操纵主人。', title: '身份', kind: 'identity', importance: 0.95, explicit: true });
    const tiered = ctx.cortex.recallTiered({ query: '白饭' });
    assert.ok(tiered.result.items.some((item) => item.title === '身份'));
    assert.equal(tiered.result.items[0].layer, 'L0');
  } finally {
    teardown(ctx);
  }
});

test('promptBudget config is normalized instead of being dropped', () => {
  const ctx = setup({ promptBudget: 2400 });
  try {
    assert.equal(ctx.cortex.config.promptBudget, 2400);
    const settings = ctx.cortex.settings();
    assert.equal(ctx.cortex.settings().promptBudget, 2400);
  } finally {
    teardown(ctx);
  }
});

test('recall text is strictly per session and never falls back to another session', () => {
  const ctx = setup();
  try {
    ctx.cortex.write({ text: '主人说会买白饭。', explicit: true });
    const runtime = createHostRuntime({ cortex: ctx.cortex });
    const at = Date.now();
    const s1 = { id: 's1', header: {} };
    const s2 = { id: 's2', header: {} };
    runtime.onSessionEvent(s1, { type: 'turn/start', data: { turn: 1 }, time: at });
    runtime.onSessionEvent(s1, { type: 'user/message', data: { content: '白饭还算数吗？' }, time: at + 1000 });
    assert.match(runtime.recallText({ session: s1 }), /白饭/);
    assert.equal(runtime.recallText({ session: s2 }), '');
    assert.equal(runtime.recallText({}), '');
  } finally {
    teardown(ctx);
  }
});

test('light guardian runs structural invariants and catches FTS drift', () => {
  const ctx = setup();
  try {
    const first = ctx.cortex.write({ text: '第一条用于索引的记忆。', explicit: true });
    ctx.cortex.write({ text: '第二条用于索引的记忆。', explicit: true });
    const clean = ctx.cortex.guardian.check({ deep: false });
    assert.equal(clean.ok, true);
    assert.equal(clean.integrity, 'skipped');
    assert.equal(clean.chain.skipped, true);

    ctx.cortex.db.prepare('DELETE FROM traces_fts_index WHERE trace_id = ?').run(first.trace.id);
    const drift = ctx.cortex.guardian.check({ deep: false });
    assert.equal(drift.ok, false);
    assert.ok(drift.issues.some((item) => item.code === 'FTS_DRIFT'));

    const deep = ctx.cortex.guardian.check({ deep: true });
    assert.equal(deep.integrity, 'ok');
    assert.equal(deep.chain.ok, true);
  } finally {
    teardown(ctx);
  }
});
