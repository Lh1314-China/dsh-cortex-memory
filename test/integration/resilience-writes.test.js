import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_MS, DAY_MS, cleanup, makeCortex } from './_helpers.js';

test('FTS failure degrades cortex.search to recency instead of throwing', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const first = cortex.write({ text: '米食的承诺：用户会买米食。', title: '米食', explicit: true, now: BASE_MS });
    cortex.write({ text: '另一条普通记忆。', title: '普通', explicit: true, now: BASE_MS + 1_000 });
    assert.equal(first.skipped, false);

    const original = cortex.repos.traces.searchFts;
    try {
      cortex.repos.traces.searchFts = () => {
        throw new Error('fts unavailable');
      };
      const degraded = cortex.search('米食', { now: BASE_MS + 2_000, limit: 5 });
      assert.ok(degraded.items.length >= 1); // recency source still produced candidates
      const ftsSource = degraded.trace.sources.find((source) => source.source === 'fts');
      assert.ok(ftsSource);
      assert.equal(ftsSource.ok, false);
      assert.match(ftsSource.error, /fts unavailable/);
      assert.ok(degraded.trace.candidates >= 1);
    } finally {
      cortex.repos.traces.searchFts = original;
    }

    // Once the repository method is restored, FTS contributes again.
    const healthy = cortex.search('米食', { now: BASE_MS + 3_000, limit: 5 });
    const healthyFts = healthy.trace.sources.find((source) => source.source === 'fts');
    assert.equal(healthyFts.ok, true);
    assert.ok(healthyFts.count >= 1);
    assert.equal(healthy.items[0].id, first.trace.id);
  } finally {
    cleanup(context);
  }
});

test('vector index failures never fail writes or searches, and recovery restores fusion', () => {
  const context = makeCortex({ features: { vector: true } });
  const { cortex } = context;
  try {
    assert.ok(cortex.vector);
    assert.equal(cortex.vector.model, 'hash-256');
    assert.equal(cortex.vector.dim, 256);
    assert.equal(cortex.vector.status().count, 0);

    const first = cortex.write({ text: '向量测试：用户喜欢米食。', title: '向量一', explicit: true, now: BASE_MS });
    assert.equal(first.skipped, false);
    assert.equal(cortex.vector.status().count, 1);

    const originalUpsert = cortex.vector.upsert;
    try {
      cortex.vector.upsert = () => {
        throw new Error('embed failed');
      };
      // encode wraps vector.upsert in try/catch: the trace must still be stored.
      const second = cortex.write({ text: '向量测试：第二条记忆。', title: '向量二', explicit: true, now: BASE_MS + 1_000 });
      assert.equal(second.skipped, false);
      assert.ok(second.trace);
      assert.equal(cortex.repos.traces.count(), 2);
      assert.equal(cortex.vector.status().count, 1); // the failed upsert was skipped
    } finally {
      cortex.vector.upsert = originalUpsert;
    }

    const originalSearch = cortex.vector.search;
    try {
      cortex.vector.search = () => {
        throw new Error('vector search failed');
      };
      const degraded = cortex.search('米食', { now: BASE_MS + 2_000, limit: 5 });
      assert.ok(degraded.items.length >= 1);
      const vectorSource = degraded.trace.sources.find((source) => source.source === 'vector');
      assert.ok(vectorSource);
      assert.equal(vectorSource.ok, false);
      assert.match(vectorSource.error, /vector search failed/);
    } finally {
      cortex.vector.search = originalSearch;
    }

    const healthy = cortex.search('米食', { now: BASE_MS + 3_000, limit: 5 });
    const vectorSource = healthy.trace.sources.find((source) => source.source === 'vector');
    assert.equal(vectorSource.ok, true);
    assert.ok(cortex.vector.search('米食', { limit: 5 }).length >= 1);
    assert.equal(cortex.settings().vector.model, 'hash-256');

    // A rebuild re-embeds every active trace after the earlier failed upsert.
    const rebuilt = cortex.rebuildVector({ scopeId: 'global' });
    assert.equal(rebuilt.rebuilt, 2);
    assert.equal(cortex.vector.status().count, 2);
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});

test('writeMany is chunked, idempotent, duplicate-aware and atomic per chunk', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const batch = [
      { text: '批量一。', operationId: 'batch:1', explicit: true, now: BASE_MS },
      { text: '批量二。', operationId: 'batch:2', explicit: true, now: BASE_MS + 1_000 },
      { text: '批量三。', operationId: 'batch:3', explicit: true, now: BASE_MS + 2_000 },
    ];
    const first = cortex.writeMany(batch, { chunkSize: 2 });
    assert.equal(first.length, 3);
    assert.equal(first.every((result) => result.skipped === false), true);
    assert.equal(cortex.repos.traces.count(), 3);
    assert.equal(cortex.repos.events.count(), 3);

    const second = cortex.writeMany(batch, { chunkSize: 2 });
    assert.equal(second.length, 3);
    assert.equal(second.every((result) => result.skipped === true), true);
    assert.deepEqual(second.map((result) => result.reason), ['idempotent', 'idempotent', 'idempotent']);
    assert.equal(cortex.repos.traces.count(), 3);
    assert.equal(cortex.repos.events.count(), 3);

    // A conflicting operationId aborts the whole chunk, including earlier items.
    assert.throws(
      () => cortex.writeMany([
        { text: '事务内第一条。', operationId: 'transaction:1', explicit: true },
        { text: '内容不同的重放。', operationId: 'batch:1', explicit: true },
      ]),
      /already exists with a different payload/,
    );
    assert.equal(cortex.repos.traces.count(), 3);
    assert.equal(cortex.repos.events.count(), 3);
    assert.equal(cortex.repos.traces.list({ limit: 10 }).some((trace) => trace.content === '事务内第一条。'), false);

    // The same operationId twice inside one batch is collapsed by the ledger.
    const withinBatch = cortex.writeMany([
      { text: '批内重复。', operationId: 'batch:dup', explicit: true },
      { text: '批内重复。', operationId: 'batch:dup', explicit: true },
    ]);
    assert.equal(withinBatch[0].skipped, false);
    assert.equal(withinBatch[1].skipped, true);
    assert.equal(withinBatch[1].reason, 'idempotent');
    assert.equal(cortex.repos.traces.count(), 4);

    // Different operation ids but identical content collapse on the hash index;
    // the ledger still records the attempted write.
    const duplicate = cortex.write({ text: '批量一。', explicit: true, now: BASE_MS + 9_000 });
    assert.equal(duplicate.skipped, true);
    assert.equal(duplicate.reason, 'duplicate');
    assert.equal(duplicate.trace.id, first[0].trace.id);
    assert.equal(cortex.repos.traces.count(), 4);
    assert.equal(cortex.repos.events.count(), 5);

    const metrics = cortex.metrics();
    // `writes.created` is incremented inside write(), before the chunk commits,
    // so the rolled-back chunk still contributes one attempt-level count.
    assert.ok(metrics.counters['writes.created'] >= 4);
    assert.ok(metrics.counters['writes.skipped'] >= 4);
    assert.equal(cortex.guardian.check().ok, true);

    const empty = cortex.writeMany([]);
    assert.deepEqual(empty, []);
  } finally {
    cleanup(context);
  }
});

test('retention dry-run does not mutate; apply archives old low-value traces only', () => {
  const context = makeCortex();
  const { cortex } = context;
  try {
    const oldLow = cortex.write({
      text: '保留测试：很久以前的小事。',
      explicit: true,
      importance: 0.05,
      now: BASE_MS - 400 * DAY_MS,
    });
    const oldHigh = cortex.write({
      text: '保留测试：很重要旧事。',
      explicit: true,
      importance: 0.9,
      now: BASE_MS - 400 * DAY_MS,
    });
    const oldReflection = cortex.write({
      text: '保留测试：很久以前的反思。',
      kind: 'reflection',
      explicit: true,
      importance: 0.05,
      now: BASE_MS - 400 * DAY_MS,
    });
    const freshLow = cortex.write({
      text: '保留测试：昨天的小事。',
      explicit: true,
      importance: 0.05,
      now: BASE_MS - DAY_MS,
    });
    assert.equal(cortex.repos.traces.count(), 4);

    const plan = cortex.retention.plan({ now: BASE_MS, maxAgeDays: 365, minImportance: 0.2, limit: 100 });
    assert.equal(plan.active, 4);
    assert.equal(plan.count, 1);
    assert.deepEqual(plan.candidates.map((candidate) => candidate.id), [oldLow.trace.id]);
    assert.equal(plan.candidates[0].reason, 'over-age');
    assert.ok(plan.candidates[0].ageDays > 365);
    assert.ok(plan.candidates[0].importance < 0.2);
    assert.ok(plan.candidates[0].confidence < 0.75);

    const eventsBefore = cortex.repos.events.count();
    const dry = cortex.retention.apply(plan, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.archived, 1);
    assert.deepEqual(dry.ids, [oldLow.trace.id]);
    assert.equal(cortex.get(oldLow.trace.id).state, 'active');
    assert.equal(cortex.repos.events.count(), eventsBefore);

    const applied = cortex.retention.apply(plan);
    assert.equal(applied.archived, 1);
    assert.deepEqual(applied.ids, [oldLow.trace.id]);
    const archived = cortex.get(oldLow.trace.id);
    assert.equal(archived.state, 'archived');
    assert.equal(archived.compression, 'retention');
    assert.equal(cortex.get(oldHigh.trace.id).state, 'active');
    assert.equal(cortex.get(oldReflection.trace.id).state, 'active');
    assert.equal(cortex.get(freshLow.trace.id).state, 'active');
    assert.equal(cortex.repos.traces.ftsCount(), 4); // FTS keeps its projection for state flips
    assert.equal(cortex.repos.events.count(), eventsBefore);

    // A second plan no longer offers the archived trace.
    const secondPlan = cortex.retention.plan({ now: BASE_MS, maxAgeDays: 365, minImportance: 0.2 });
    assert.equal(secondPlan.active, 3);
    assert.deepEqual(secondPlan.candidates, []);

    // Over-count candidates are explainable too; reflections stay out of retention.
    const overCount = cortex.retention.plan({ now: BASE_MS, maxTraces: 0, maxAgeDays: 3_650, minImportance: 0.2 });
    assert.deepEqual(overCount.candidates.map((candidate) => candidate.id), [freshLow.trace.id]);
    assert.equal(overCount.candidates[0].reason, 'over-count');

    assert.deepEqual(cortex.retention.apply(null), { archived: 0, dryRun: false });
    assert.equal(cortex.guardian.check().ok, true);
  } finally {
    cleanup(context);
  }
});
