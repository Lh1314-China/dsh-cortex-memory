import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../../src/observability/metrics.js';

test('metrics aggregate counters and percentiles', () => {
  const metrics = createMetrics();
  metrics.inc('writes');
  metrics.inc('writes', 2);
  metrics.observe('search.ms', 10);
  metrics.observe('search.ms', 20);
  metrics.observe('search.ms', 30);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.writes, 3);
  assert.equal(snapshot.histograms['search.ms'].count, 3);
  assert.equal(snapshot.histograms['search.ms'].p50, 20);
  assert.equal(snapshot.histograms['search.ms'].max, 30);
  metrics.reset();
  assert.equal(metrics.snapshot().counters.writes, undefined);
});

test('metrics ignore non-finite observations', () => {
  const metrics = createMetrics();
  metrics.observe('x', NaN);
  metrics.observe('x', 'bad');
  assert.equal(metrics.snapshot().histograms.x?.count ?? 0, 0);
});
