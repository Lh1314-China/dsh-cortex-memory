import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const BACKUP_PATTERN = /^cortex-.*\.sqlite$/i;

export function listBackups(dir) {
  const root = path.resolve(String(dir ?? ''));
  const entries = [];
  for (const name of readdirSync(root)) {
    if (!BACKUP_PATTERN.test(name)) continue;
    const file = path.join(root, name);
    const stat = statSync(file);
    if (!stat.isFile()) continue;
    entries.push({ name, path: file, bytes: stat.size, mtimeMs: stat.mtimeMs });
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function pruneBackups(dir, { retain = 5, dryRun = false } = {}) {
  const keep = Math.max(1, Math.min(100, Number(retain) || 5));
  const entries = listBackups(dir);
  const removable = entries.slice(keep);
  if (!dryRun) for (const entry of removable) unlinkSync(entry.path);
  return {
    dir: path.resolve(String(dir ?? '')),
    retain: keep,
    total: entries.length,
    kept: entries.slice(0, keep).map((entry) => entry.name),
    removed: dryRun ? [] : removable.map((entry) => entry.name),
    candidates: removable.map((entry) => entry.name),
    dryRun: Boolean(dryRun),
  };
}
