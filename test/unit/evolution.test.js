import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-evolution-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('policies are versioned, activated and rolled back', () => {
  const { dir, cortex } = setup();
  try {
    const first = cortex.evolution.propose({ kind: 'retrieval', config: { confidenceWeight: 0.2 }, rationale: 'v1' });
    const second = cortex.evolution.propose({ kind: 'retrieval', config: { confidenceWeight: 0.3 }, rationale: 'v2' });
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    cortex.evolution.approve(first.id);
    assert.equal(cortex.policies.active('retrieval').id, first.id);
    cortex.evolution.approve(second.id);
    assert.equal(cortex.policies.active('retrieval').id, second.id);
    const rolled = cortex.evolution.rollback('retrieval', first.id);
    assert.equal(rolled.id, first.id);
    assert.equal(cortex.policies.active('retrieval').id, first.id);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('approved retrieval policy changes the live retrieval budget', () => {
  const { dir, cortex } = setup();
  try {
    cortex.write({ text: '用户说会买米食。', explicit: true });
    const policy = cortex.evolution.propose({ kind: 'retrieval', config: { budget: 100 }, rationale: 'small budget' });
    cortex.evolution.approve(policy.id);
    const result = cortex.search('米食', { budget: 5000 });
    assert.equal(result.budget.total, 100);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selfOptimize proposes a skill demotion when success rate is low', () => {
  const { dir, cortex } = setup();
  try {
    const skill = cortex.engines.skills.create({ name: '不靠谱的技能', steps: ['a'], state: 'active' });
    cortex.engines.skills.record(skill.id, false);
    cortex.engines.skills.record(skill.id, false);
    cortex.engines.skills.record(skill.id, false);
    const result = cortex.evolution.selfOptimize();
    assert.ok(result.proposals.some((item) => item.kind === 'skill' && item.config.skillId === skill.id));
    assert.equal(cortex.policies.active('skill'), null);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('identity proposals require explicit approval', () => {
  const { dir, cortex } = setup();
  try {
    const proposal = cortex.evolution.proposeIdentity({
      content: { narrative: '我是一只在学习长大的鲸鱼。', values: ['诚实'], boundaries: ['不操纵'] },
      rationale: 'after a meaningful episode',
    });
    assert.equal(proposal.status, 'proposed');
    const activeBefore = cortex.stores.identityStore.active('global');
    const approved = cortex.evolution.approveIdentity(proposal.id, { approvedBy: 'user' });
    assert.equal(approved.status, 'active');
    assert.notEqual(approved.id, activeBefore.id);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evolution can evaluate a candidate policy and persist metrics', async () => {
  const { dir, cortex } = setup();
  try {
    const policy = cortex.evolution.propose({ kind: 'retrieval', config: { budget: 300 }, rationale: 'evaluate me' });
    const queries = [{ query: '米食', relevant: ['a'] }, { query: '插件', relevant: ['b'] }];
    const evaluated = await cortex.evolution.evaluate({
      id: policy.id,
      queries,
      current: async (query) => ({ items: query === '米食' ? [{ id: 'x' }] : [{ id: 'b' }] }),
      candidate: async (query) => ({ items: query === '米食' ? [{ id: 'a' }] : [{ id: 'b' }] }),
    });
    assert.ok(evaluated.metrics);
    assert.ok(evaluated.comparison.delta.recallAtK > 0);
    assert.equal(cortex.policies.get(policy.id).metrics.before.recallAtK, 0.5);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an approved initiative policy changes the live step output', () => {
  const { dir, cortex } = setup();
  try {
    const policy = cortex.evolution.propose({ kind: 'initiative', config: { maxPerTurn: 0 }, rationale: 'quiet' });
    cortex.evolution.approve(policy.id);
    const result = cortex.step({ text: '用户是坏蛋，助手讨厌你。', explicit: true });
    assert.equal(result.intentions.length, 0);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
