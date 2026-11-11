import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BASE_MS, cleanup, makeCortex } from './_helpers.js';

test('guardian backup validates, restores to an offline path and refuses the live DB', () => {
  const context = makeCortex();
  const { cortex, dir } = context;
  try {
    const written = cortex.write({
      text: '备份前的米食承诺：用户会买米食。',
      title: '米食承诺',
      explicit: true,
      now: BASE_MS,
      facts: [{ subject: '用户', predicate: '答应', objectLiteral: '买米食', confidence: 0.9 }],
    });
    assert.equal(written.skipped, false);
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.repos.facts.list({ scopeId: 'global' }).length, 1);
    assert.equal(cortex.guardian.integrity(), 'ok');

    // --- Backup writes a standalone, integrity-checked SQLite file. ---
    const backupPath = path.join(dir, 'backups', 'cortex-backup.sqlite');
    const backup = cortex.guardian.backup(backupPath);
    assert.equal(backup.path, path.resolve(backupPath));
    assert.ok(path.isAbsolute(backup.path));
    assert.ok(backup.bytes > 0);
    assert.ok(fs.existsSync(backupPath));

    const validation = cortex.guardian.validateBackup(backupPath);
    assert.equal(validation.ok, true);
    assert.equal(validation.integrity, 'ok');
    assert.deepEqual(validation.missing, []);
    assert.ok(validation.tables >= 20);

    assert.deepEqual(cortex.guardian.validateBackup(path.join(dir, 'never-created.sqlite')), {
      ok: false,
      reason: 'missing',
    });

    // --- Restore is only allowed to an offline path. ---
    const offline = path.join(dir, 'offline', 'restored.sqlite');
    const restored = cortex.guardian.restore(backupPath, offline);
    assert.equal(restored.restored, true);
    assert.equal(restored.target, path.resolve(offline));
    assert.equal(restored.validation.ok, true);
    assert.equal(cortex.guardian.validateBackup(offline).ok, true);

    // The restored file is a real database with the backed-up rows.
    const restoredDb = new DatabaseSync(offline);
    try {
      assert.equal(restoredDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(Number(restoredDb.prepare('SELECT COUNT(*) AS c FROM traces').get().c), 1);
      assert.equal(Number(restoredDb.prepare('SELECT COUNT(*) AS c FROM facts').get().c), 1);
      assert.equal(restoredDb.prepare('SELECT content FROM traces LIMIT 1').get().content, '备份前的米食承诺：用户会买米食。');
      assert.equal(restoredDb.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '6');
    } finally {
      restoredDb.close();
    }

    // Restoring over an existing destination keeps a `.before-restore-*` safety copy.
    const second = cortex.guardian.restore(backupPath, offline);
    assert.equal(second.restored, true);
    const safetyCopies = fs.readdirSync(path.dirname(offline)).filter((name) => name.startsWith('restored.sqlite.before-restore-'));
    assert.equal(safetyCopies.length, 1);

    // --- The live DB path is refused before any copy happens. ---
    const liveAttempt = cortex.guardian.restore(backupPath, cortex.config.dbFile);
    assert.equal(liveAttempt.restored, false);
    assert.equal(liveAttempt.reason, 'live-db');
    assert.equal(cortex.repos.traces.count(), 1);
    assert.match(liveAttempt.message, /新路径|离线|关闭/);
    assert.equal(cortex.guardian.validateBackup(cortex.config.dbFile).ok, true);

    // Missing target and missing backup are both safe refusals.
    assert.equal(cortex.guardian.restore(backupPath).reason, 'target-required');
    const missing = cortex.guardian.restore(path.join(dir, 'nope.sqlite'), path.join(dir, 'offline', 'x.sqlite'));
    assert.equal(missing.restored, false);
    assert.equal(missing.reason, 'invalid-backup');
    assert.equal(missing.validation.reason, 'missing');

    // The live service still works after all of that.
    const after = cortex.write({ text: '恢复流程之后仍然可以写入。', explicit: true, now: BASE_MS + 10_000 });
    assert.equal(after.skipped, false);
    assert.equal(cortex.repos.traces.count(), 2);
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});

test('guardian detects FTS drift, checks it, repairs it and re-checks clean', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const first = cortex.write({ text: '第一条用于索引的记忆。', explicit: true, now: BASE_MS });
    const second = cortex.write({ text: '第二条用于索引的记忆。', explicit: true, now: BASE_MS + 1_000 });
    assert.equal(cortex.repos.traces.ftsCount(), 2);
    assert.equal(cortex.guardian.check().ok, true);

    // Simulate a stale/corrupt FTS projection, the exact condition the guardian names.
    cortex.db.prepare('DELETE FROM traces_fts_index WHERE trace_id = ?').run(first.trace.id);
    assert.equal(cortex.repos.traces.ftsCount(), 1);

    const drift = cortex.guardian.check();
    assert.equal(drift.ok, false);
    const issue = drift.issues.find((item) => item.code === 'FTS_DRIFT');
    assert.ok(issue);
    assert.match(issue.message, /FTS 1 \/ traces 2/);

    const repaired = cortex.guardian.repairFts();
    assert.equal(repaired.before, 1);
    assert.equal(repaired.after, 2);
    assert.equal(repaired.reindexed, 2);
    assert.equal(cortex.guardian.check().ok, true);

    // Search still finds both traces after the repair.
    const found = cortex.search('索引', { now: BASE_MS + 2_000, limit: 5 });
    assert.ok(found.items.some((item) => item.id === first.trace.id));
    assert.ok(found.items.some((item) => item.id === second.trace.id));
  } finally {
    cleanup(context);
  }
});

test('privacy deleteScope removes traces/facts/working/goals but keeps the event ledger', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const first = cortex.write({
      text: '用户答应买米食。',
      title: '米食',
      explicit: true,
      now: BASE_MS,
      facts: [{ subject: '用户', predicate: '答应', objectLiteral: '买米食', confidence: 0.9 }],
    });
    const second = cortex.write({
      text: '用户想给助手一个实体。',
      title: '实体',
      explicit: true,
      now: BASE_MS + 1_000,
      facts: [{ subject: '用户', predicate: '想给', object: '助手', confidence: 0.8 }],
    });
    assert.equal(first.skipped, false);
    assert.equal(second.skipped, false);
    assert.equal(cortex.repos.facts.list({ scopeId: 'global' }).length, 2);
    assert.equal(cortex.repos.entities.list({ scopeId: 'global' }).length, 2);

    cortex.feedback({ traceId: first.trace.id, signal: 'used', predicted: 0.7, now: BASE_MS + 2_000 });
    cortex.working.add({ text: '写隐私删除测试。', priority: 0.9, at: BASE_MS });
    cortex.working.add({ text: '已经过期的焦点。', at: BASE_MS, ttlMs: 1_000 });
    const goalOne = cortex.goals.add({ title: '完成集成测试', priority: 0.9 });
    cortex.goals.add({ title: '另一个目标', priority: 0.4 });
    cortex.goals.complete(goalOne.id);

    assert.equal(cortex.working.list({ scopeId: 'global', includeExpired: true }).length, 2);
    assert.equal(cortex.goals.list({ scopeId: 'global' }).length, 2);
    assert.equal(cortex.repos.feedback.list({ scopeId: 'global' }).length, 1);

    const eventsBefore = cortex.repos.events.count();
    assert.equal(eventsBefore, 2);
    const payloadBefore = cortex.repos.events.list({ limit: 10 }).map((event) => event.payload);
    assert.equal(JSON.stringify(payloadBefore).includes('米食'), false); // the ledger stores hashes, never raw text

    const deleted = cortex.privacy.deleteScope('global', { actor: 'user', reason: 'integration-privacy' });
    assert.equal(deleted.scopeId, 'global');
    assert.equal(deleted.removed, true);
    assert.equal(deleted.counts.traces, 2);
    assert.equal(deleted.counts.facts, 2);
    assert.equal(deleted.counts.entities, 2);
    assert.equal(deleted.counts.working, 2);
    assert.equal(deleted.counts.goals, 2);
    assert.equal(deleted.counts.feedback, 1);
    assert.equal(deleted.counts.identity, 1);

    // Scoped content is gone from every derived store.
    assert.equal(cortex.repos.traces.count(), 0);
    assert.equal(cortex.get(first.trace.id), null);
    assert.equal(cortex.get(second.trace.id), null);
    assert.equal(cortex.repos.facts.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.repos.entities.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.working.list({ scopeId: 'global', includeExpired: true }).length, 0);
    assert.equal(cortex.goals.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.repos.feedback.list({ scopeId: 'global' }).length, 0);
    assert.equal(cortex.repos.traces.ftsCount(), 0);

    // The append-only ledger keeps its count and stays verifiable.
    assert.equal(cortex.repos.events.count(), eventsBefore);
    const chain = cortex.repos.events.verifyChain();
    assert.equal(chain.ok, true);
    assert.equal(chain.count, eventsBefore);
    assert.equal(JSON.stringify(cortex.repos.events.list({ limit: 10 }).map((event) => event.payload)).includes('米食'), false);

    // The deletion itself is audited.
    const audit = cortex.repos.audit.list({ limit: 20 });
    const record = audit.find((item) => item.action === 'privacy.delete-scope');
    assert.ok(record);
    assert.equal(record.targetId, 'global');
    assert.equal(record.detail.reason, 'integration-privacy');
    assert.equal(record.detail.counts.traces, 2);

    // Search is empty rather than stale, and the service still accepts new writes.
    assert.equal(cortex.search('米食', { now: BASE_MS + 3_000 }).items.length, 0);
    const rewritten = cortex.write({ text: '删除之后重新开始。', explicit: true, now: BASE_MS + 4_000 });
    assert.equal(rewritten.skipped, false);
    assert.equal(cortex.repos.traces.count(), 1);
    assert.equal(cortex.repos.events.count(), eventsBefore + 1);
    assert.equal(cortex.repos.events.verifyChain().ok, true);
  } finally {
    cleanup(context);
  }
});
