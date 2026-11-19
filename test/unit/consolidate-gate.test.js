import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('without an LLM, consolidation does not record identical skipped runs twice', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-consolidate-gate-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({ text: '用户：今天想去看海。', kind: 'utterance', title: '今天想去看海', explicit: true });
    const first = await cortex.consolidation.run({ scopeId: 'global' });
    assert.equal(first.run.status, 'skipped');
    assert.equal(first.run.error, 'no-llm-adapter');
    const second = await cortex.consolidation.run({ scopeId: 'global' });
    assert.equal(second.skipped, 'unchanged', '第二次应识别为未变化并跳过记录');
    assert.equal(cortex.consolidation.list({ scopeId: 'global', limit: 10 }).length, 1, '不应多写一行');
    const forced = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(forced.run.status, 'skipped');
    assert.equal(cortex.consolidation.list({ scopeId: 'global', limit: 10 }).length, 2, 'force 时仍会记录');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
