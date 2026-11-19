import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('labelEntities 在缺 adapter 时也返回 no-llm-adapter，与巩固标签一致', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-label-no-adapter-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const result = await cortex.labelEntities({ scopeId: 'global' });
    assert.equal(result.skipped, 'no-llm-adapter');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
