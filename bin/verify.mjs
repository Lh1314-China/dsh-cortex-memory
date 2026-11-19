#!/usr/bin/env node
/**
 * Read-only health snapshot for an installed dsh-cortex store.
 *
 * It exists so a reviewer can answer "is the upgrade actually healthy?" without
 * asking the agent and without writing anything:
 *
 *   node bin/verify.mjs
 *   node bin/verify.mjs --db <path> --profile <name>
 *
 * Exit code 0 = healthy, 1 = something needs attention.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const home = process.env.USERPROFILE || os.homedir();
const profile = argValue('--profile');
const expectPath = argValue('--expect');
const savePath = argValue('--save');
const dbPath = argValue('--db')
  || (profile
    ? path.join(home, '.dsh', 'cortex-memory', 'profiles', profile, 'cortex.sqlite')
    : path.join(home, '.dsh', 'cortex-memory', 'cortex.sqlite'));

// Version must describe what is INSTALLED, not the source tree: on 2026-11-16 the
// snapshot for 0.4.118 recorded 0.4.119 because the source had already been bumped.
// --installed makes a missing install a hard failure instead of a wrong label.
const sourcePkgPath = path.join(HERE, '..', 'package.json');
const profileDir = process.env.DSH_PROFILE && path.isAbsolute(process.env.DSH_PROFILE)
  ? process.env.DSH_PROFILE
  : path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const installedPkgPath = path.join(profileDir, 'node_modules', 'dsh-cortex', 'package.json');
let sourceVersion = null;
let installedVersion = null;
try { sourceVersion = JSON.parse(fs.readFileSync(sourcePkgPath, 'utf8')).version; } catch { /* source tree may be absent */ }
try { installedVersion = JSON.parse(fs.readFileSync(installedPkgPath, 'utf8')).version; } catch { /* not installed yet */ }
if (process.argv.includes('--installed') && !installedVersion) {
  console.error('verify: --installed requested but ' + installedPkgPath + ' is missing');
  process.exit(1);
}
const version = installedVersion ?? sourceVersion ?? 'unknown';

const result = { version, versionSource: installedVersion ? 'installed' : 'source', sourceVersion, db: dbPath, ok: true, problems: [] };
const problem = (text) => { result.ok = false; result.problems.push(text); };

if (!fs.existsSync(dbPath)) {
  console.log(JSON.stringify({ ...result, ok: false, problems: ['database not found'] }, null, 2));
  process.exit(1);
}

let db;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
} catch (error) {
  console.log(JSON.stringify({ ...result, ok: false, problems: [`cannot open database: ${error.message}`] }, null, 2));
  process.exit(1);
}

const q = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

try {
  const integrity = q('PRAGMA integrity_check').integrity_check;
  result.integrity = integrity;
  if (integrity !== 'ok') problem(`sqlite integrity_check = ${integrity}`);

  result.schemaVersion = q("SELECT value FROM meta WHERE key = 'schema_version'")?.value ?? null;

  const active = Number(q("SELECT COUNT(*) AS c FROM traces WHERE state = 'active'")?.c ?? 0);
  const archived = Number(q("SELECT COUNT(*) AS c FROM traces WHERE state = 'archived'")?.c ?? 0);
  result.traces = { active, archived, total: active + archived };

  const facts = {
    active: Number(q("SELECT COUNT(*) AS c FROM facts WHERE status = 'active'")?.c ?? 0),
    disputed: Number(q("SELECT COUNT(*) AS c FROM facts WHERE status = 'disputed'")?.c ?? 0),
  };
  result.facts = facts;
  if (facts.disputed > 5) problem(`disputed facts: ${facts.disputed}`);

  const openDisputes = Number(q("SELECT COUNT(*) AS c FROM disputes WHERE status = 'open'")?.c ?? 0);
  result.disputes = { open: openDisputes };
  if (openDisputes > 0) problem(`open disputes: ${openDisputes} (run repair.mjs)`);

  // Capture hygiene
  const rows = all("SELECT metadata_json, recorded_at FROM traces WHERE source = 'host:turn'");
  const capture = { total: rows.length, stripped: 0, days: {} };
  for (const row of rows) {
    let metadata = {};
    try { metadata = JSON.parse(row.metadata_json); } catch { continue; }
    const stripped = metadata?.stripped === true || metadata?.capture?.stripped === true;
    if (stripped) capture.stripped += 1;
    const day = String(row.recorded_at ?? '').slice(0, 10);
    const bucket = capture.days[day] ?? { total: 0, stripped: 0 };
    bucket.total += 1;
    if (stripped) bucket.stripped += 1;
    capture.days[day] = bucket;
  }
  capture.ratio = capture.total ? Math.round((capture.stripped / capture.total) * 1000) / 1000 : 0;
  result.capture = capture;

  // Still-visible goal-round traces mean maintain/repair has not run yet.
  const goalRounds = Number(q(`SELECT COUNT(*) AS c FROM traces WHERE state = 'active'
    AND (content LIKE '用户：<goal_round>%' OR content LIKE '<goal_round>%')`)?.c ?? 0);
  result.legacyGoalRounds = goalRounds;
  if (goalRounds > 0) problem(`legacy goal-round traces still active: ${goalRounds} (run repair.mjs)`);

  // Inhibition marks
  const inhibitionRows = all("SELECT metadata_json FROM traces WHERE metadata_json LIKE '%\"inhibition\"%'");
  let inhibitionCount = 0;
  let inhibitionSum = 0;
  for (const row of inhibitionRows) {
    let metadata = {};
    try { metadata = JSON.parse(row.metadata_json); } catch { continue; }
    const value = Number(metadata?.inhibition ?? 0);
    if (value > 0) { inhibitionCount += 1; inhibitionSum += value; }
  }
  result.inhibition = {
    count: inhibitionCount,
    average: inhibitionCount ? Math.round((inhibitionSum / inhibitionCount) * 1000) / 1000 : 0,
  };

  // Embedding coverage. Judged after the optional baseline comparison, because
  // "low but climbing" and "low and stuck" need different reactions.
  // Only embeddings that belong to active traces count: otherwise archived
  // traces push coverage above 100% and the number stops meaning anything.
  const embedded = Number(q(`
    SELECT COUNT(*) AS c FROM embeddings e JOIN traces t ON t.id = e.trace_id
    WHERE t.state = 'active'
  `)?.c ?? 0);
  result.embeddings = { count: embedded, coverage: active ? Math.round((embedded / active) * 1000) / 1000 : 0 };
  result.coverageLow = active >= 100 && result.embeddings.coverage < 0.5;
} finally {
  db.close();
}

// Optional baseline comparison: "--expect <previous.json>" prints deltas so an
// upgrade can be judged by movement (coverage up, legacy traces down) instead
// of a single snapshot.
if (expectPath && fs.existsSync(expectPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(expectPath, 'utf8'));
    result.comparison = {
      since: previous.at ?? null,
      previousVersion: previous.version ?? null,
      coverageDelta: Math.round((result.embeddings.coverage - (previous.embeddings?.coverage ?? 0)) * 1000) / 1000,
      activeDelta: result.traces.active - (previous.traces?.active ?? 0),
      legacyGoalRoundsDelta: result.legacyGoalRounds - (previous.legacyGoalRounds ?? 0),
      strippedDelta: result.capture.stripped - (previous.capture?.stripped ?? 0),
    };
  } catch (error) {
    result.comparison = { error: `cannot read baseline: ${error.message}` };
  }
}

if (result.coverageLow) {
  const delta = result.comparison?.coverageDelta;
  const embedded = result.embeddings.count;
  const active = result.traces.active;
  const size = `${result.embeddings.coverage} (${embedded}/${active})`;
  if (typeof delta === 'number' && delta > 0) {
    // Still moving: this is a status line, not a problem.
    result.notes = [...(result.notes ?? []), `embedding coverage ${size} is climbing: +${delta} vs baseline`];
  } else if (typeof delta === 'number') {
    problem(`embedding coverage low: ${size} and not climbing (${delta} vs baseline) — check that the vector feature is enabled and Ollama is reachable.`);
  } else {
    result.notes = [...(result.notes ?? []), `embedding coverage ${size}: no baseline given, so movement is unknown — re-run with --expect <snapshot> after a few minutes`];
  }
}

if (savePath) {
  try {
    fs.writeFileSync(savePath, JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2));
    result.saved = savePath;
  } catch (error) {
    result.saved = null;
    result.problems.push(`cannot save snapshot: ${error.message}`);
    result.ok = false;
  }
}

console.log(JSON.stringify(result, null, 2));
if (result.comparison && !result.comparison.error) {
  const c = result.comparison;
  console.log(`\n对比基线：覆盖 ${c.coverageDelta >= 0 ? '+' : ''}${c.coverageDelta} · active ${c.activeDelta >= 0 ? '+' : ''}${c.activeDelta} · 旧 goal_round ${c.legacyGoalRoundsDelta >= 0 ? '+' : ''}${c.legacyGoalRoundsDelta}`);
}
if (!result.ok) {
  console.log('\nNEEDS ATTENTION:');
  for (const item of result.problems) console.log(`- ${item}`);
  process.exit(1);
}
for (const note of result.notes ?? []) console.log(`备注：${note}`);
console.log('\nHEALTHY');
