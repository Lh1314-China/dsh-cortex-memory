import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemporal, withinWindow, parseDuration, formatRelative } from '../../src/memory/temporal.js';
import { degreeCentrality, pageRank, connectedComponents, labelPropagation, summarizeGraph } from '../../src/engines/graph-analytics.js';

const NOW = Date.parse('2026-11-11T12:00:00+08:00');

test('temporal parser understands relative and absolute windows', () => {
  assert.equal(parseTemporal('今天做了什么', NOW).label, 'today');
  assert.equal(parseTemporal('昨天', NOW).label, 'yesterday');
  assert.equal(parseTemporal('3天前', NOW).label, '3-days-ago');
  assert.equal(parseTemporal('2026-11-05', NOW).label, 'date');
  assert.equal(parseTemporal('没有时间词', NOW), null);
  const window = parseTemporal('今天', NOW);
  assert.equal(withinWindow(new Date(NOW).toISOString(), window), true);
  assert.equal(withinWindow(new Date(NOW - 3 * 86400000).toISOString(), window), false);
});

test('duration and relative formatting work', () => {
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('bad', 42), 42);
  assert.match(formatRelative(new Date(NOW - 5000).toISOString(), NOW), /刚刚/);
  assert.match(formatRelative(new Date(NOW - 2 * 3600000).toISOString(), NOW), /小时前/);
});

test('graph analytics ranks, groups and summarizes', () => {
  const edges = [
    { fromId: 'a', toId: 'b', weight: 2 },
    { fromId: 'b', toId: 'c', weight: 1 },
    { fromId: 'd', toId: 'e', weight: 1 },
  ];
  const degree = degreeCentrality(edges);
  assert.ok(degree.b >= degree.a);
  const rank = pageRank(edges);
  assert.ok(rank.b > 0);
  const components = connectedComponents(edges);
  assert.equal(components.length, 2);
  const communities = labelPropagation(edges);
  assert.equal(communities.length, 2);
  const summary = summarizeGraph(edges);
  assert.equal(summary.nodes, 5);
  assert.equal(summary.edges, 3);
  assert.ok(summary.top.length > 0);
});
