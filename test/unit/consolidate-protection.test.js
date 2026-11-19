import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function withCortex(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-protect-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), features: { llm: true } }, llm: run.llm });
  return { cortex, dir };
}

test('保护线按分位：最高的那批不能归档，低的可以', async () => {
  const now = Date.now();
  let ids = [];
  const { cortex, dir } = withCortex({
    llm: {
      available: () => true,
      complete: async () => JSON.stringify([
        { action: 'archive', ids: [ids[0]], reason: '最高重要度' },
        { action: 'archive', ids: [ids[3]], reason: '最低重要度' },
      ]),
    },
  });
  try {
    const specs = [1.0, 0.95, 0.8, 0.6];
    specs.forEach((importance, index) => cortex.write({
      text: `用户：重要度 ${importance} 的样本 ${index}`,
      kind: 'utterance',
      title: `样本 ${index}`,
      importance,
      explicit: true,
      now,
    }));
    // write() 返回事件而不是痕迹，按重要度从高到低取实际 id。
    ids = cortex.repos.traces.list({ scopeId: 'global', state: 'active', limit: 10 })
      .sort((a, b) => Number(b.importance) - Number(a.importance))
      .map((trace) => trace.id);
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.equal(result.applied.length, 1, '只有低重要度那条能被归档');
    assert.match(String(result.run.error), /rejected 1/);
    const archived = cortex.repos.traces.get(ids[3]);
    assert.equal(archived.state, 'archived');
    const top = cortex.repos.traces.get(ids[0]);
    assert.equal(top.state, 'active', '最高重要度必须仍活跃');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('提示词里写的是本次保护线，而不是写死的 0.7', async () => {
  let seen = '';
  const now = Date.now();
  const { cortex, dir } = withCortex({
    llm: {
      available: () => true,
      complete: async (options) => {
        seen = `${options?.system ?? ''}\n${options?.prompt ?? ''}`;
        return JSON.stringify([{ action: 'keep', ids: [] }]);
      },
    },
  });
  try {
    for (let i = 0; i < 6; i += 1) {
      cortex.write({ text: `用户：样本 ${i}`, kind: 'utterance', title: `样本 ${i}`, importance: 0.7 + i * 0.05, explicit: true, now });
    }
    await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.doesNotMatch(seen, /importance>=0\.7 /, '不应再写死 0.7');
    assert.match(seen, /本次保护线 importance>=0\.9/);
    assert.match(seen, /受保护/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('有完全重复的候选时，提示词会把重复组直接交给模型', async () => {
  let seen = '';
  const now = Date.now();
  const { cortex, dir } = withCortex({
    llm: {
      available: () => true,
      complete: async (options) => {
        seen = String(options?.prompt ?? '');
        return JSON.stringify([{ action: 'keep', ids: [] }]);
      },
    },
  });
  try {
    for (let i = 0; i < 2; i += 1) {
      const text = i === 0
        ? '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。'
        : '用户：今天在图书馆看了超时空辉夜姬第三集，特别好笑。';
      cortex.write({ text, kind: 'utterance', title: `重复 ${i}`, importance: 0.8, explicit: true, now });
    }
    await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.match(seen, /已检测到这些重复组/, '应把重复组说出来');
    assert.match(seen, /merge/, '并告诉它用 merge');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('一组里两条受保护时，不把这组交给模型（merge 必被拒）', async () => {
  let seen = '';
  const now = Date.now();
  const { cortex, dir } = withCortex({
    llm: { available: () => true, complete: async (options) => { seen = String(options?.prompt ?? ''); return JSON.stringify([{ action: 'keep', ids: [] }]); } },
  });
  try {
    const texts = [
      '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。',
      '用户：今天在图书馆看了超时空辉夜姬第三集，特别好笑。',
      '用户：今天在图书馆看了超时空辉夜姬第三集，非常好笑。',
    ];
    const importances = [0.95, 0.95, 0.6];
    texts.forEach((text, i) => cortex.write({ text, kind: 'utterance', title: `重复 ${i}`, importance: importances[i], explicit: true, now }));
    const result = await cortex.consolidation.run({ scopeId: 'global', force: true });
    assert.doesNotMatch(seen, /已检测到这些重复组/, '两条受保护的组不该交出去');
    const audit = cortex.db.prepare("SELECT detail_json FROM audit WHERE action = 'consolidation.run' ORDER BY at DESC LIMIT 1").get();
    assert.equal(JSON.parse(audit.detail_json).groups, 0);
    assert.equal(JSON.parse(audit.detail_json).groupsDropped, 1, '被丢掉的组要有数');
    assert.ok(result.run);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('一组里只有一条受保护时，照常交给模型', async () => {
  const now = Date.now();
  let seen = '';
  const { cortex, dir } = withCortex({
    llm: {
      available: () => true,
      complete: async (options) => {
        seen = String(options?.prompt ?? '');
        return JSON.stringify([{ action: 'keep', ids: [] }]);
      },
    },
  });
  try {
    cortex.write({ text: '用户：今天在图书馆看了超时空辉夜姬第三集，很好笑。', kind: 'utterance', title: '重复 0', importance: 0.95, explicit: true, now });
    cortex.write({ text: '用户：今天在图书馆看了超时空辉夜姬第三集，特别好笑。', kind: 'utterance', title: '重复 1', importance: 0.6, explicit: true, now });
    await cortex.consolidation.run({ scopeId: 'global', force: true });
    const audit = cortex.db.prepare("SELECT detail_json FROM audit WHERE action = 'consolidation.run' ORDER BY at DESC LIMIT 1").get();
    assert.equal(JSON.parse(audit.detail_json).groups, 1);
    assert.match(seen, /mustBeTarget/, '受保护的那条要作为结构约束出现');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
