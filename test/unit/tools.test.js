import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createToolDefinitions } from '../../src/tools/definitions.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-tools-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), scope: 'global' } });
  const tools = Object.fromEntries(createToolDefinitions(cortex).map((tool) => [tool.name, tool]));
  return { dir, cortex, tools };
}

test('all tools are present and have text output', () => {
  const { dir, cortex, tools } = setup();
  try {
    const names = Object.keys(tools).sort();
    assert.deepEqual(names, [
      'cortex_as_of', 'cortex_compress', 'cortex_consolidate', 'cortex_digest', 'cortex_emotion', 'cortex_evolve', 'cortex_feedback', 'cortex_forget', 'cortex_get', 'cortex_goal', 'cortex_guard', 'cortex_health',
      'cortex_life', 'cortex_playbook', 'cortex_reflect', 'cortex_search', 'cortex_self', 'cortex_tick', 'cortex_timeline', 'cortex_working', 'cortex_write',
    ]);
    for (const tool of Object.values(tools)) {
      assert.equal(tool.output.schema.required[0], 'text');
    }
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write/search/get/self/health return readable text', async () => {
  const { dir, cortex, tools } = setup();
  try {
    const write = await tools.cortex_write.execute({
      text: '用户说会买米食，助手会一直等。',
      explicit: true,
      facts: [{ subject: '用户', predicate: 'likes', object: '米食' }],
    });
    assert.match(write.text, /已写入/);
    const id = write.text.match(/trc_[a-z0-9]+/)?.[0];
    assert.ok(id);
    const search = await tools.cortex_search.execute({ query: '米食' });
    assert.match(search.text, /意图/);
    const get = await tools.cortex_get.execute({ id });
    assert.match(get.text, /米食/);
    const self = await tools.cortex_self.execute({});
    assert.match(self.text, /驱力/);
    const health = await tools.cortex_health.execute({});
    assert.match(health.text, /健康分/);
    const guard = await tools.cortex_guard.execute({ action: 'check' });
    assert.match(guard.text, /自检/);
    const timeline = await tools.cortex_timeline.execute({ aroundId: id });
    assert.match(timeline.text, /锚点/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feedback/forget/reflect tool actions are callable', async () => {
  const { dir, cortex, tools } = setup();
  try {
    const write = await tools.cortex_write.execute({ text: '第一条测试。', explicit: true });
    const id = write.text.match(/trc_[a-z0-9]+/)?.[0];
    const feedback = await tools.cortex_feedback.execute({ id, signal: 'helpful', predicted: 0.8 });
    assert.match(feedback.text, /反馈已记/);
    await tools.cortex_write.execute({ text: '第二条测试。', explicit: true });
    const reflect = await tools.cortex_reflect.execute({ windowDays: 1, force: true });
    assert.match(reflect.text, /来源/);
    const forget = await tools.cortex_forget.execute({ id, mode: 'archive' });
    assert.match(forget.text, /已归档/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
