import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createTargetResolver } from '../../src/self/alias.js';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createRelationshipStore } from '../../src/self/relationship.js';
import { createEmotionModel } from '../../src/self/emotion.js';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-alias-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db };
}

test('resolver folds common aliases onto the configured user address', () => {
  const { resolveTarget, canonical } = createTargetResolver({ userAddress: '用户' });
  assert.equal(canonical, '用户');
  assert.equal(resolveTarget('用户'), '用户');
  assert.equal(resolveTarget('用户'), '用户');
  assert.equal(resolveTarget(' 用户 '), '用户');
  assert.equal(resolveTarget('小忆'), '小忆');
  const custom = createTargetResolver({ userAddress: '用户', userAliases: ['阿澈'] });
  assert.equal(custom.resolveTarget('阿澈'), '用户');
});

test('relationship writes through an alias land on the canonical target', () => {
  const { dir, db } = tempDb();
  try {
    const { resolveTarget } = createTargetResolver({ userAddress: '用户' });
    const store = createRelationshipStore(db, { resolveTarget });
    store.applyDelta('global', '用户', { trustDelta: 0.2, careDelta: 0.3 }, { event: 'feedback:helpful' });
    assert.equal(store.list('global').length, 1);
    assert.equal(store.list('global')[0].target, '用户');
    assert.ok(store.get('global', '用户').trust > 0.5);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('emotion records through an alias land on the canonical target', () => {
  const { dir, db } = tempDb();
  try {
    const { resolveTarget } = createTargetResolver({ userAddress: '用户' });
    const emotion = createEmotionModel({ db, resolveTarget });
    emotion.record({ text: '用户说今天很开心。', target: '用户' });
    const targets = emotion.targets();
    assert.equal(targets.length, 1);
    assert.equal(targets[0].target, '用户');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maintain merges pre-existing alias rows into the canonical target', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-alias-merge-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), persona: { userAddress: '用户' } } });
  try {
    const at = '2026-11-15T05:00:00.000Z';
    cortex.db.prepare(`
      INSERT INTO relationships(id, scope_id, target, trust, care, familiarity, expectations_json, boundaries_json, recent_json, updated_at)
      VALUES ('rel_a', 'global', '用户', 0.6, 0.6, 0.2, '[]', '[]', '[]', ?), ('rel_b', 'global', '你', 0.7, 0.5, 0.3, '[]', '[]', '[]', ?)
    `).run(at, at);
    cortex.db.prepare(`
      INSERT INTO affect_targets(scope_id, target, scores_json, count, attitude, updated_at)
      VALUES ('global', '用户', '{"暖":3}', 3, '暖', ?), ('global', '你', '{"甜":2}', 2, '甜', ?)
    `).run(at, at);
    const report = cortex.maintain({ now: Date.parse(at), scopeId: 'global' });
    assert.equal(report.aliases, 2);
    const rels = cortex.stores.relationshipStore.list('global');
    assert.equal(rels.length, 1);
    assert.equal(rels[0].target, '用户');
    assert.ok(rels[0].trust >= 0.7, 'trust keeps the higher value');
    const affect = cortex.emotion.targets();
    assert.equal(affect.length, 1);
    assert.equal(affect[0].target, '用户');
    assert.equal(affect[0].count, 5);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
