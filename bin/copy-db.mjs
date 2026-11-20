#!/usr/bin/env node
/**
 * Make a consistent copy of a cortex database (VACUUM INTO), for rehearsals,
 * drills and offline inspection. Never writes to the source.
 *
 *   node bin/copy-db.mjs --source <db> --target <copy>
 *   node bin/copy-db.mjs                 # default production store -> temp file
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const home = process.env.USERPROFILE || os.homedir();
const source = value('--source', path.join(home, '.dsh', 'cortex-memory', 'cortex.sqlite'));
const target = value('--target', path.join(os.tmpdir(), `cortex-copy-${Date.now()}.sqlite`));

if (!fs.existsSync(source)) {
  console.error(JSON.stringify({ ok: false, error: `source not found: ${source}` }));
  process.exit(2);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) fs.unlinkSync(target);

const db = new DatabaseSync(source);
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const copy = new DatabaseSync(target, { readOnly: true });
let active = 0;
try {
  active = Number(copy.prepare("SELECT COUNT(*) AS c FROM traces WHERE state = 'active'").get()?.c ?? 0);
} finally {
  copy.close();
}

console.log(JSON.stringify({ ok: true, source, target, active, bytes: fs.statSync(target).size }));
