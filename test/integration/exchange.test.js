import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exportSnapshot, importSnapshot, validateSnapshot } from '../../src/adapters/json.js';
import {
  BASE_MS,
  DAY_MS,
  cleanup,
  makeCortex,
  splitMirrorEntries,
  writeRaw,
  writeVaultEntry,
} from './_helpers.js';

test('JSON snapshot exports, validates, dry-runs, imports and re-imports idempotently', () => {
  const sourceContext = makeCortex();
  const targetContext = makeCortex();
  const source = sourceContext.cortex;
  const target = targetContext.cortex;
  try {
    const promise = source.write({
      text: '快照里的白饭承诺。',
      title: '白饭承诺',
      kind: 'promise',
      tags: ['白饭', '承诺'],
      importance: 0.72,
      explicit: true,
      now: BASE_MS - 2_000,
      facts: [{ subject: '用户', predicate: '答应', objectLiteral: '买白饭', confidence: 0.9 }],
    });
    const second = source.write({ text: '快照里的第二条记忆。', title: '第二条', explicit: true, now: BASE_MS - 1_000 });
    // A different scope must not leak into the default-scope snapshot.
    source.write({ text: '另一个 scope 的记忆。', title: '别处', explicit: true, now: BASE_MS, scopeId: 'other' });
    source.working.add({ text: '写快照导出测试。', priority: 0.8, at: BASE_MS });
    source.goals.add({ title: '完成快照测试', priority: 0.7 });

    const snapshot = exportSnapshot(source);
    assert.equal(snapshot.format, 'dsh-cortex-snapshot');
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.scopeId, 'global');
    assert.ok(Number.isFinite(Date.parse(snapshot.exportedAt)));
    assert.equal(snapshot.traces.length, 2);
    assert.equal(snapshot.facts.length, 1);
    assert.equal(snapshot.entities.length, 1);
    assert.equal(snapshot.working.length, 1);
    assert.equal(snapshot.goals.length, 1);
    assert.ok(snapshot.self?.self?.stage);
    assert.ok(snapshot.traces.some((trace) => trace.id === promise.trace.id));
    assert.ok(snapshot.traces.some((trace) => trace.id === second.trace.id));
    assert.equal(snapshot.traces.some((trace) => trace.content === '另一个 scope 的记忆。'), false);

    const valid = validateSnapshot(snapshot);
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.issues, []);
    assert.equal(valid.version, 1);

    // Malformed and future snapshots are rejected with explicit reasons.
    assert.equal(validateSnapshot(null).ok, false);
    const future = validateSnapshot({ format: 'dsh-cortex-snapshot', version: 2, traces: [], facts: [], entities: [] });
    assert.equal(future.ok, false);
    assert.match(future.issues.join('; '), /newer than/);
    const invalidImport = importSnapshot(target, { format: 'wrong', version: 1, traces: [], facts: [], entities: [] });
    assert.equal(invalidImport.imported, false);
    assert.ok(invalidImport.reasons.includes('format mismatch'));
    assert.equal(target.repos.traces.count(), 0);

    // Dry run reports the work but touches nothing.
    const dry = importSnapshot(target, snapshot, { dryRun: true });
    assert.equal(dry.imported, false);
    assert.equal(dry.version, 1);
    assert.equal(dry.scopeId, 'global');
    assert.equal(dry.traces, 2);
    assert.deepEqual(dry.skipped, []);
    assert.ok(dry.items.every((item) => item.dryRun === true));
    assert.equal(target.repos.traces.count(), 0);
    assert.equal(target.repos.events.count(), 0);

    // Real import recreates traces under new ids, preserving content and time.
    const imported = importSnapshot(target, snapshot);
    assert.equal(imported.imported, true);
    assert.equal(imported.traces, 2);
    assert.deepEqual(imported.skipped, []);
    assert.equal(target.repos.traces.count(), 2);
    assert.equal(target.repos.events.count(), 2);
    const importedPromise = target.repos.traces.list({ limit: 10 }).find((trace) => trace.title === '白饭承诺');
    assert.ok(importedPromise);
    assert.notEqual(importedPromise.id, promise.trace.id);
    assert.equal(importedPromise.content, promise.trace.content);
    assert.equal(importedPromise.kind, 'promise');
    assert.deepEqual(importedPromise.tags, ['白饭', '承诺']);
    assert.equal(importedPromise.recordedAt, promise.trace.recordedAt);
    assert.equal(importedPromise.scopeId, 'global');

    // A re-import is a no-op: same operationIds, no duplicate events or traces.
    const again = importSnapshot(target, snapshot);
    assert.equal(again.imported, true); // the call ran...
    assert.equal(again.traces, 2);
    assert.equal(again.items.every((item) => item.skipped === true), true);
    assert.deepEqual(again.items.map((item) => item.reason), ['idempotent', 'idempotent']);
    assert.equal(target.repos.traces.count(), 2);
    assert.equal(target.repos.events.count(), 2);

    // Empty content is reported per item rather than imported.
    const withEmpty = importSnapshot(target, {
      format: 'dsh-cortex-snapshot',
      version: 1,
      scopeId: 'global',
      traces: [{ id: 'empty-source', content: '' }],
      facts: [],
      entities: [],
    });
    assert.equal(withEmpty.imported, true);
    assert.deepEqual(withEmpty.skipped, [{ id: 'empty-source', reason: 'empty' }]);
    assert.equal(target.repos.traces.count(), 2);

    assert.equal(target.guardian.check().ok, true);
  } finally {
    cleanup(sourceContext, targetContext);
  }
});

test('markdown mirror exports one frontmatter block per active public trace', () => {
  const context = makeCortex();
  const { cortex, dir } = context;
  try {
    const promise = cortex.write({
      text: '白饭的承诺原文。',
      title: '白饭的承诺',
      kind: 'promise',
      tags: ['白饭', '承诺'],
      importance: 0.75,
      explicit: true,
      now: BASE_MS - 2 * DAY_MS,
      facts: [{ subject: '用户', predicate: '答应', objectLiteral: '买白饭', confidence: 0.9 }],
    });
    cortex.write({
      text: '今天学了新技术。',
      title: '技术记录',
      kind: 'utterance',
      tags: ['技术'],
      explicit: true,
      now: BASE_MS - DAY_MS,
    });
    const archived = cortex.write({
      text: '已经归档的旧记忆。',
      title: '旧记忆',
      explicit: true,
      now: BASE_MS - 3 * DAY_MS,
    });
    cortex.forget({ traceId: archived.trace.id, mode: 'archive' });
    cortex.write({
      text: '这是一个 secret：sk-abcdefghijklmnopqrstuvwxyz123456',
      title: '不能导出',
      explicit: true,
      now: BASE_MS - 4 * DAY_MS,
    });
    cortex.engines.skills.create({
      name: '修插件',
      steps: ['看日志', '改一处', '跑测试'],
      state: 'active',
    });

    const mirror = path.join(dir, 'mirror');
    const exported = cortex.exportMarkdown(mirror);
    assert.equal(exported.root, path.resolve(mirror));
    assert.deepEqual(exported.files, ['MEMORY.md', 'SELF.md', 'FACTS.md', 'SKILLS.md']);
    assert.equal(exported.traces, 2); // two active, non-secret traces
    assert.equal(exported.skippedSecrets, 1);
    assert.equal(exported.facts, 1);
    assert.equal(exported.skills, 1);

    const memory = fs.readFileSync(path.join(mirror, 'MEMORY.md'), 'utf8');
    assert.ok(memory.startsWith('# Cortex memory mirror'));
    assert.match(memory, /白饭的承诺原文。/);
    assert.match(memory, /今天学了新技术。/);
    assert.equal(memory.includes('已经归档的旧记忆。'), false);
    assert.equal(memory.includes('sk-abcdefghijklmnop'), false);

    const entries = splitMirrorEntries(memory);
    assert.equal(entries.length, 2);
    const promiseEntry = entries.find((entry) => entry.frontmatter.includes(promise.trace.id));
    assert.ok(promiseEntry);
    assert.match(promiseEntry.frontmatter, /kind: "promise"/);
    assert.match(promiseEntry.frontmatter, /title: "白饭的承诺"/);
    assert.match(promiseEntry.frontmatter, /state: "active"/);
    assert.match(promiseEntry.frontmatter, /tags: \["白饭", "承诺"\]/);
    assert.match(promiseEntry.frontmatter, /recorded_at: "2026-11-09/);
    assert.equal(promiseEntry.body, '白饭的承诺原文。');

    assert.match(fs.readFileSync(path.join(mirror, 'SELF.md'), 'utf8'), /## Identity/);
    assert.match(fs.readFileSync(path.join(mirror, 'FACTS.md'), 'utf8'), /答应/);
    assert.match(fs.readFileSync(path.join(mirror, 'SKILLS.md'), 'utf8'), /修插件/);
  } finally {
    cleanup(context);
  }
});

test('markdown import into a second cortex preserves frontmatter and skips archived entries', () => {
  const sourceContext = makeCortex();
  const targetContext = makeCortex();
  const source = sourceContext.cortex;
  const target = targetContext.cortex;
  try {
    const promise = source.write({
      text: '白饭的承诺原文。',
      title: '白饭的承诺',
      kind: 'promise',
      tags: ['白饭', '承诺'],
      importance: 0.75,
      explicit: true,
      now: BASE_MS - 2 * DAY_MS,
    });
    const tech = source.write({
      text: '今天学了新技术。',
      title: '技术记录',
      kind: 'utterance',
      tags: ['技术'],
      explicit: true,
      now: BASE_MS - DAY_MS,
    });
    const exported = source.exportMarkdown(path.join(sourceContext.dir, 'mirror'));
    const entries = splitMirrorEntries(fs.readFileSync(path.join(exported.root, 'MEMORY.md'), 'utf8'));
    assert.equal(entries.length, 2);

    const vault = path.join(targetContext.dir, 'vault');
    entries.forEach((entry, index) => writeVaultEntry(vault, `entry-${index}.md`, entry));
    writeRaw(vault, 'archived.md', [
      '---',
      'id: "archived-1"',
      'state: "archived"',
      'kind: "utterance"',
      'title: "归档条目"',
      '---',
      '',
      '这段已经归档，不该导入。',
      '',
    ].join('\n'));
    writeRaw(vault, 'empty.md', '---\nid: "empty-1"\nstate: active\n---\n\n');

    const dry = target.importMarkdown(vault, { dryRun: true });
    assert.equal(dry.files, 4);
    assert.equal(dry.imported, 2); // the two active, non-empty entries
    assert.equal(dry.skipped, 2);
    assert.equal(target.repos.traces.count(), 0);

    const imported = target.importMarkdown(vault);
    assert.equal(imported.root, path.resolve(vault));
    assert.equal(imported.files, 4);
    assert.equal(imported.imported, 2);
    assert.equal(imported.skipped, 2);
    assert.equal(target.repos.traces.count(), 2);

    const traces = target.repos.traces.list({ limit: 10 });
    const importedPromise = traces.find((trace) => trace.title === '白饭的承诺');
    assert.ok(importedPromise);
    assert.equal(importedPromise.content, promise.trace.content);
    assert.equal(importedPromise.kind, 'promise');
    assert.deepEqual(importedPromise.tags, ['白饭', '承诺']);
    assert.equal(importedPromise.recordedAt, promise.trace.recordedAt);
    assert.notEqual(importedPromise.id, promise.trace.id);

    const importedTech = traces.find((trace) => trace.title === '技术记录');
    assert.ok(importedTech);
    assert.equal(importedTech.content, tech.trace.content);
    assert.deepEqual(importedTech.tags, ['技术']);
    assert.equal(importedTech.recordedAt, tech.trace.recordedAt);
    assert.equal(traces.some((trace) => trace.content.includes('归档条目')), false);
    // Retrieval still merges the recency source, so assert on snippets rather
    // than expecting the archived text to be absent from every ranking list.
    assert.equal(
      target.search('归档', { now: BASE_MS }).items.some((item) => item.snippet.includes('归档条目')),
      false,
    );

    // Same source ids -> same operation ids -> a re-import is idempotent.
    const again = target.importMarkdown(vault);
    assert.equal(again.imported, 0);
    assert.equal(again.skipped, 4);
    assert.equal(target.repos.traces.count(), 2);
    assert.equal(target.repos.events.count(), 2);
  } finally {
    cleanup(sourceContext, targetContext);
  }
});

test('mirror root import preserves per-trace frontmatter and skips metadata files', () => {
  // MEMORY.md contains several frontmatter blocks; SELF/FACTS/SKILLS are
  // metadata-only mirrors. The importer splits MEMORY.md and skips the rest.
  const sourceContext = makeCortex();
  const targetContext = makeCortex();
  const source = sourceContext.cortex;
  const target = targetContext.cortex;
  try {
    source.write({
      text: '白饭的承诺原文。',
      title: '白饭的承诺',
      kind: 'promise',
      tags: ['白饭'],
      explicit: true,
      now: BASE_MS - DAY_MS,
    });
    source.write({
      text: '今天学了新技术。',
      title: '技术记录',
      explicit: true,
      now: BASE_MS,
    });
    const mirror = source.exportMarkdown(path.join(sourceContext.dir, 'mirror'));
    assert.equal(splitMirrorEntries(fs.readFileSync(path.join(mirror.root, 'MEMORY.md'), 'utf8')).length, 2);

    const result = target.importMarkdown(mirror.root);
    assert.equal(result.files, 4);
    assert.equal(result.imported, 2);
    assert.equal(result.skipped, 3);
    assert.deepEqual(result.items.filter((item) => !item.skipped).map((item) => item.title).sort(), ['技术记录', '白饭的承诺']);
    assert.equal(target.repos.traces.count(), 2);
    const promise = target.repos.traces.list({ limit: 10 }).find((trace) => trace.title === '白饭的承诺');
    assert.ok(promise);
    assert.equal(promise.kind, 'promise');
    assert.deepEqual(promise.tags, ['白饭']);
    assert.match(promise.content, /白饭的承诺原文/);
  } finally {
    cleanup(sourceContext, targetContext);
  }
});
