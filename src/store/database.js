import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../core/time.js';
import { normalizeConfig, validateConfig } from '../core/config.js';
import { CortexError, ERROR_CODES } from '../core/errors.js';
import { ftsText } from '../memory/tokenizer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(HERE, 'schema.sql');
export const SCHEMA_VERSION = 6;
export const FTS_INDEX_VERSION = 2;

function ensureTraceColumns(db) {
  const columns = db.prepare('PRAGMA table_info(traces)').all();
  if (!columns.some((column) => column.name === 'metadata_json')) {
    db.exec("ALTER TABLE traces ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
  }
}

function ensureFactsColumns(db) {
  const columns = db.prepare('PRAGMA table_info(facts)').all();
  if (!columns.some((column) => column.name === 'superseded_at')) {
    db.exec('ALTER TABLE facts ADD COLUMN superseded_at TEXT');
  }
  // Existing invalidations did not have a dedicated transaction timestamp.
  // updated_at was written at invalidation time, so it is the best backfill.
  db.prepare("UPDATE facts SET superseded_at = updated_at WHERE invalidated_by IS NOT NULL AND superseded_at IS NULL").run();
}

function ensureParent(file) {
  if (file === ':memory:') return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function rebuildFtsIndex(db) {
  db.exec('DELETE FROM traces_fts_index');
  const insert = db.prepare('INSERT INTO traces_fts_index(trace_id, text) VALUES (?, ?)');
  const rows = db.prepare('SELECT id, title, content, summary FROM traces').all();
  for (const row of rows) {
    const text = ftsText(`${row.title ?? ''} ${row.content ?? ''} ${row.summary ?? ''}`, { soft: true });
    if (text) insert.run(row.id, text);
  }
}

function ensureFtsIndex(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('fts_index_version');
  if (Number(row?.value ?? 0) === FTS_INDEX_VERSION) return false;
  rebuildFtsIndex(db);
  db.prepare(`
    INSERT INTO meta(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run('fts_index_version', String(FTS_INDEX_VERSION), nowIso());
  return true;
}

function readSchema() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8');
}

export function openDatabase(rawConfig = {}) {
  const config = validateConfig(normalizeConfig(rawConfig));
  ensureParent(config.dbFile);
  const db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  return { db, config };
}

export function migrate(db, { version = SCHEMA_VERSION } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(readSchema());
    ensureTraceColumns(db);
    ensureFactsColumns(db);
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
    if (!row) {
      db.prepare('INSERT INTO meta(key, value, updated_at) VALUES (?, ?, ?)').run('schema_version', String(version), nowIso());
    } else if (Number(row.value) > version) {
      throw new CortexError(ERROR_CODES.UNSUPPORTED, `database schema ${row.value} is newer than code ${version}`);
    } else if (Number(row.value) < version) {
      db.prepare('UPDATE meta SET value = ?, updated_at = ? WHERE key = ?').run(String(version), nowIso(), 'schema_version');
    }
    const ftsRebuilt = ensureFtsIndex(db);
    db.exec('COMMIT');
    return { version, applied: true, ftsRebuilt };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw error;
  }
}

export function transaction(db, fn) {
  if (typeof fn !== 'function') throw new CortexError(ERROR_CODES.INVALID_INPUT, 'transaction needs a function');
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO meta(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), nowIso());
}

export function integrityCheck(db) {
  const row = db.prepare('PRAGMA integrity_check').get();
  return row?.integrity_check ?? 'unknown';
}

export function backup(db, target) {
  if (!target) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'backup target is required');
  const absolute = path.resolve(target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true });
  const escaped = absolute.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return absolute;
}

export function closeDatabase(db) {
  try { db.close(); } catch { /* closing is best-effort */ }
}

export function withDatabase(rawConfig, fn) {
  const { db, config } = openDatabase(rawConfig);
  try {
    migrate(db);
    return fn(db, config);
  } finally {
    closeDatabase(db);
  }
}
