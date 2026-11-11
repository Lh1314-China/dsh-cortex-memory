import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { induceSkills } from '../../src/engines/induct.js';
import { evaluatePolicy, comparePolicies } from '../../src/engines/evaluate.js';

test('repeated tagged traces induce candidate skills, not active ones', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-induct-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    for (let i = 0; i < 4; i += 1) {
      cortex.write({ text: `修插件第 ${i} 次：看日志、改一处、跑测试。`, explicit: true, tags: ['插件', '修复'] });
    }
    const result = induceSkills({ traces: cortex.repos.traces, skills: cortex.repos.skills, scopeId: 'global', minSupport: 3 });
    assert.ok(result.count >= 1);
    assert.ok(result.created.every((skill) => skill.state === 'candidate'));
    assert.ok(cortex.repos.skills.list({ state: 'candidate' }).length >= 1);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('policy replay compares current and candidate retrieval', async () => {
  const queries = [
    { query: '米食', relevant: ['a'] },
    { query: '插件', relevant: ['b'] },
  ];
  const current = async (query) => ({ items: query === '米食' ? [{ id: 'x' }] : [{ id: 'b' }] });
  const candidate = async (query) => ({ items: query === '米食' ? [{ id: 'a' }] : [{ id: 'b' }] });
  const before = await evaluatePolicy({ queries, run: current });
  const after = await evaluatePolicy({ queries, run: candidate });
  assert.equal(before.recallAtK, 0.5);
  assert.equal(after.recallAtK, 1);
  const compared = await comparePolicies({ queries, current, candidate });
  assert.ok(compared.delta.recallAtK > 0);
  assert.ok(compared.delta.mrrAtK > 0);
});
