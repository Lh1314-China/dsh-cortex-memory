import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('markdown sync merges a human edit by id instead of creating a duplicate', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-md-sync-'));
  const vault = path.join(dir, 'vault');
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const written = cortex.write({ text: '一条测试记忆。', title: '原题', explicit: true });
    const id = written.trace.id;
    cortex.exportMarkdown(vault);
    const file = path.join(vault, 'MEMORY.md');
    const before = readFileSync(file, 'utf8');
    assert.match(before, new RegExp(id));
    const edited = before.replace('一条测试记忆。', '人工改过的一条记忆。');
    writeFileSync(file, edited, 'utf8');

    const dry = cortex.syncMarkdown(vault, { dryRun: true });
    assert.equal(dry.updated, 1);
    assert.equal(cortex.get(id).content, '一条测试记忆。');

    const result = cortex.syncMarkdown(vault);
    assert.equal(result.updated, 1);
    assert.equal(result.created, 0);
    assert.equal(cortex.get(id).content, '人工改过的一条记忆。');
    assert.equal(cortex.repos.traces.list({ scopeId: 'global', limit: 10 }).length, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
