/**
 * Load, concurrency and durability integration tests for dsh-cortex.
 *
 * These tests are intentionally black-box: every cortex below is real, every
 * database is a throwaway SQLite file under the OS temp directory, and nothing
 * is mocked. The goal is to catch realistic regressions that small unit tests
 * miss: a 1000-3000 trace ingestion, several live instances, budget exhaustion,
 * vector + FTS search under repetitive use, backup/restore and retention/privacy
 * over a full-sized database.
 *
 * Timing policy
 * -------------
 * Only loose upper bounds are asserted (60 seconds). A load test that fails
 * because CI is having a slow minute is worse than no load test; the exact
 * throughput is reported with t.diagnostic so a human can still notice drift.
 *
 * Same-database concurrency
 * -------------------------
 * This suite never opens two cortex instances on the same database file. The
 * service's SQLite setup (WAL, foreign keys, BEGIN IMMEDIATE, 5 second busy
 * timeout) is safe for sequential host use, but it has no cross-instance
 * coordination, retry loop or process-wide lock. Two independent cortex
 * objects sharing one file can therefore hit SQLITE_BUSY, race a write against
 * a read, or observe each other's half-finished logical operations. Rather than
 * treating that as a supported mode, the concurrency test uses one database per
 * instance and documents the limitation here. If shared-database access is ever
 * required it should be designed and tested explicitly, not inferred.
 *
 * Cleanup
 * -------
 * Every cortex is closed in a finally block before its temp directory is
 * removed. The concurrency test also closes every instance independently so a
 * single failure cannot leak a handle into the shared root.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { createCortex } from '../../src/service/cortex.js';
import { createScheduler } from '../../src/host/scheduler.js';

const DAY_MS = 86_400_000;
/** Fixed reference instant: 2026-11-11T10:00:00+08:00, matching the suite. */
const BASE_MS = Date.parse('2026-11-11T10:00:00+08:00');
/** Loose CI ceiling for a single load phase. Never tighten this to benchmark. */
const LOAD_BOUND_MS = 60_000;
const SCOPE = 'global';

const LOAD_WORDS = [
  '鲸鱼', '白饭', '潮汐', '星图', '海风', '灯塔',
  '月光', '小鱼', '用户', '薄荷', '玻璃', '海盐',
];

const LOAD_ACTIONS = [
  '记录', '想起', '数着', '藏着', '写着', '整理', '等待', '看见',
];

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Build deterministic, short, unique trace inputs.
 *
 * The index is embedded in both the text and the operationId so every trace has
 * a different content hash and every replay can be checked by its own ledger
 * key. Randomness is only used to vary shape; the seed makes the dataset stable
 * across runs and machines.
 */
function syntheticInputs({
  count,
  seed = 42,
  prefix = 'load',
  startMs = BASE_MS,
  stepMs = 1_000,
  importance = null,
  confidence = null,
  extraTokens = [],
  titlePrefix = null,
} = {}) {
  const random = mulberry32(seed);
  const extra = extraTokens.length ? ` ${extraTokens.join(' ')}` : '';
  return Array.from({ length: count }, (_, index) => {
    const first = LOAD_WORDS[Math.floor(random() * LOAD_WORDS.length)];
    const second = LOAD_WORDS[Math.floor(random() * LOAD_WORDS.length)];
    const action = LOAD_ACTIONS[Math.floor(random() * LOAD_ACTIONS.length)];
    const input = {
      text: `${prefix}-${index} ${first}${action}${second}${extra}`,
      title: `${titlePrefix ?? prefix}-${index}`,
      tags: [prefix, first],
      explicit: true,
      operationId: `${prefix}:${index}`,
      now: startMs + index * stepMs,
    };
    if (importance != null) input.importance = importance;
    if (confidence != null) input.confidence = confidence;
    return input;
  });
}

/** Unique temporary root for one test; callers own its removal. */
function makeRoot(label) {
  return mkdtempSync(path.join(os.tmpdir(), `cortex-load-${label}-`));
}

/** Open a real cortex against a fresh data directory inside root. */
function openCortex(root, overrides = {}) {
  const dataRoot = path.join(root, 'data');
  const dbFile = path.join(dataRoot, 'cortex.sqlite');
  return createCortex({ config: { dataRoot, dbFile, ...overrides } });
}

function closeQuietly(cortex) {
  if (!cortex) return;
  try {
    cortex.close();
  } catch {
    /* best-effort close: cleanup must not mask the real test failure */
  }
}

function removeQuietly(root) {
  if (!root) return;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* temporary directories are disposable; never fail a test on cleanup */
  }
}

function countTraces(cortex, state = null) {
  return cortex.repos.traces.count({ scopeId: SCOPE, state });
}

/**
 * Duplicate hashes are the write path's dedupe signal and a strong integrity
 * check for synthetic data. Both the repository helper and a direct SQL count
 * are checked so a bug in either path is visible.
 */
function assertUniqueHashes(cortex, expectedCount = null) {
  const duplicates = cortex.repos.traces.duplicateHashes(SCOPE, { limit: 100 });
  assert.deepEqual(duplicates, [], `found duplicate content hashes: ${JSON.stringify(duplicates)}`);
  const row = cortex.db
    .prepare('SELECT COUNT(DISTINCT hash) AS c FROM traces WHERE scope_id = ?')
    .get(SCOPE);
  const distinct = Number(row?.c ?? 0);
  assert.equal(distinct, expectedCount ?? countTraces(cortex));
}

/** Search must report its failures in the trace, not silently mislabel a source. */
function assertNoFailedSources(result) {
  for (const source of result.trace?.sources ?? []) {
    assert.notEqual(
      source.ok,
      false,
      `retrieval source ${source.source} failed: ${source.error ?? 'unknown error'}`,
    );
  }
}

/** Shape checks shared by successful and blocked search results. */
function assertWellFormedSearch(result, expectedQuery) {
  assert.equal(result.query, expectedQuery);
  assert.equal(result.scopeId, SCOPE);
  assert.ok(Array.isArray(result.items));
  assert.ok(Array.isArray(result.trace?.sources));
  assert.ok(result.trace?.elapsedMs >= 0);
  const ids = result.items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(result.budget.total >= result.budget.used);
}

test('writeMany ingests 2000 deterministic traces within the loose load bound', (t) => {
  const root = makeRoot('write-many');
  let cortex = null;
  try {
    cortex = openCortex(root);
    const count = 2000;
    const inputs = syntheticInputs({ count, seed: 20261111, prefix: 'load' });

    const started = performance.now();
    const results = cortex.writeMany(inputs, { chunkSize: 250 });
    const elapsedMs = performance.now() - started;

    assert.equal(results.length, count);
    assert.equal(results.filter((result) => result.skipped === false).length, count);
    assert.equal(results.every((result) => result.trace), true);
    assert.equal(countTraces(cortex), count);
    assert.equal(cortex.repos.events.count(), count);
    assert.equal(cortex.repos.traces.ftsCount(), count);
    assertUniqueHashes(cortex, count);

    // Every returned trace id is distinct, and the order matches the input order.
    assert.equal(new Set(results.map((result) => result.trace.id)).size, count);
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      assert.equal(results[index].trace.content, inputs[index].text);
      assert.equal(cortex.get(results[index].trace.id).title, inputs[index].title);
    }

    // Metrics are attempt-level; a chunked run must at least account for every
    // created trace. Do not assert an exact value here: rollback accounting is
    // covered by the unit suite and is not the point of this load test.
    assert.ok((cortex.metrics().counters['writes.created'] ?? 0) >= count);

    t.diagnostic(
      `writeMany: ${count} traces in ${Math.round(elapsedMs)} ms `
      + `(${Math.round((count / Math.max(1, elapsedMs)) * 1000)} writes/s)`,
    );
    assert.ok(
      elapsedMs < LOAD_BOUND_MS,
      `writeMany took ${Math.round(elapsedMs)} ms, exceeding the ${LOAD_BOUND_MS} ms loose bound`,
    );
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    closeQuietly(cortex);
    removeQuietly(root);
  }
});

test('Promise.all over independent cortex instances on distinct DBs completes without cross-talk', async (t) => {
  const root = makeRoot('concurrent');
  const base = path.join(root, 'instances');
  const instanceCount = 4;
  const perInstance = 300;
  const started = performance.now();
  try {
    mkdirSync(base, { recursive: true });
    const results = await Promise.all(
      Array.from({ length: instanceCount }, async (_, index) => {
        const dir = path.join(base, `instance-${index}`);
        const cortex = openCortex(dir);
        try {
          // Let all four instances finish opening before any of them writes.
          // This is scheduling, not a barrier; the instances still never share
          // a database or a service object.
          await new Promise((resolve) => setTimeout(resolve, index * 5));

          const marker = `marker${index}alpha`;
          const inputs = syntheticInputs({
            count: perInstance,
            seed: 5000 + index,
            prefix: `concurrent${index}`,
            startMs: BASE_MS + index * DAY_MS,
            extraTokens: [marker],
          });
          const written = cortex.writeMany(inputs, { chunkSize: 100 });

          assert.equal(written.length, perInstance);
          assert.equal(countTraces(cortex), perInstance);
          assert.equal(cortex.repos.events.count(), perInstance);
          assertUniqueHashes(cortex, perInstance);

          const ownHits = cortex.repos.traces.searchFts(marker, {
            scopeId: SCOPE,
            limit: 5,
          });
          assert.ok(ownHits.length >= 1, `instance ${index} cannot find its own marker`);

          // Cross-contamination is checked at the FTS projection instead of
          // through cortex.search(), because search always adds recent traces
          // as a fallback source even when the query has no lexical hit.
          const otherMarker = `marker${(index + 1) % instanceCount}alpha`;
          const foreignHits = cortex.repos.traces.searchFts(otherMarker, {
            scopeId: SCOPE,
            limit: 5,
          });
          assert.deepEqual(foreignHits, [], `instance ${index} sees another instance's marker`);

          const found = cortex.search(marker, { limit: 5 });
          assertWellFormedSearch(found, marker);
          assert.ok(found.items.length >= 1);
          assertNoFailedSources(found);

          return {
            index,
            dbFile: cortex.config.dbFile,
            traces: countTraces(cortex),
            events: cortex.repos.events.count(),
            ownHits: ownHits.length,
          };
        } finally {
          closeQuietly(cortex);
        }
      }),
    );

    const elapsedMs = performance.now() - started;
    assert.equal(results.length, instanceCount);

    // The whole point of the test: distinct databases, not a shared file.
    assert.equal(new Set(results.map((result) => result.dbFile)).size, instanceCount);
    for (const result of results) {
      assert.equal(result.traces, perInstance);
      assert.equal(result.events, perInstance);
      assert.ok(result.ownHits >= 1);
    }

    // Reopen each cluster's database independently after every cortex is
    // closed. A count of exactly 300 here proves the instances did not write
    // into each other's file and that close() did not lose committed rows.
    for (const result of results) {
      const snapshot = new DatabaseSync(result.dbFile);
      try {
        assert.equal(
          Number(snapshot.prepare('SELECT COUNT(*) AS c FROM traces').get().c),
          perInstance,
        );
        assert.equal(
          Number(snapshot.prepare('SELECT COUNT(*) AS c FROM events').get().c),
          perInstance,
        );
      } finally {
        snapshot.close();
      }
    }

    t.diagnostic(
      `concurrent: ${instanceCount} instances x ${perInstance} traces in `
      + `${Math.round(elapsedMs)} ms on distinct DB files`,
    );
    assert.ok(
      elapsedMs < LOAD_BOUND_MS,
      `concurrent run took ${Math.round(elapsedMs)} ms, exceeding the ${LOAD_BOUND_MS} ms loose bound`,
    );
  } finally {
    removeQuietly(root);
  }
});

test('search budget exhaustion returns blocked traces and scheduler.runOnce survives load', async (t) => {
  const root = makeRoot('budget-scheduler');
  let cortex = null;
  try {
    // Six successful searches per hour is enough to exercise the guard without
    // writing a hundred traces just to spend the budget.
    cortex = openCortex(root, { maxCallsPerHour: 6 });
    const count = 1000;
    cortex.writeMany(syntheticInputs({ count, seed: 31, prefix: 'budget' }), {
      chunkSize: 250,
    });
    assert.equal(countTraces(cortex), count);

    const query = '鲸鱼';
    for (let index = 0; index < 6; index += 1) {
      const result = cortex.search(query, { limit: 5 });
      assertWellFormedSearch(result, query);
      assert.equal(result.trace.blocked, undefined);
      assert.ok(result.items.length >= 1);
      assertNoFailedSources(result);
    }
    assert.equal(cortex.budget.snapshot().calls, 6);
    assert.equal(cortex.budget.snapshot().remainingCalls, 0);

    // Every call after exhaustion must be a clean blocked result. Repeating it
    // is important: a blocked path must not leak state or throw on later calls.
    for (let index = 0; index < 10; index += 1) {
      const result = cortex.search(query, { limit: 5 });
      assertWellFormedSearch(result, query);
      assert.equal(result.trace.blocked, 'budget');
      assert.equal(result.trace.candidates, 0);
      assert.equal(result.trace.selected, 0);
      assert.deepEqual(result.items, []);
      assert.deepEqual(result.budget, { used: 0, total: 0 });
    }
    assert.equal(cortex.budget.snapshot().calls, 6);

    assert.doesNotThrow(() => {
      const repeated = cortex.search(query, { limit: 5 });
      assert.equal(repeated.trace.blocked, 'budget');
    });

    // The scheduler is a host heartbeat, not a search caller. Its runOnce must
    // remain safe on a large database even when search is currently blocked,
    // and it must drain jobs through the real runner API.
    const scheduler = createScheduler({ cortex, intervalMs: 60_000 });
    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(await scheduler.runOnce());
    }
    assert.equal(reports.length, 3);
    for (const report of reports) {
      assert.ok(report.at);
      assert.ok(report.steps.autonomy);
      assert.ok(report.steps.jobs);
      assert.ok(report.steps.retention);
      assert.equal(report.steps.retention.active, count);
      assert.ok(report.steps.retention.candidates <= 20);
      assert.ok(report.steps.guardian);
      assert.equal(report.steps.guardian.ok, true);
      assert.ok(['ok', 'light'].includes(report.steps.guardian.integrity));
      assert.deepEqual(report.steps.guardian.issues, []);
    }

    // A scheduler tick must not reset the search budget behind the caller's
    // back. The next search is still blocked, and the service still does not
    // throw after the ticks.
    const afterScheduler = cortex.search(query, { limit: 5 });
    assert.equal(afterScheduler.trace.blocked, 'budget');
    assert.deepEqual(afterScheduler.items, []);
    assert.equal(scheduler.status().running, false);

    t.diagnostic(
      `budget: ${count} traces, 6 allowed searches, 11 blocked searches, 3 scheduler ticks`,
    );
  } finally {
    closeQuietly(cortex);
    removeQuietly(root);
  }
});

test('writeMany replay at scale is idempotent for every operationId', (t) => {
  const root = makeRoot('idempotency');
  let cortex = null;
  try {
    cortex = openCortex(root);
    const count = 1200;
    const inputs = syntheticInputs({ count, seed: 777, prefix: 'idem' });

    const first = cortex.writeMany(inputs, { chunkSize: 173 });
    assert.equal(first.length, count);
    assert.equal(first.filter((result) => result.skipped === false).length, count);
    assert.equal(countTraces(cortex), count);
    assert.equal(cortex.repos.events.count(), count);
    assertUniqueHashes(cortex, count);

    const firstIds = first.map((result) => result.trace.id);
    const eventsAfterFirst = cortex.repos.events.count();

    // Replay the entire batch with a different chunk size. The ledger key is
    // the operationId, so every item must resolve to the original trace and
    // neither the trace count nor the append-only event count may move.
    const started = performance.now();
    const second = cortex.writeMany(inputs, { chunkSize: 97 });
    const replayMs = performance.now() - started;

    assert.equal(second.length, count);
    assert.equal(second.every((result) => result.skipped === true), true);
    assert.equal(second.every((result) => result.reason === 'idempotent'), true);
    assert.equal(second.every((result) => Boolean(result.event) && Boolean(result.trace)), true);
    assert.deepEqual(
      second.map((result) => result.trace.id),
      firstIds,
      'a replay must resolve every operationId back to its original trace',
    );
    assert.equal(countTraces(cortex), count);
    assert.equal(cortex.repos.events.count(), eventsAfterFirst);
    assertUniqueHashes(cortex, count);

    t.diagnostic(
      `idempotency: ${count} traces replayed in ${Math.round(replayMs)} ms `
      + `with no count change`,
    );
    assert.ok(
      replayMs < LOAD_BOUND_MS,
      `replay took ${Math.round(replayMs)} ms, exceeding the ${LOAD_BOUND_MS} ms loose bound`,
    );
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    closeQuietly(cortex);
    removeQuietly(root);
  }
});

test('FTS plus hash-vector retrieval stays healthy across 1000 writes and 50 searches', (t) => {
  const root = makeRoot('vector-search');
  let cortex = null;
  try {
    cortex = openCortex(root, { vectorEnabled: true });
    assert.ok(cortex.vector);
    assert.equal(cortex.vector.model, 'hash-256');
    assert.equal(cortex.vector.dim, 256);
    assert.equal(cortex.vector.status().count, 0);

    const count = 1000;
    const inputs = syntheticInputs({
      count,
      seed: 909,
      prefix: 'vector',
      extraTokens: ['鲸鱼', '白饭', '记忆', 'alpha', 'beta'],
      importance: 0.6,
      confidence: 0.8,
    });
    cortex.writeMany(inputs, { chunkSize: 200 });
    assert.equal(countTraces(cortex), count);
    assert.equal(cortex.repos.traces.ftsCount(), count);
    assert.equal(cortex.vector.status().count, count);

    const queries = ['鲸鱼', '白饭', '记忆', 'alpha', 'beta'];
    const started = performance.now();
    let totalItems = 0;
    for (let index = 0; index < 50; index += 1) {
      const query = queries[index % queries.length];
      const result = cortex.search(query, { limit: 10 });
      assertWellFormedSearch(result, query);
      assert.equal(result.trace.blocked, undefined);
      assertNoFailedSources(result);

      const sources = new Map(result.trace.sources.map((source) => [source.source, source]));
      assert.ok(sources.has('fts'), 'FTS source should participate in retrieval');
      assert.ok(sources.has('vector'), 'vector source should participate in retrieval');
      assert.equal(sources.get('fts').ok, true);
      assert.ok(sources.get('fts').count >= 1);
      assert.equal(sources.get('vector').ok, true);
      assert.ok(sources.get('vector').count >= 1);
      totalItems += result.items.length;
    }
    const searchMs = performance.now() - started;

    assert.ok(totalItems > 0);
    assert.equal(cortex.metrics().counters['search.errors'] ?? 0, 0);
    assert.equal(cortex.metrics().counters['search.calls'] ?? 0, 50);

    // rebuildVector must re-embed every active trace, report the same count,
    // and leave the index usable. The hash embedder makes this deterministic
    // and dependency-free.
    const rebuilt = cortex.rebuildVector();
    assert.equal(rebuilt.rebuilt, count);
    assert.equal(rebuilt.count, count);
    assert.equal(rebuilt.model, 'hash-256');
    assert.equal(rebuilt.dim, 256);
    assert.equal(cortex.vector.status().count, count);
    assert.equal(cortex.settings().vector.model, 'hash-256');

    const afterRebuild = cortex.search('鲸鱼', { limit: 10 });
    assertWellFormedSearch(afterRebuild, '鲸鱼');
    assert.ok(afterRebuild.items.length >= 1);
    assertNoFailedSources(afterRebuild);

    t.diagnostic(
      `vector: ${count} writes, 50 searches in ${Math.round(searchMs)} ms, `
      + `rebuildVector rebuilt=${rebuilt.rebuilt}`,
    );
    assert.ok(
      searchMs < LOAD_BOUND_MS,
      `50 vector searches took ${Math.round(searchMs)} ms, exceeding the ${LOAD_BOUND_MS} ms loose bound`,
    );
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    closeQuietly(cortex);
    removeQuietly(root);
  }
});

test('backup of a 1000-trace DB validates and restores to a temporary path', (t) => {
  const root = makeRoot('backup');
  let cortex = null;
  try {
    cortex = openCortex(root);
    const count = 1000;
    cortex.writeMany(syntheticInputs({ count, seed: 404, prefix: 'backup' }), {
      chunkSize: 250,
    });
    assert.equal(countTraces(cortex), count);
    assert.equal(cortex.repos.events.count(), count);
    assert.equal(cortex.guardian.integrity(), 'ok');

    const backupPath = path.join(root, 'backups', 'load-backup.sqlite');
    const started = performance.now();
    const backup = cortex.guardian.backup(backupPath);
    const backupMs = performance.now() - started;

    assert.equal(backup.path, path.resolve(backupPath));
    assert.ok(backup.bytes > 0);
    assert.ok(backup.at);

    const validation = cortex.guardian.validateBackup(backupPath);
    assert.equal(validation.ok, true);
    assert.equal(validation.integrity, 'ok');
    assert.deepEqual(validation.missing, []);
    assert.ok(validation.tables >= 20);

    const offline = path.join(root, 'restored', 'restored.sqlite');
    const restored = cortex.guardian.restore(backupPath, offline);
    assert.equal(restored.restored, true);
    assert.equal(restored.target, path.resolve(offline));
    assert.equal(restored.validation.ok, true);
    assert.equal(cortex.guardian.validateBackup(offline).ok, true);

    // The restored file is a real, standalone database with the complete
    // trace/event/FTS projection, not just a copy that happens to exist.
    const snapshot = new DatabaseSync(offline);
    try {
      assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(
        Number(snapshot.prepare('SELECT COUNT(*) AS c FROM traces').get().c),
        count,
      );
      assert.equal(
        Number(snapshot.prepare('SELECT COUNT(*) AS c FROM events').get().c),
        count,
      );
      assert.equal(
        Number(snapshot.prepare('SELECT COUNT(*) AS c FROM traces_fts_index').get().c),
        count,
      );
      assert.equal(
        snapshot.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value,
        '6',
      );
    } finally {
      snapshot.close();
    }

    // Restoring over the live database is refused before any copy happens.
    const liveAttempt = cortex.guardian.restore(backupPath, cortex.config.dbFile);
    assert.equal(liveAttempt.restored, false);
    assert.equal(liveAttempt.reason, 'live-db');
    assert.equal(countTraces(cortex), count);

    // The live service is still writable and its own database stayed intact.
    const post = cortex.write({
      text: 'backup test: the live database still accepts writes.',
      explicit: true,
      operationId: 'backup:post',
      now: BASE_MS + 10_000,
    });
    assert.equal(post.skipped, false);
    assert.equal(countTraces(cortex), count + 1);
    assert.equal(cortex.repos.events.count(), count + 1);
    assert.equal(cortex.guardian.check().ok, true);

    t.diagnostic(
      `backup: ${count} traces backed up in ${Math.round(backupMs)} ms, `
      + `validated and restored ${count} traces`,
    );
  } finally {
    closeQuietly(cortex);
    removeQuietly(root);
  }
});

test('retention is bounded on 1000 traces and privacy deleteScope keeps the event ledger', (t) => {
  const root = makeRoot('retention-privacy');
  let cortex = null;
  try {
    cortex = openCortex(root);
    const count = 1000;
    // 800 days old, low importance, below the default confidence gate: exactly
    // the traces retention is allowed to archive, and nothing more.
    const inputs = syntheticInputs({
      count,
      seed: 808,
      prefix: 'retention',
      startMs: BASE_MS - 800 * DAY_MS,
      stepMs: 1_000,
      importance: 0.04,
      confidence: 0.5,
      extraTokens: ['鲸鱼', '白饭'],
    });
    cortex.writeMany(inputs, { chunkSize: 250 });

    assert.equal(countTraces(cortex), count);
    const eventsBefore = cortex.repos.events.count();
    assert.equal(eventsBefore, count);
    assertUniqueHashes(cortex, count);

    const plan = cortex.retention.plan({
      now: BASE_MS,
      maxAgeDays: 365,
      minImportance: 0.2,
      limit: 50,
    });
    assert.equal(plan.active, count);
    assert.equal(plan.count, plan.candidates.length);
    assert.ok(plan.count > 0, 'aged low-value traces should produce retention candidates');
    assert.ok(plan.count <= 50, 'retention plan must respect its limit');
    assert.equal(new Set(plan.candidates.map((candidate) => candidate.id)).size, plan.count);
    for (const candidate of plan.candidates) {
      assert.equal(candidate.reason, 'over-age');
      assert.ok(candidate.ageDays > 365);
      assert.ok(candidate.importance < 0.2);
      assert.ok(candidate.confidence < 0.75);
      assert.ok(cortex.get(candidate.id), 'every plan candidate must still exist');
    }

    // Dry-run is a pure projection: no state changes and no event changes.
    const dry = cortex.retention.apply(plan, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.archived, plan.count);
    assert.deepEqual(dry.ids, plan.candidates.map((candidate) => candidate.id));
    for (const id of dry.ids) assert.equal(cortex.get(id).state, 'active');
    assert.equal(cortex.repos.events.count(), eventsBefore);

    const applied = cortex.retention.apply(plan);
    assert.equal(applied.archived, plan.count);
    assert.deepEqual(applied.ids, dry.ids);
    assert.equal(
      cortex.repos.traces.count({ scopeId: SCOPE, state: 'active' }),
      count - plan.count,
    );
    assert.equal(
      cortex.repos.traces.count({ scopeId: SCOPE, state: 'archived' }),
      plan.count,
    );
    assert.equal(countTraces(cortex), count);
    assert.equal(cortex.repos.events.count(), eventsBefore);
    for (const id of applied.ids) {
      assert.equal(cortex.get(id).state, 'archived');
      assert.equal(cortex.get(id).compression, 'retention');
    }

    // A second plan is still bounded and no longer offers the archived rows.
    const secondPlan = cortex.retention.plan({
      now: BASE_MS,
      maxAgeDays: 365,
      minImportance: 0.2,
      limit: 50,
    });
    assert.equal(secondPlan.active, count - plan.count);
    assert.ok(secondPlan.count <= 50);
    for (const candidate of secondPlan.candidates) {
      assert.equal(cortex.get(candidate.id).state, 'active');
    }

    // Privacy deleteScope removes every trace (active and archived) and every
    // derived index, while preserving the append-only event ledger exactly.
    const deleted = cortex.privacy.deleteScope(SCOPE, {
      actor: 'integration-test',
      reason: 'load-retention',
    });
    assert.equal(deleted.scopeId, SCOPE);
    assert.equal(deleted.removed, true);
    assert.equal(deleted.counts.traces, count);
    assert.equal(countTraces(cortex), 0);
    assert.equal(cortex.repos.traces.ftsCount(), 0);
    assert.equal(cortex.repos.events.count(), eventsBefore);
    const chain = cortex.repos.events.verifyChain();
    assert.equal(chain.ok, true);
    assert.equal(chain.count, eventsBefore);
    assert.equal(cortex.repos.events.list({ limit: 10 }).length, 10);
    assert.equal(cortex.search('鲸鱼').items.length, 0);

    t.diagnostic(
      `retention/privacy: planned ${plan.count} of ${count} traces, `
      + `archived ${applied.archived}, deleted scope, kept ${eventsBefore} events`,
    );
  } finally {
    closeQuietly(cortex);
    removeQuietly(root);
  }
});
