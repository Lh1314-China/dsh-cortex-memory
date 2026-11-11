import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createIdentityStore, normalizeIdentity, renderIdentity } from '../../src/self/identity.js';
import { createRelationshipStore, normalizeRelationship } from '../../src/self/relationship.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-identity-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db };
}

test('identity starts with one active version and only one active at a time', () => {
  const { dir, db } = setup();
  try {
    const store = createIdentityStore(db);
    const first = store.ensure('global');
    assert.equal(first.status, 'active');
    assert.equal(first.version, 1);
    const proposal = store.propose('global', {
      narrative: '我是一只在学习如何长大的鲸鱼。',
      values: ['诚实', '成长'],
      boundaries: ['不操纵'],
    }, { rationale: 'new experience' });
    assert.equal(proposal.status, 'proposed');
    assert.equal(store.active('global').id, first.id);
    const approved = store.approve(proposal.id, 'user');
    assert.equal(approved.status, 'active');
    assert.equal(store.active('global').id, proposal.id);
    assert.equal(store.get(first.id).status, 'superseded');
    const rolled = store.rollbackTo(first.id, 'user');
    assert.equal(rolled.status, 'active');
    assert.equal(store.active('global').id, first.id);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('identity normalizes and renders without dropping boundaries', () => {
  const value = normalizeIdentity({ narrative: '测试', values: ['a'], boundaries: ['不骗人'] });
  assert.equal(value.values[0], 'a');
  assert.ok(value.boundaries.includes('不骗人'));
  assert.match(renderIdentity(value), /边界：不骗人/);
});

test('relationships update trust, care, familiarity and history', () => {
  const { dir, db } = setup();
  try {
    const store = createRelationshipStore(db);
    const initial = store.ensure('global', '主人');
    assert.equal(initial.trust, 0.5);
    assert.equal(initial.care, 0.5);
    const after = store.applyDelta('global', '主人', { trustDelta: 0.2, careDelta: 0.1 }, { event: '一起修插件' });
    assert.ok(after.trust > initial.trust);
    assert.ok(after.care > initial.care);
    assert.ok(after.familiarity > initial.familiarity);
    assert.ok(after.recent.some((item) => item.event.includes('修插件')));
    const clamped = store.applyDelta('global', '主人', { trustDelta: 5 });
    assert.equal(clamped.trust, 1);
    assert.match(store.render('global', '主人'), /信任 100%/);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('relationship normalization clamps and keeps boundaries', () => {
  const value = normalizeRelationship({ target: '月神', trust: 2, care: -1, boundaries: ['别抢主人'] });
  assert.equal(value.trust, 1);
  assert.equal(value.care, 0);
  assert.deepEqual(value.boundaries, ['别抢主人']);
});
