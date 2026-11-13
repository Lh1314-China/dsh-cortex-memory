import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createEvolutionEngine } from '../../src/self/evolution.js';
import { createWebSearch } from '../../src/web/search.js';
import { normalizeConfig } from '../../src/core/config.js';
import { extractFactCandidates } from '../../src/engines/extract.js';

function tempCortex() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-0414-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

function closeCortex(ctx) {
  try { ctx.cortex.close(); } catch { /* already closed */ }
  rmSync(ctx.dir, { recursive: true, force: true });
}

test('qualityGuard rolls back a retrieval policy that fails semantic probes', () => {
  let active = null;
  const created = [];
  const policies = {
    active: () => active,
    list: () => created,
    listCanaries: () => [],
    setCanary: () => {},
    create: ({ kind, config, metrics = null }) => {
      const policy = { id: 'pol_quality_1', kind, config, metrics, status: 'candidate', version: 1 };
      created.push(policy);
      return policy;
    },
    activate: (id) => {
      const policy = created.find((item) => item.id === id);
      active = policy;
      policy.status = 'active';
      return policy;
    },
    rollback: () => { active = null; return null; },
    retire: (id) => {
      const policy = created.find((item) => item.id === id);
      if (policy) policy.status = 'superseded';
      if (active?.id === id) active = null;
      return policy;
    },
    get: (id) => created.find((item) => item.id === id) ?? null,
    updateMetrics: () => {},
  };
  const evolution = createEvolutionEngine({
    policies,
    growth: { calibration: () => ({ brier: 0.4, ece: 0.2, n: 10 }) },
    health: { audit: () => ({ score: 100, issues: [] }) },
    qualityGuard: () => ({ ok: false, recall: 0.1, baselineRecall: 0.8, threshold: 0.4, n: 6 }),
  });
  const result = evolution.autoEvolve();
  assert.equal(result.activated.length, 0);
  assert.ok(result.errors.some((item) => item.error === 'quality-guard'));
  assert.equal(policies.active('retrieval'), null);
  assert.equal(created[0].status, 'superseded');
});

test('recentTimeline returns the newest active traces without an anchor id', () => {
  const ctx = tempCortex();
  try {
    ctx.cortex.write({ text: '最近时间线应该能直接看到这条记忆。', title: '时间线探针', explicit: true });
    const recent = ctx.cortex.recentTimeline({ limit: 5 });
    assert.ok(recent.items.length >= 1);
    assert.equal(recent.items[0].title, '时间线探针');
  } finally {
    closeCortex(ctx);
  }
});

test('web search adapter returns citeable sources without storing them', async () => {
  const search = createWebSearch({
    provider: 'wikipedia',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ query: { search: [{ title: 'Memory', snippet: 'A memory page' }] } }),
    }),
  });
  const result = await search.search({ query: 'memory', maxResults: 1 });
  assert.equal(result.provider, 'wikipedia');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].title, 'Memory');
  assert.match(result.sources[0].url, /wikipedia\.org/);
});

test('persona config is neutral by default and overrides self/user names', () => {
  const neutral = normalizeConfig({});
  assert.equal(neutral.persona.selfName, '助手');
  assert.equal(neutral.persona.userAddress, '你');
  const custom = normalizeConfig({ persona: { selfName: '汐儿', userAddress: '涵儿' } });
  assert.equal(custom.persona.selfName, '汐儿');
  assert.equal(custom.persona.userAddress, '涵儿');
  const facts = extractFactCandidates('我喜欢安静', { selfName: '汐儿', userAddress: '涵儿' });
  assert.equal(facts[0].subject, '涵儿');
});
