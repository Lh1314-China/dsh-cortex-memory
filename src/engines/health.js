import fs from 'node:fs';
import { integrityCheck } from '../store/database.js';
import { nowIso } from '../core/time.js';

/**
 * Health is an audit, not a score for its own sake. Every issue must point to a
 * concrete table/row the user can inspect or repair.
 */
export function createHealthEngine({
  db,
  events,
  traces,
  facts = null,
  entities = null,
  summaries = null,
  feedback = null,
  skills = null,
  jobs = null,
  identityStore = null,
  selfStore = null,
  config = {},
} = {}) {
  if (!db || !events || !traces) throw new Error('health engine needs db, events and traces');

  function count(sql, ...params) {
    return Number(db.prepare(sql).get(...params)?.c ?? 0);
  }

  function audit({ scopeId = 'global', now = Date.now() } = {}) {
    const issues = [];
    const ok = [];
    const add = (severity, code, message, detail = null) => issues.push({ severity, code, message, detail });

    const chain = events.verifyChain();
    if (chain.ok) ok.push(`事件链完整（${chain.count} 条）`);
    else add('error', 'EVENT_CHAIN', `事件链断裂：${chain.reason}`, { at: chain.at });

    const integrity = integrityCheck(db);
    if (integrity === 'ok') ok.push('SQLite 完整性 ok');
    else add('error', 'SQLITE_INTEGRITY', `SQLite integrity_check: ${integrity}`);

    const traceCounts = {
      active: traces.count({ scopeId, state: 'active' }),
      archived: traces.count({ scopeId, state: 'archived' }),
      total: traces.count({ scopeId }),
    };
    const fts = traces.ftsCount();
    if (fts !== traceCounts.total) add('warn', 'FTS_DRIFT', `FTS 行数 ${fts} 与 traces ${traceCounts.total} 不一致`, { fts, traces: traceCounts.total });
    else ok.push(`FTS 与 traces 对齐（${fts}）`);

    const duplicates = traces.duplicateHashes(scopeId, { limit: 10 });
    if (duplicates.length) add('warn', 'DUPLICATE_TRACES', `发现 ${duplicates.length} 组重复 hash`, duplicates);

    const factCounts = {
      active: count("SELECT COUNT(*) AS c FROM facts WHERE scope_id = ? AND status = 'active'", scopeId),
      disputed: count("SELECT COUNT(*) AS c FROM facts WHERE scope_id = ? AND status = 'disputed'", scopeId),
      invalidated: count("SELECT COUNT(*) AS c FROM facts WHERE scope_id = ? AND status = 'invalidated'", scopeId),
    };
    if (factCounts.disputed > 0) add('warn', 'DISPUTED_FACTS', `${factCounts.disputed} 条事实仍处于争议`, { count: factCounts.disputed });
    else ok.push('没有未解决的事实争议');
    const stale = count("SELECT COUNT(*) AS c FROM facts WHERE scope_id = ? AND status = 'active' AND valid_to IS NOT NULL AND valid_to <= ?", scopeId, new Date(now).toISOString());
    if (stale > 0) add('warn', 'STALE_FACTS', `${stale} 条 active 事实已过有效期`, { count: stale });

    const pendingJobs = jobs?.counts?.().pending ?? 0;
    const failedJobs = jobs?.counts?.().failed ?? 0;
    if (failedJobs > 0) add('warn', 'FAILED_JOBS', `${failedJobs} 个后台任务失败`, { failedJobs });
    if (pendingJobs > 100) add('warn', 'JOB_BACKLOG', `后台任务积压 ${pendingJobs}`, { pendingJobs });
    else if (pendingJobs > 0) ok.push(`后台任务 ${pendingJobs} 个待处理`);

    let identity = null;
    try { identity = identityStore?.active?.(scopeId) ?? null; } catch { identity = null; }
    if (!identity) add('warn', 'NO_IDENTITY', '没有 active 的自我叙事版本');
    else ok.push(`自我叙事 v${identity.version} 在线`);

    let self = null;
    try { self = selfStore?.get?.(scopeId) ?? null; } catch { self = null; }
    if (!self) add('warn', 'NO_SELF_STATE', '没有 self_state 记录');

    const summaryCount = summaries?.list?.(scopeId, { limit: 100 })?.length ?? count('SELECT COUNT(*) AS c FROM summaries WHERE scope_id = ?', scopeId);
    const feedbackCount = feedback?.list?.(scopeId, { limit: 1000 })?.length ?? count('SELECT COUNT(*) AS c FROM feedback WHERE scope_id = ?', scopeId);
    const skillCount = skills?.list?.({ scopeId, limit: 100 })?.length ?? count('SELECT COUNT(*) AS c FROM skills WHERE scope_id = ?', scopeId);
    const entityCount = entities?.list?.({ scopeId, limit: 500 })?.length ?? count('SELECT COUNT(*) AS c FROM entities WHERE scope_id = ?', scopeId);

    let dbBytes = 0;
    try { dbBytes = config.dbFile && config.dbFile !== ':memory:' ? fs.statSync(config.dbFile).size : 0; } catch { dbBytes = 0; }

    const errors = issues.filter((item) => item.severity === 'error').length;
    const warns = issues.filter((item) => item.severity === 'warn').length;
    const score = Math.max(0, 100 - errors * 20 - warns * 6);

    return {
      at: nowIso(now),
      scopeId,
      score,
      issues,
      ok,
      counts: {
        events: events.count(),
        traces: traceCounts,
        fts,
        facts: factCounts,
        entities: entityCount,
        summaries: summaryCount,
        feedback: feedbackCount,
        skills: skillCount,
        jobs: jobs?.counts?.() ?? {},
      },
      dbBytes,
    };
  }

  return { audit };
}
