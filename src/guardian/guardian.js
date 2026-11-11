import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backup as backupDatabase, integrityCheck } from '../store/database.js';
import { nowIso } from '../core/time.js';
import { checkInvariants } from './invariants.js';

/**
 * Guardian: fail-open self-check, backups and small repairs. It must never be
 * the reason a turn fails; callers can log and continue.
 */
export function createGuardian({ db, config = {}, events, traces, selfStore = null, identityStore = null, logger = null } = {}) {
  if (!db || !events || !traces) throw new Error('guardian needs db, events and traces');

  function backup(target = null) {
    const dir = target ? path.dirname(path.resolve(target)) : path.join(config.dataRoot ?? process.cwd(), 'backups');
    const file = target ?? path.join(dir, `cortex-${nowIso().replace(/[:.]/g, '-')}.sqlite`);
    const absolute = backupDatabase(db, file);
    const stat = fs.statSync(absolute);
    return { path: absolute, bytes: stat.size, at: nowIso() };
  }

  function validateBackup(file) {
    const absolute = path.resolve(file);
    if (!fs.existsSync(absolute)) return { ok: false, reason: 'missing' };
    let snapshot = null;
    try {
      snapshot = new DatabaseSync(absolute);
      const check = snapshot.prepare('PRAGMA integrity_check').get();
      const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
      const required = ['events', 'traces', 'facts', 'entities', 'self_state', 'identity_versions'];
      const missing = required.filter((name) => !tables.includes(name));
      return { ok: check?.integrity_check === 'ok' && missing.length === 0, integrity: check?.integrity_check ?? 'unknown', missing, tables: tables.length };
    } catch (error) {
      return { ok: false, reason: 'corrupt-or-unreadable', error: error instanceof Error ? error.message : String(error) };
    } finally {
      try { snapshot?.close(); } catch { /* best effort */ }
    }
  }

  function check() {
    const invariants = checkInvariants({ db, events, traces, selfStore, identityStore });
    return {
      ...invariants,
      at: nowIso(),
      dbBytes: (() => {
        try { return config.dbFile && config.dbFile !== ':memory:' ? fs.statSync(config.dbFile).size : 0; } catch { return 0; }
      })(),
    };
  }

  function restore(file, target) {
    const absolute = path.resolve(file);
    const validation = validateBackup(absolute);
    if (!validation.ok) return { restored: false, reason: 'invalid-backup', validation };
    if (!target) return { restored: false, reason: 'target-required' };
    const destination = path.resolve(target);
    if (config.dbFile && path.resolve(config.dbFile) === destination) {
      return { restored: false, reason: 'live-db', message: '先关闭当前 cortex 再恢复，或恢复到新路径' };
    }
    if (fs.existsSync(destination)) {
      const safety = `${destination}.before-restore-${Date.now()}`;
      fs.copyFileSync(destination, safety);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(absolute, destination);
    const after = validateBackup(destination);
    return { restored: after.ok, target: destination, validation: after };
  }

  function repairFts() {
    const before = traces.ftsCount();
    const count = traces.reindexFts();
    return { before, after: traces.ftsCount(), reindexed: count };
  }

  return { backup, validateBackup, restore, check, repairFts, integrity: () => integrityCheck(db) };
}
