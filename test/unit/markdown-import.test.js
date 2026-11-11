import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';
import { parseMemoryMarkdown, importMarkdown } from '../../src/adapters/markdown-import.js';

test('markdown parser reads frontmatter and body', () => {
  const parsed = parseMemoryMarkdown('---\nid: "t1"\nkind: "fact"\ntitle: "米食"\ntags: ["米食", "承诺"]\nrecorded_at: "2026-11-05T10:00:00+08:00"\n---\n\n用户喜欢米食。\n');
  assert.equal(parsed.id, 't1');
  assert.equal(parsed.kind, 'fact');
  assert.deepEqual(parsed.tags, ['米食', '承诺']);
  assert.match(parsed.content, /用户喜欢米食/);
});

test('markdown import writes active files idempotently', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cortex-md-import-'));
  const vault = mkdtempSync(path.join(os.tmpdir(), 'cortex-vault-'));
  const cortex = createCortex({ config: { dataRoot: dataDir, dbFile: path.join(dataDir, 'cortex.sqlite') } });
  try {
    writeFileSync(path.join(vault, 'a.md'), '---\nid: a\nkind: utterance\ntitle: 米食\ntags: [米食]\n---\n\n用户喜欢米食。\n', 'utf8');
    writeFileSync(path.join(vault, 'b.md'), '---\nid: b\nstate: archived\n---\n\n不该导入。\n', 'utf8');
    const dry = importMarkdown(cortex, vault, { dryRun: true });
    assert.equal(dry.files, 2);
    assert.equal(cortex.repos.traces.count(), 0);
    const result = importMarkdown(cortex, vault);
    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 1);
    assert.equal(cortex.repos.traces.count(), 1);
    const again = importMarkdown(cortex, vault);
    assert.equal(again.items.find((item) => item.title === '米食').skipped, true);
    assert.equal(cortex.repos.traces.count(), 1);
  } finally {
    cortex.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
});
