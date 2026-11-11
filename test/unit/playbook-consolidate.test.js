import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('playbook suggest can distill a candidate from consolidation updates', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-suggest-consolidate-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.consolidation.list = () => [{ decisions: [{ action: 'update', content: '以后发版前必须先跑测试。', ids: ['trc_x'] }] }];
    const result = cortex.playbook.suggest({ scopeId: 'global', limit: 1 });
    assert.equal(result.count, 1);
    assert.match(result.candidates[0].body, /发版前必须先跑测试/);
    assert.equal(result.candidates[0].status, 'candidate');
    assert.equal(cortex.playbook.render().count, 0, 'candidate must not be injected before approval');
    cortex.playbook.approve(result.candidates[0].id);
    assert.equal(cortex.playbook.render().count, 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
