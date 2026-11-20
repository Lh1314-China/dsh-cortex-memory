import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup(config = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-mem-policy-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), ...config } });
  return { dir, cortex };
}

test('memory policy falls back to config defaults', () => {
  const { dir, cortex } = setup();
  try {
    const current = cortex.memoryPolicy.current();
    assert.equal(current.source, 'config');
    assert.deepEqual(current.evergreenKinds, ['identity', 'promise']);
    assert.equal(typeof current.deepConsolidateHour, 'number');
    assert.match(cortex.memoryPolicy.describe(), /配置文件默认/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an approved memory policy overrides the defaults and rolls back cleanly', () => {
  const { dir, cortex } = setup();
  try {
    const v1 = cortex.evolution.propose({
      kind: 'memory',
      config: { evergreenKinds: ['identity', 'promise'] },
      rationale: 'test: baseline policy',
    });
    cortex.evolution.approve(v1.id);

    const proposed = cortex.evolution.propose({
      kind: 'memory',
      config: { evergreenKinds: ['identity'], deepConsolidateHour: 2, deepConsolidateLimit: 40 },
      rationale: 'test: tighten evergreen list',
    });
    assert.equal(proposed.status, 'candidate');
    // A candidate is not applied: the baseline policy is still active.
    assert.deepEqual(cortex.memoryPolicy.current().evergreenKinds, ['identity', 'promise']);

    cortex.evolution.approve(proposed.id);
    const active = cortex.memoryPolicy.current();
    assert.equal(active.source, 'policy');
    assert.equal(active.policyId, proposed.id);
    assert.deepEqual(active.evergreenKinds, ['identity']);
    assert.equal(active.deepConsolidateHour, 2);
    assert.equal(active.deepConsolidateLimit, 40);
    assert.equal(cortex.memoryPolicy.evergreen('identity'), true);
    assert.equal(cortex.memoryPolicy.evergreen('promise'), false);
    assert.match(cortex.memoryPolicy.describe(), /记忆策略来源：policy v2/);

    // Roll back to the previous version: promise returns to evergreen.
    cortex.evolution.rollback('memory');
    const rolled = cortex.memoryPolicy.current();
    assert.equal(rolled.policyId, v1.id);
    assert.deepEqual(rolled.evergreenKinds, ['identity', 'promise']);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evergreen kinds are never compression-eligible', () => {
  const { dir, cortex } = setup();
  try {
    const identity = cortex.write({
      text: '身份：我是一个会记住改变的助手。',
      kind: 'identity',
      explicit: true,
      importance: 0.2,
    });
    const observation = cortex.write({
      text: '今天看到一只猫。',
      kind: 'observation',
      explicit: true,
      importance: 0.2,
    });
    const rows = cortex.engines.compression.evaluate({ scopeId: 'global' });
    const byId = new Map(rows.map((row) => [row.trace.id, row]));
    assert.equal(byId.get(identity.trace.id)?.evergreen, true);
    assert.equal(byId.get(identity.trace.id)?.eligible, false, 'an evergreen kind is never auto-archived');
    assert.equal(byId.get(observation.trace.id)?.evergreen, false);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
