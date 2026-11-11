import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('query coverage keeps an exact unique target above a high-importance distractor', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-rank-test-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({
      text: '备份 #2823 第 2823 条合成记忆：只属于这个目标的证书。',
      title: '备份 #2823',
      importance: 0.01,
      explicit: true,
    });
    cortex.write({
      text: '备份 #15 第 15 条合成记忆：另一个高重要性的备份。',
      title: '备份 #15',
      importance: 1,
      explicit: true,
    });
    const result = cortex.search('备份 #2823 第 2823 条合成记忆', { limit: 10 });
    assert.ok(result.items.length >= 1);
    assert.equal(result.items[0].title, '备份 #2823');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
