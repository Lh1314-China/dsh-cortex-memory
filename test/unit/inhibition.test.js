import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { suppressionOf, withSuppression, competingFactor } from '../../src/engines/inhibition.js';

const DAY = 86_400_000;

test('suppression halves every half-life and caps at one', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const metadata = { inhibition: 0.6, suppressedAt: new Date(now).toISOString() };
  assert.equal(Math.round(suppressionOf(metadata, now) * 100) / 100, 0.6);
  assert.equal(Math.round(suppressionOf(metadata, now + 14 * DAY) * 100) / 100, 0.3);
  assert.ok(suppressionOf(metadata, now + 999 * DAY) < 0.01);
  assert.equal(suppressionOf({}, now), 0);
  const grown = withSuppression({}, now, { step: 0.15 });
  assert.equal(grown.inhibition, 0.15);
  const capped = withSuppression({ inhibition: 0.95, suppressedAt: new Date(now).toISOString() }, now, { step: 0.5 });
  assert.equal(capped.inhibition, 1);
  assert.ok(competingFactor(metadata, now, { strength: 0.35 }) < 1);
});

function seed(cortex, prefix) {
  // A matches the query; B is nearly the same text but does not contain the
  // query term, so it only enters through the recency list with low fusion.
  // That is exactly the "competitor that loses" case.
  cortex.write({
    text: `${prefix}甲的记忆：这一段讲的是同一个编号的记忆，内容几乎一样，只有末尾的标记不同。再补一段相同的描述文字，让两条候选足够相似。`,
    kind: 'observation',
    title: `${prefix}甲`,
    importance: 0.7,
  });
  cortex.write({
    text: `${prefix}乙的记事：这一段讲的是同一个编号的记忆，内容几乎一样，只有末尾的标记不同。再补一段相同的描述文字，让两条候选足够相似。`,
    kind: 'observation',
    title: `${prefix}乙`,
    importance: 0.7,
  });
}

test('inhibition is off by default and writes nothing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-inhibit-off-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    seed(cortex, '编号甲');
    cortex.search('编号甲 记忆');
    const touched = cortex.repos.traces.list({ limit: 20 }).filter((trace) => Number(trace.metadata?.inhibition) > 0);
    assert.equal(touched.length, 0);
    const health = cortex.health();
    assert.equal(health.inhibition.enabled, false);
    assert.equal(health.inhibition.count, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('when enabled, a competitor dropped for redundancy gains suppression', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-inhibit-on-'));
  const cortex = createCortex({
    config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { inhibition: true } },
  });
  try {
    seed(cortex, '编号乙');
    const result = cortex.search('编号乙甲', { limit: 1 });
    assert.equal(result.items.length, 1);
    const touched = cortex.repos.traces.list({ limit: 20 }).filter((trace) => Number(trace.metadata?.inhibition) > 0);
    assert.ok(touched.length >= 1, 'the suppressed competitor should carry metadata.inhibition');
    assert.ok(touched[0].metadata.suppressedAt);
    assert.equal(Number(touched[0].metadata.inhibition), 0.15);
    const health = cortex.health();
    assert.equal(health.inhibition.enabled, true);
    assert.ok(health.inhibition.count >= 1);
    assert.ok(health.inhibition.average > 0);
    assert.ok(health.inhibition.top.length >= 1);
    const listed = cortex.inhibition.list({});
    assert.ok(listed.length >= 1);
    const cleared = cortex.inhibition.clear({ id: listed[0].id });
    assert.equal(cleared.cleared, 1);
    assert.equal(cortex.inhibition.list({}).length, listed.length - 1);
    const clearedAll = cortex.inhibition.clear({ all: true });
    assert.equal(clearedAll.cleared, listed.length - 1);
    assert.equal(cortex.health().inhibition.count, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
