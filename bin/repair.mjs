#!/usr/bin/env node
/**
 * Offline repair for a dsh-cortex store.
 *
 * It is the "clean up what the old code wrote" step that should run once after
 * upgrading, and it is safe to run again (every step is idempotent).
 *
 *   node bin/repair.mjs                 # dry run: report only
 *   node bin/repair.mjs --apply         # back up (VACUUM INTO) then write
 *   node bin/repair.mjs --apply --user-address 用户 --alias 用户
 *
 * Supersedes bin/migrate-0.4.23.mjs (kept for its identity-boundary step).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { recomputeEpisodeCoverage } from '../src/engines/summary-coverage.js';
import { findDuplicateEpisodes } from '../src/engines/summary-dedupe.js';
import { summaryId } from '../src/core/ids.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
// Opt-in only: rewriting summaries is a data change, so it never happens as part
// of a plain repair run and always reports its diff before touching rows.
const rewriteCoverage = args.includes('--rewrite-coverage');
const dedupeEpisodes = args.includes('--dedupe-episodes');
// Opt-in: archive facts that are sentence fragments, not assertions.
const dropNoiseFacts = args.includes('--drop-noise-facts');
const argValue = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const home = process.env.USERPROFILE || os.homedir();
const profile = argValue('--profile');
const dbPath = argValue('--db')
  || (profile
    ? path.join(home, '.dsh', 'cortex-memory', 'profiles', profile, 'cortex.sqlite')
    : path.join(home, '.dsh', 'cortex-memory', 'cortex.sqlite'));
const scopeId = argValue('--scope', 'global');
const userAddress = argValue('--user-address');
const aliases = ['用户', '用户', '你', '您'];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--alias' && args[i + 1]) aliases.push(args[i + 1]);
}

if (!fs.existsSync(dbPath)) {
  console.error(`database not found: ${dbPath}`);
  process.exit(2);
}

const now = new Date().toISOString();
const report = {
  at: now,
  db: dbPath,
  scope: scopeId,
  mode: apply ? 'apply' : 'dry-run',
  backup: null,
  goalRounds: 0,
  injectedTraces: 0,
  duplicateSummaries: 0,
  staleIntentions: 0,
  fragmentRules: 0,
  zombieDisputes: 0,
  aliasRows: 0,
  titles: 0,
  titleFixes: 0,
  coverageRewrite: null,
  noiseFacts: null,
  dedupeEpisodes: null,
};

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 8000');

function backup() {
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `cortex-repair-${now.replace(/[:.]/g, '-')}.sqlite`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function count(sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.c ?? 0);
}

function run(sql, ...params) {
  return Number(db.prepare(sql).run(...params).changes ?? 0);
}

function deriveTitle(content) {
  const text = String(content ?? '').replace(/^(用户|助手|User|Assistant)\s*[：:]\s*/, '').trim();
  // Assistant-side captures start with the persona name ("助手：…"); strip that
  // short label too so the derived title is not just the name.
  const withoutName = text.replace(/^([^\s：:]{1,6})\s*[：:]\s*/, '');
  const candidate = withoutName.length >= 8 ? withoutName : text;
  const line = candidate.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  const clean = line.replace(/\s+/g, ' ').replace(/^#+\s*/, '').slice(0, 60).trim();
  return clean.length >= 8 ? clean : null;
}

const INJECTED = [
  "content GLOB '用户：Time sampled*'",
  "content GLOB 'Time sampled*'",
  "content GLOB '用户：Elapsed since the preceding*'",
  "content GLOB 'Elapsed since the preceding*'",
  "content GLOB '用户：Current runtime context*'",
  "content GLOB 'Current runtime context*'",
  "content GLOB '用户：<system-reminder>*'",
  "content GLOB '<system-reminder>*'",
  "content GLOB '用户：This is an automatically generated checkpoint*'",
  "content GLOB '用户：Background subagent*'",
  // GLOB treats '[' as a character-class opener, so the reminder prefix needs
  // LIKE instead — otherwise '用户：[SCHEDULE REMINDER*' silently never matches.
  "content LIKE '用户：[SCHEDULE REMINDER%'",
  "content LIKE '[SCHEDULE REMINDER%'",
  "content LIKE '用户：This is a scheduled message from the user%'",
  "content LIKE '用户：<goal_complete>%'",
  "content LIKE '<goal_complete>%'",
].join(' OR ');

const GOAL_ROUND = `(content LIKE '用户：<goal_round>%' OR content LIKE '<goal_round>%'
  OR (content LIKE '%Objective: "%' AND content LIKE '%Round: %'))`;

try {
  if (apply) report.backup = backup();

  const archiveGoal = `UPDATE traces SET state = 'archived', updated_at = ?
    WHERE scope_id = ? AND state = 'active' AND ${GOAL_ROUND}`;
  report.goalRounds = apply
    ? run(archiveGoal, now, scopeId)
    : count(`SELECT COUNT(*) AS c FROM traces WHERE scope_id = ? AND state = 'active' AND ${GOAL_ROUND}`, scopeId);

  const archiveInjected = `UPDATE traces SET state = 'archived', updated_at = ?
    WHERE scope_id = ? AND state = 'active' AND (${INJECTED})`;
  report.injectedTraces = apply
    ? run(archiveInjected, now, scopeId)
    : count(`SELECT COUNT(*) AS c FROM traces WHERE scope_id = ? AND state = 'active' AND (${INJECTED})`, scopeId);

  const groups = db.prepare(`
    SELECT level, content, GROUP_CONCAT(id) AS ids FROM summaries
    WHERE scope_id = ? GROUP BY level, content HAVING COUNT(*) > 1
  `).all(scopeId);
  for (const group of groups) {
    const ids = String(group.ids ?? '').split(',').filter(Boolean);
    for (const id of ids.slice(1)) {
      report.duplicateSummaries += 1;
      if (apply) run('DELETE FROM summaries WHERE id = ?', id);
    }
  }

  report.staleIntentions = apply
    ? run("UPDATE intentions SET status = 'expired' WHERE scope_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?", scopeId, now)
    : count("SELECT COUNT(*) AS c FROM intentions WHERE scope_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?", scopeId, now);

  const fragmentWhere = "(title LIKE '|%' OR title LIKE '%|%' OR length(title) > 120 OR length(title) < 8)";
  report.fragmentRules = apply
    ? run(`UPDATE playbook_rules SET status = 'retired', updated_at = ? WHERE scope_id = ? AND status = 'candidate' AND ${fragmentWhere}`, now, scopeId)
    : count(`SELECT COUNT(*) AS c FROM playbook_rules WHERE scope_id = ? AND status = 'candidate' AND ${fragmentWhere}`, scopeId);

  const zombieWhere = `d.status = 'open' AND fa.status != 'active' AND fb.status != 'active'`;
  const zombieJoin = `FROM disputes d JOIN facts fa ON fa.id = d.fact_a JOIN facts fb ON fb.id = d.fact_b`;
  report.zombieDisputes = apply
    ? run(`UPDATE disputes SET status = 'resolved', resolved_at = ?, resolution = 'auto: both facts invalidated'
        WHERE id IN (SELECT d.id ${zombieJoin} WHERE ${zombieWhere} AND d.scope_id = ?)`, now, scopeId)
    : count(`SELECT COUNT(*) AS c ${zombieJoin} WHERE ${zombieWhere} AND d.scope_id = ?`, scopeId);

  // Title backfill: early captures kept "会话 N 的对话" or no title at all, which
  // made the recall block unreadable. Derive one from the first real line.
  const LEGACY_TITLE = "(title IS NULL OR title = '' OR title LIKE '会话 %')";
  const titleRows = db.prepare(`SELECT id, content FROM traces WHERE scope_id = ? AND state = 'active' AND ${LEGACY_TITLE}`).all(scopeId);
  report.titles = titleRows.length;
  report.titleFixes = 0;
  if (apply) {
    for (const row of titleRows) {
      const title = deriveTitle(row.content);
      if (title) report.titleFixes += run('UPDATE traces SET title = ?, updated_at = ? WHERE id = ?', title, now, row.id);
    }
  }

  // Opt-in: bring pre-v2 episode summaries onto the importance-weighted coverage
  // definition. Reports the diff even in dry-run so the change can be reviewed.
  // Opt-in: archive facts that are sentence fragments instead of assertions
  // ("at → 等", "will → 收一收", "tail_fin_still_in → 水里"). Dry-run reports the
  // set; --apply invalidates them through the normal backup gate.
  if (dropNoiseFacts) {
    const STOP = ['等', '等等', '收一收', '水里', '那里', '这里', '一下子', '一点', '一些', '什么', '怎么', '那样', '这样'];
    const placeholders = STOP.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, predicate, object_literal FROM facts
      WHERE scope_id = ? AND status = 'active' AND (
        (predicate IN ('at','will') AND (object_literal IS NULL OR length(object_literal) <= 3))
        OR object_literal IN (${placeholders})
        OR length(predicate) > 28
      )
      ORDER BY recorded_at ASC LIMIT 2000
    `).all(scopeId, ...STOP);
    const plan = { candidates: rows.length, applied: 0, sample: rows.slice(0, 5).map((row) => `${row.predicate}→${row.object_literal ?? '(entity)'}`) };
    if (apply) {
      const stmt = db.prepare("UPDATE facts SET status = 'invalidated', invalidated_by = 'repair:noise-facts', valid_to = ?, updated_at = ? WHERE id = ?");
      for (const row of rows) stmt.run(now, now, row.id);
      plan.applied = rows.length;
    }
    report.noiseFacts = plan;
  }
  if (rewriteCoverage) {
    const result = recomputeEpisodeCoverage({ db, scopeId });
    const plan = { candidates: result.candidates, changed: result.updates.length, applied: 0, sample: result.updates.slice(0, 5) };
    if (apply) {
      const stmt = db.prepare("UPDATE summaries SET coverage = ?, model = 'extractive-v2-recomputed' WHERE id = ?");
      for (const item of result.updates) {
        stmt.run(item.to, item.id);
        plan.applied += 1;
      }
    }
    report.coverageRewrite = plan;
  }

  // Opt-in: merge near-duplicate episode summaries. Keeps the newest of each
  // cluster and records a level='merge' summary so the deleted source ids stay
  // traceable. Dry runs only report the clusters.
  if (dedupeEpisodes) {
    const result = findDuplicateEpisodes({ db, scopeId });
    const plan = {
      candidates: result.candidates,
      clusters: result.clusters.length,
      removed: 0,
      merged: 0,
      sample: result.clusters.slice(0, 5).map((cluster) => ({
        keep: cluster.keep.id,
        remove: cluster.remove.map((item) => item.id),
        contentSim: cluster.contentSim,
        sources: cluster.unionSources.length,
      })),
    };
    if (apply) {
      const remove = db.prepare('DELETE FROM summaries WHERE id = ?');
      const insertMerge = db.prepare(`
        INSERT INTO summaries(id, scope_id, level, period_start, period_end, content, source_ids_json, coverage, created_at, model)
        VALUES (?, ?, 'merge', ?, ?, ?, ?, ?, ?, 'dedupe-v1')
      `);
      for (const cluster of result.clusters) {
        for (const item of cluster.remove) {
          remove.run(item.id);
          plan.removed += 1;
        }
        insertMerge.run(
          summaryId(),
          scopeId,
          cluster.keep.periodStart ?? null,
          cluster.keep.periodEnd ?? null,
          `合并 ${cluster.remove.length} 条近重复的每日摘要（保留 ${cluster.keep.id}）`,
          JSON.stringify(cluster.unionSources),
          Number(cluster.keep.coverage ?? 0),
          now,
        );
        plan.merged += 1;
      }
    }
    report.dedupeEpisodes = plan;
  }

  if (userAddress) {
    const placeholders = aliases.map(() => '?').join(',');
    const mergeRelationships = apply
      ? db.prepare(`SELECT COUNT(*) AS c FROM relationships WHERE scope_id = ? AND target != ? AND target IN (${placeholders})`).get(scopeId, userAddress, ...aliases).c
      : count(`SELECT COUNT(*) AS c FROM relationships WHERE scope_id = ? AND target != ? AND target IN (${placeholders})`, scopeId, userAddress, ...aliases);
    const mergeAffect = count(`SELECT COUNT(*) AS c FROM affect_targets WHERE scope_id = ? AND target != ? AND target IN (${placeholders})`, scopeId, userAddress, ...aliases);
    report.aliasRows = Number(mergeRelationships) + Number(mergeAffect);
    if (apply && report.aliasRows > 0) {
      const canon = db.prepare('SELECT * FROM relationships WHERE scope_id = ? AND target = ?').get(scopeId, userAddress);
      for (const row of db.prepare(`SELECT * FROM relationships WHERE scope_id = ? AND target != ? AND target IN (${placeholders})`).all(scopeId, userAddress, ...aliases)) {
        if (canon) {
          run(`UPDATE relationships SET trust = MAX(trust, ?), care = MAX(care, ?), familiarity = MAX(familiarity, ?), updated_at = ? WHERE scope_id = ? AND target = ?`,
            Number(row.trust), Number(row.care), Number(row.familiarity), now, scopeId, userAddress);
          run('DELETE FROM relationships WHERE scope_id = ? AND target = ?', scopeId, row.target);
        } else {
          run('UPDATE relationships SET target = ? WHERE scope_id = ? AND target = ?', userAddress, scopeId, row.target);
        }
      }
      const canonAffect = db.prepare('SELECT * FROM affect_targets WHERE scope_id = ? AND target = ?').get(scopeId, userAddress);
      for (const row of db.prepare(`SELECT * FROM affect_targets WHERE scope_id = ? AND target != ? AND target IN (${placeholders})`).all(scopeId, userAddress, ...aliases)) {
        if (canonAffect) {
          run('UPDATE affect_targets SET count = count + ?, updated_at = ? WHERE scope_id = ? AND target = ?', Number(row.count) || 0, now, scopeId, userAddress);
          run('DELETE FROM affect_targets WHERE scope_id = ? AND target = ?', scopeId, row.target);
        } else {
          run('UPDATE affect_targets SET target = ? WHERE scope_id = ? AND target = ?', userAddress, scopeId, row.target);
        }
      }
    }
  }
} finally {
  db.close();
}

console.log(JSON.stringify(report, null, 2));

// A JSON dump answers "what changed" for a script but not for a human: "changed:
// 4" says nothing about which rows. Keep the JSON stable and append a short
// readable block for whoever runs this by hand.
const human = [];
human.push(`== repair 报告（${apply ? '已写入' : '空跑，未写入'}）==`);
human.push(`库：${dbPath}`);
human.push(`归档 goal_round 旧轮次：${report.goalRounds}`);
human.push(`归档注入上下文痕迹：${report.injectedTraces}`);
if (report.titles) human.push(`标题回填：候选 ${report.titles} / 实修 ${report.titleFixes ?? 0}`);
if (report.duplicateSummaries) human.push(`删除重复摘要：${report.duplicateSummaries}`);
if (report.staleIntentions) human.push(`过期意图：${report.staleIntentions}`);
if (report.fragmentRules) human.push(`退役碎片准则：${report.fragmentRules}`);
if (report.zombieDisputes) human.push(`清理僵尸争议：${report.zombieDisputes}`);
if (report.aliasRows && userAddress) human.push(`合并别名（${userAddress}）：${report.aliasRows} 行`);
if (report.coverageRewrite) {
  const c = report.coverageRewrite;
  human.push(`覆盖重算：候选 ${c.candidates} / 需改 ${c.changed} / 已写 ${c.applied}`);
  for (const item of c.sample ?? []) human.push(`  - ${item.id}：${item.from} → ${item.to}（覆盖 ${item.sources}/${item.window}）`);
}
if (report.dedupeEpisodes) {
  const d = report.dedupeEpisodes;
  human.push(`摘要去重：候选 ${d.candidates} / 成簇 ${d.clusters} / 删除 ${d.removed} / 合并记录 ${d.merged}`);
  for (const item of d.sample ?? []) human.push(`  - 保留 ${item.keep}，合并 ${item.remove.join('、')}（内容相似 ${item.contentSim}，来源 ${item.sources} 条）`);
}
if (report.backup) human.push(`备份：${report.backup}`);
// stderr, not stdout: callers pipe stdout into ConvertFrom-Json / JSON.parse.
// The readable block is for a person watching the console; the machine contract
// stays "stdout is exactly one JSON document".
console.error(`\n${human.join('\n')}`);
if (!apply) console.error('\nDry run only. Re-run with --apply to write (backs up first).');
