import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { exportMarkdown } from '../../src/adapters/markdown.js';

test('markdown mirror exports readable files and skips secrets', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-md-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    cortex.write({ text: '用户说会买米食。', title: '米食', explicit: true, facts: [{ subject: '用户', predicate: 'likes', object: '米食' }] });
    cortex.write({ text: '这是一个 secret：sk-test-dummy-not-a-real-key', explicit: true });
    cortex.engines.skills.create({ name: '修插件', steps: ['看日志', '改一处', '跑测试'], state: 'active' });
    const result = exportMarkdown(cortex, path.join(dir, 'mirror'));
    assert.equal(result.traces, 1);
    assert.equal(result.skippedSecrets, 1);
    const memory = readFileSync(path.join(dir, 'mirror', 'MEMORY.md'), 'utf8');
    assert.match(memory, /米食/);
    assert.doesNotMatch(memory, /sk-abcdefghijklmnop/);
    const self = readFileSync(path.join(dir, 'mirror', 'SELF.md'), 'utf8');
    assert.match(self, /Identity/);
    const facts = readFileSync(path.join(dir, 'mirror', 'FACTS.md'), 'utf8');
    assert.match(facts, /likes/);
    const skills = readFileSync(path.join(dir, 'mirror', 'SKILLS.md'), 'utf8');
    assert.match(skills, /修插件/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
