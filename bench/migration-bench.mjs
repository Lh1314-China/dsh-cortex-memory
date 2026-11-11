import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../src/service/cortex.js';
import { openDatabase, migrate, getMeta, closeDatabase, FTS_INDEX_VERSION } from '../src/store/database.js';
import { createTraceRepository } from '../src/store/repositories/traces.js';
import { ftsText } from '../src/memory/tokenizer.js';

const count = Number(process.argv[2] ?? 5000);
const dir = mkdtempSync(path.join(os.tmpdir(), `cortex-migrate-${count}-`));
const dbFile = path.join(dir, 'cortex.sqlite');
const totalStart = performance.now();
const phases = {};
let cortex;
try {
  cortex = createCortex({ config: { dataRoot: dir, dbFile, contextBudget: 2200 } });
  console.error(`phase create done (${Math.round(performance.now() - totalStart)}ms)`);
  const texts = [];
  for (let i = 0; i < count; i += 1) {
    texts.push({
      text: i === 0 ? '白饭：升级后仍然应该能通过“米饭”的 soft 查询找到。' : `老库迁移样本 ${i}：普通记忆内容。`,
      title: `迁移样本 #${i}`,
      explicit: true,
      operationId: `migrate:${count}:${i}`,
      now: Date.UTC(2026, 0, 1) + i * 1000,
    });
  }
  const writeStart = performance.now();
  cortex.writeMany(texts, { chunkSize: 500 });
  phases.writeMs = Math.round((performance.now() - writeStart) * 100) / 100;
  console.error(`phase write done (${phases.writeMs}ms)`);
  cortex.close();
  cortex = null;

  let opened = openDatabase({ dataRoot: dir, dbFile });
  opened.db.exec('DELETE FROM traces_fts_index');
  opened.db.prepare('DELETE FROM meta WHERE key = ?').run('fts_index_version');
  const rows = opened.db.prepare('SELECT id, title, content, summary FROM traces').all();
  const insert = opened.db.prepare('INSERT INTO traces_fts_index(trace_id, text) VALUES (?, ?)');
  for (const row of rows) {
    insert.run(row.id, ftsText(`${row.title ?? ''} ${row.content ?? ''} ${row.summary ?? ''}`));
  }
  closeDatabase(opened.db);
  phases.oldIndexMs = Math.round((performance.now() - writeStart) * 100) / 100;
  console.error(`phase old-index done (${phases.oldIndexMs}ms total from write)`);

  const started = performance.now();
  opened = openDatabase({ dataRoot: dir, dbFile });
  const result = migrate(opened.db);
  const elapsedMs = performance.now() - started;
  phases.migrateMs = Math.round(elapsedMs * 100) / 100;
  console.error(`phase migrate done (${phases.migrateMs}ms)`);
  const softHits = createTraceRepository(opened.db).searchFts('米饭', { soft: true });
  phases.totalMs = Math.round((performance.now() - totalStart) * 100) / 100;
  console.log(JSON.stringify({
    count,
    ftsRebuilt: result.ftsRebuilt,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    phases,
    ftsVersion: getMeta(opened.db, 'fts_index_version'),
    expectedVersion: String(FTS_INDEX_VERSION),
    softHits: softHits.length,
    dbBytes: opened.db.prepare('PRAGMA page_count').get().page_count * opened.db.prepare('PRAGMA page_size').get().page_size,
  }, null, 2));
  closeDatabase(opened.db);
} finally {
  if (cortex) cortex.close();
  rmSync(dir, { recursive: true, force: true });
}
