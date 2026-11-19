import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-revive-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('读一条归档的记忆会把它带回来', () => {
  const { dir, cortex } = setup();
  try {
    const written = cortex.write({ text: '用户：想把那本旧书找出来。', kind: 'utterance', title: '想把那本旧书找出来', explicit: true });
    const id = written.trace.id;
    cortex.forget({ traceId: id, mode: 'archive' });
    assert.equal(cortex.get(id, { revive: false }).state, 'archived');
    const revived = cortex.get(id, { revive: true });
    assert.equal(revived.state, 'active', '带着 revive 读回来就该被唤回');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('复活有每日预算：超过 3 条就只读不复活', () => {
  const { dir, cortex } = setup();
  try {
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const written = cortex.write({ text: `用户：归档样本第 ${i} 条。`, kind: 'utterance', title: `归档样本 ${i}`, explicit: true });
      cortex.forget({ traceId: written.trace.id, mode: 'archive' });
      ids.push(written.trace.id);
    }
    for (let i = 0; i < 3; i += 1) {
      assert.equal(cortex.get(ids[i], { revive: true }).state, 'active', `前三条应复活（第 ${i} 条）`);
    }
    assert.equal(cortex.get(ids[3], { revive: true }).state, 'archived', '预算用完后第四条只读不复活');
    assert.equal(cortex.get(ids[4], { revive: false }).state, 'archived');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('预算按真实 24 小时算，不会被别的高频审计冲掉', () => {
  const { dir, cortex } = setup();
  try {
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const written = cortex.write({ text: `用户：预算样本第 ${i} 条。`, kind: 'utterance', title: `预算样本 ${i}`, explicit: true });
      cortex.forget({ traceId: written.trace.id, mode: 'archive' });
      ids.push(written.trace.id);
    }
    for (let i = 0; i < 3; i += 1) {
      assert.equal(cortex.get(ids[i], { revive: true }).state, 'active');
    }
    // 让这几天最常见的审计动作把「最近 200 条」全部占满；复活计数仍应按真实 24h 算。
    for (let i = 0; i < 260; i += 1) {
      cortex.repos.audit.record({ actor: 'system', action: 'dream.run', targetType: 'dream', targetId: `d${i}`, detail: {} });
    }
    assert.equal(cortex.get(ids[3], { revive: true }).state, 'archived', '预算已用尽，即使日志被别的动作刷屏也不该再复活');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('合并掉的痕迹不会被读活', () => {
  const { dir, cortex } = setup();
  try {
    const written = cortex.write({ text: '用户：记一笔合并前的东西。', kind: 'utterance', title: '合并前的东西', explicit: true });
    const id = written.trace.id;
    cortex.get(id, { revive: false });
    cortex.repos.traces.update(id, { state: 'archived', compression: 'merged' });
    assert.equal(cortex.get(id).state, 'archived');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
