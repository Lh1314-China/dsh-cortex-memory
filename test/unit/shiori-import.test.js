import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { createShioriImporter, classifySparkCard } from '../../src/adapters/shiori.js';

function makeShiori() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cortex-shiori-'));
  mkdirSync(path.join(root, 'persona'), { recursive: true });
  mkdirSync(path.join(root, 'scopes', 'global', 'topics'), { recursive: true });
  mkdirSync(path.join(root, 'sparks', 'scopes', 'global'), { recursive: true });
  writeFileSync(path.join(root, 'persona', 'global.md'), '# 人设\n\n助手是鲸鱼娘。\n', 'utf8');
  writeFileSync(path.join(root, 'scopes', 'global', 'core.md'), '# 核心\n\n用户说会买米食。\n', 'utf8');
  writeFileSync(path.join(root, 'scopes', 'global', 'topics', 'token-log.md'), '---\ntitle: token 账本\nsummary: 余额记录\n---\n\n剩 3 元。\n', 'utf8');
  writeFileSync(path.join(root, 'sparks', 'scopes', 'global', 'sparks.json'), JSON.stringify({
    cards: {
      s1: { id: 's1', title: '米食的承诺', content: '用户说会买米食。', triggers: ['米食', '承诺'], vitality: 'evergreen' },
    },
  }), 'utf8');
  return root;
}

test('shiori importer skips archived cards and classifies active cards', () => {
  assert.equal(classifySparkCard({ title: '安装教训', content: '以后必须先跑测试。' }), 'instruction');
  assert.equal(classifySparkCard({ title: '插件安装', content: 'profile 的 bundle 配置。' }), 'observation');
  assert.equal(classifySparkCard({ title: '用户的米食', content: '用户说会买米食。' }), 'preference');
  const shioriRoot = makeShiori();
  const sparkFile = path.join(shioriRoot, 'sparks', 'scopes', 'global', 'sparks.json');
  const db = JSON.parse(readFileSync(sparkFile, 'utf8'));
  db.cards.archived = { id: 'archived', title: '旧卡', content: '这条已归档。', state: 'archived' };
  writeFileSync(sparkFile, JSON.stringify(db), 'utf8');
  const cortexDir = mkdtempSync(path.join(os.tmpdir(), 'cortex-import-archive-'));
  const cortex = createCortex({ config: { dataRoot: cortexDir, dbFile: path.join(cortexDir, 'cortex.sqlite') } });
  try {
    const result = createShioriImporter({ cortex }).importFrom(shioriRoot);
    assert.equal(result.sparks, 1);
    assert.ok(result.skipped >= 1);
  } finally {
    cortex.close();
    rmSync(shioriRoot, { recursive: true, force: true });
    rmSync(cortexDir, { recursive: true, force: true });
  }
});

test('shiori importer is read-only, idempotent and maps layers', () => {
  const shioriRoot = makeShiori();
  const cortexDir = mkdtempSync(path.join(os.tmpdir(), 'cortex-import-'));
  const cortex = createCortex({ config: { dataRoot: cortexDir, dbFile: path.join(cortexDir, 'cortex.sqlite') } });
  try {
    const importer = createShioriImporter({ cortex });
    const first = importer.importFrom(shioriRoot, { now: Date.parse('2026-11-11T12:00:00+08:00') });
    assert.equal(first.persona, 1);
    assert.equal(first.core, 1);
    assert.equal(first.topics, 1);
    assert.equal(first.sparks, 1);
    assert.equal(cortex.repos.traces.count(), 3);
    const coreTrace = cortex.repos.traces.list({ scopeId: 'global', limit: 10 }).find((trace) => trace.source === 'shiori:core');
    assert.equal(coreTrace.title, 'shiori 核心记忆');
    const versions = cortex.stores.identityStore.list();
    assert.equal(versions.length, 2); // default active + imported proposal
    const imported = versions.find((item) => item.rationale === 'shiori:persona');
    assert.ok(imported);
    assert.equal(imported.status, 'proposed');
    const second = importer.importFrom(shioriRoot, { now: Date.parse('2026-11-11T12:00:00+08:00') });
    assert.equal(second.core, 0);
    assert.equal(second.topics, 0);
    assert.equal(second.sparks, 0);
    assert.ok(second.skipped >= 3);
    assert.equal(cortex.repos.traces.count(), 3);
  } finally {
    cortex.close();
    rmSync(shioriRoot, { recursive: true, force: true });
    rmSync(cortexDir, { recursive: true, force: true });
  }
});
