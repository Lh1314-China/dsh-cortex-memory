import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createToolDefinitions } from '../../src/tools/definitions.js';

async function healthText(cortex) {
  const tool = createToolDefinitions(cortex).find((entry) => entry.name === 'cortex_health');
  assert.ok(tool, '应存在 cortex_health 工具');
  const result = await tool.execute({});
  return typeof result === 'string' ? result : (result?.text ?? JSON.stringify(result));
}

test('cortex_health 文本会显示维护耗时与「最近一次有变更」', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-health-text-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const now = Date.now();
    // 一条旧的「有变更」审计行（6 小时前）
    cortex.repos.audit.record({ actor: 'self:maintain', action: 'maintain.run', targetType: 'scope', targetId: 'global', detail: { at: new Date(now - 6 * 3600000).toISOString(), working: 7, intentions: 3 } });
    // 一次安静维护 → 内存里有耗时，但不写审计行
    cortex.maintain({ now });
    const text = await healthText(cortex);
    assert.match(text, /维护：最近一趟/, '应显示最近一趟');
    assert.match(text, /\d+ms/, '应显示维护耗时');
    assert.match(text, /最近一次有变更：/, '旧审计行应单独说明');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
