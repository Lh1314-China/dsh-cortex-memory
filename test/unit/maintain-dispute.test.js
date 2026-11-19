import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-dispute-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

function seedDispute(cortex, now) {
  const subject = cortex.repos.entities.upsert({ scopeId: 'global', name: '小明' });
  const early = cortex.repos.entities.upsert({ scopeId: 'global', name: '程序员' });
  const later = cortex.repos.entities.upsert({ scopeId: 'global', name: '设计师' });
  const at = new Date(now).toISOString();
  cortex.repos.facts.resolve({ scopeId: 'global', subjectId: subject.id, predicate: 'is', objectId: early.id, validFrom: at, recordedAt: at });
  const second = cortex.repos.facts.resolve({ scopeId: 'global', subjectId: subject.id, predicate: 'is', objectId: later.id, validFrom: at, recordedAt: at });
  assert.equal(second.action, 'dispute');
  return { subject, disputeId: second.dispute.id };
}

const statusesOf = (cortex, subjectId) =>
  cortex.db.prepare("SELECT status FROM facts WHERE subject_id = ? AND predicate = 'is'").all(subjectId)
    .map((row) => row.status).sort();

test('双方都还是 disputed 的争议不会被误标 resolved', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    const { subject, disputeId } = seedDispute(cortex, now);
    assert.deepEqual(statusesOf(cortex, subject.id), ['disputed', 'disputed']);
    cortex.maintain({ now: now + 1000 });
    const dispute = cortex.db.prepare('SELECT status FROM disputes WHERE id = ?').get(disputeId);
    assert.equal(dispute.status, 'open', 'disputed 不等于失效，争议不能自动结案');
    assert.deepEqual(statusesOf(cortex, subject.id), ['disputed', 'disputed'], '两边都还 disputed 时不能动');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('争议被关掉后留下的孤儿 disputed 事实会被清成 invalidated', () => {
  const { dir, cortex } = setup();
  try {
    const now = Date.now();
    const { subject, disputeId } = seedDispute(cortex, now);
    // 模拟旧版本留下的状态：争议已经 resolved，facts 还挂着 disputed。
    cortex.db.prepare("UPDATE disputes SET status = 'resolved', resolved_at = ?, resolution = 'auto: both facts invalidated' WHERE id = ?")
      .run(new Date(now + 1).toISOString(), disputeId);
    const report = cortex.maintain({ now: now + 2000 });
    assert.ok(report.orphanDisputes >= 2, '两条孤儿 disputed 都要清');
    assert.deepEqual(statusesOf(cortex, subject.id), ['invalidated', 'invalidated']);
    const health = cortex.health({ scopeId: 'global' });
    assert.equal(health.issues.find((issue) => issue.code === 'DISPUTED_FACTS'), undefined);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
