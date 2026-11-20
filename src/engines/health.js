import fs from 'node:fs';
import { integrityCheck } from '../store/database.js';
import { nowIso } from '../core/time.js';
import { suppressionOf } from './inhibition.js';

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
  maintainLast = null,
  feedback = null,  skills = null,
  jobs = null,
  identityStore = null,
  selfStore = null,
  config = {},
} = {}) {
  if (!db || !events || !traces) throw new Error('health engine needs db, events and traces');

  function count(sql, ...params) {
    return Number(db.prepare(sql).get(...params)?.c ?? 0);
  }

  function inhibitionReport(scopeId, now) {
    const rows = db.prepare(`
      SELECT id, title, metadata_json FROM traces
      WHERE scope_id = ? AND state = 'active' AND metadata_json LIKE '%"inhibition"%'
    `).all(scopeId);
    const items = [];
    for (const row of rows) {
      let metadata = {};
      try { metadata = JSON.parse(row.metadata_json); } catch { continue; }
      const value = suppressionOf(metadata, now, { halfLifeDays: config.inhibitionHalfLifeDays ?? 14 });
      if (value > 0.001) items.push({ id: row.id, title: row.title, value: Math.round(value * 1000) / 1000 });
    }
    items.sort((a, b) => b.value - a.value);
    return {
      enabled: config.features?.inhibition === true,
      count: items.length,
      average: items.length ? Math.round((items.reduce((sum, item) => sum + item.value, 0) / items.length) * 1000) / 1000 : 0,
      top: items.slice(0, 3),
    };
  }

  /**
   * Capture hygiene: how many host turns were stored, and how many of them
   * needed the injected-context stripper. This is the number that proves the
   * 0.4.23 pollution fix is actually doing something.
   */
  function captureReport(scopeId) {
    const rows = db.prepare(`
      SELECT metadata_json, recorded_at FROM traces
      WHERE scope_id = ? AND source = 'host:turn'
    `).all(scopeId);
    let stripped = 0;
    let truncated = 0;
    const byDay = new Map();
    for (const row of rows) {
      let metadata = {};
      try { metadata = JSON.parse(row.metadata_json); } catch { continue; }
      const capture = metadata?.capture ?? {};
      // Metadata is stored flat ({capture:'host', stripped:true}); accept the
      // nested shape too so an older/newer writer cannot silently report zero.
      const wasStripped = metadata?.stripped === true || capture.stripped === true;
      const wasTruncated = metadata?.truncated === true || capture.truncated === true;
      if (wasStripped) stripped += 1;
      if (wasTruncated) truncated += 1;
      const day = String(row.recorded_at ?? '').slice(0, 10);
      const bucket = byDay.get(day) ?? { day, total: 0, stripped: 0, truncated: 0 };
      bucket.total += 1;
      if (wasStripped) bucket.stripped += 1;
      if (wasTruncated) bucket.truncated += 1;
      byDay.set(day, bucket);
    }
    const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14);
    return { total: rows.length, stripped, truncated, clean: rows.length - stripped, days };
  }

  /**
   * The last consolidation run and the last sleep pass. `dream_runs.error` is the
   * only place that says *why* consolidation did nothing, so surface it instead
   * of leaving it to whoever remembers to query the table.
   */
  function consolidationReport(scopeId = 'global', now = Date.now()) {
    try {
      // Preview rows are rehearsals, not consolidation history: showing one as
      // "the last consolidation" hides when a real pass last ran.
      const dream = db.prepare("SELECT at, status, error, decisions_json, applied_json FROM dream_runs WHERE scope_id = ? AND (model IS NULL OR model <> 'dedupe') AND status != 'preview' ORDER BY created_at DESC LIMIT 1").get(scopeId);
      const sleep = db.prepare("SELECT at, report_json FROM sleep_runs WHERE scope_id = ? ORDER BY at DESC LIMIT 1").get(scopeId);
      let sleepReport = null;
      if (sleep) {
        try { sleepReport = JSON.parse(sleep.report_json ?? '{}'); } catch { sleepReport = null; }
      }
      // Today's housekeeping since local midnight: how many traces were archived
      // or merged. A pass that changed nothing is not counted as a run, so the
      // number answers "did the memory actually get tidier today".
      const today = { runs: 0, archived: 0, merged: 0 };
      try {
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const rows = db.prepare("SELECT applied_json FROM dream_runs WHERE scope_id = ? AND (model IS NULL OR model <> 'dedupe') AND status != 'preview' AND created_at >= ?").all(scopeId, dayStart.toISOString());
        for (const row of rows) {
          let applied = [];
          try { applied = JSON.parse(row.applied_json ?? '[]'); } catch { applied = []; }
          if (!Array.isArray(applied) || applied.length === 0) continue;
          today.runs += 1;
          for (const item of applied) {
            if (item?.action === 'archive') today.archived += 1;
            else if (item?.action === 'merge') today.merged += 1;
          }
        }
      } catch { /* the daily tally is best effort */ }
      return {
        today,
        dream: dream ? {
          at: dream.at,
          status: dream.status,
          error: dream.error ?? null,
          decisions: (() => { try { return JSON.parse(dream.decisions_json ?? '[]').length; } catch { return 0; } })(),
          // `status: applied` with every decision `keep` and `applied: 0` is a
          // no-op, not a consolidation. Keep the count so a reader can tell.
          keep: (() => { try { return JSON.parse(dream.decisions_json ?? '[]').filter((item) => item?.action === 'keep').length; } catch { return 0; } })(),
          applied: (() => { try { return JSON.parse(dream.applied_json ?? '[]').length; } catch { return 0; } })(),
        } : null,
        sleep: sleep ? {
          at: sleep.at,
          consolidation: sleepReport?.consolidation ?? null,
          consolidated: Number(sleepReport?.consolidated ?? 0),
          reflected: Number(sleepReport?.reflected ?? 0),
        } : null,
      };
    } catch {
      return { dream: null, sleep: null };
    }
  }

  /**
   * The last maintenance pass, as recorded by maintain(). A silent maintain is
   * indistinguishable from a maintenance that never ran, so surface it.
   */
  function maintainReport() {
    try {
      const row = db.prepare("SELECT at, detail_json FROM audit WHERE action = 'maintain.run' ORDER BY at DESC LIMIT 1").get();
      if (!row) return null;
      let detail = {};
      try { detail = JSON.parse(row.detail_json); } catch { detail = {}; }
      return {
        at: row.at,
        passAt: typeof detail.at === 'string' ? detail.at : row.at,
        disputes: Number(detail.disputes ?? 0),
        summaries: Number(detail.summaries ?? 0),
        intentions: Number(detail.intentions ?? 0),
        playbook: Number(detail.playbook ?? 0),
        goalRounds: Number(detail.goalRounds ?? 0),
        aliases: Number(detail.aliases ?? 0),
        working: Number(detail.working ?? 0),
        // maintain() runs synchronously on the host heartbeat; a slow one is a
        // user-visible freeze, so carry the duration through.
        ms: Number.isFinite(Number(detail.ms)) ? Number(detail.ms) : null,
      };
    } catch {
      return null;
    }
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
    const fts = traces.ftsCount({ scopeId });
    if (fts !== traceCounts.total) add('warn', 'FTS_DRIFT', `FTS 行数 ${fts} 与 traces ${traceCounts.total} 不一致`, { fts, traces: traceCounts.total });
    else ok.push(`FTS 与 traces 对齐（${fts}）`);

    // Vector coverage: an index that lags behind the trace table is invisible
    // in every other metric, so surface it here.
    const embedded = Number(db.prepare(`
      SELECT COUNT(*) AS c FROM embeddings e JOIN traces t ON t.id = e.trace_id
      WHERE t.scope_id = ? AND t.state = 'active'
    `).get(scopeId)?.c ?? 0);
    const vectorCoverage = traceCounts.active ? Math.round((embedded / traceCounts.active) * 1000) / 1000 : 0;
    const vectors = { embedded, coverage: vectorCoverage };
    if (traceCounts.active >= 100 && vectorCoverage < 0.5) {
      add('warn', 'VECTOR_COVERAGE', `向量覆盖 ${Math.round(vectorCoverage * 100)}%（${embedded}/${traceCounts.active}），回填可能还没跑完`, vectors);
    } else if (traceCounts.active > 0) {
      ok.push(`向量覆盖 ${Math.round(vectorCoverage * 100)}%（${embedded}/${traceCounts.active}）`);
    }

    const duplicates = traces.duplicateHashes(scopeId, { limit: 10 });
    if (duplicates.length) add('warn', 'DUPLICATE_TRACES', `发现 ${duplicates.length} 组重复 hash`, duplicates);

    // Narrative layer: reflections pile up on their own, but the short version of
    // them (episode summaries) is what makes long-term memory readable. Surface
    // the counts so a thin layer is visible instead of silent.
    const summaryCounts = {
      episode: count("SELECT COUNT(*) AS c FROM summaries WHERE scope_id = ? AND level = 'episode'", scopeId),
      merge: count("SELECT COUNT(*) AS c FROM summaries WHERE scope_id = ? AND level = 'merge'", scopeId),
      thread: count("SELECT COUNT(*) AS c FROM summaries WHERE scope_id = ? AND level = 'thread'", scopeId),
    };
    const lastEpisode = db.prepare("SELECT MAX(created_at) AS at FROM summaries WHERE scope_id = ? AND level = 'episode'").get(scopeId)?.at ?? null;
    const summaryLayers = { ...summaryCounts, lastEpisodeAt: lastEpisode };
    if (summaryCounts.episode === 0 && traceCounts.active >= 100) {
      add('warn', 'NO_EPISODE_SUMMARIES', '一条每日摘要都没有，长期记忆缺少短版本', summaryLayers);
    }

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
    const inhibition = inhibitionReport(scopeId, now);
    const capture = captureReport(scopeId);
    // Pick by recency, not by "has ms": after a change pass followed by a quiet
    // one, the change row is newer than nothing but older than the quiet pass, and
    // preferring it made the "最近一趟" line point at the older run.
    const recorded = maintainReport();
    const memory = typeof maintainLast === 'function' ? maintainLast() : null;
    const recordedPassAt = recorded?.passAt ?? recorded?.at ?? null;
    const memoryAt = typeof memory?.at === 'string' ? memory.at : null;
    // Compare parsed timestamps, not strings: an injected `2026-11-15 14:36:00`
    // sorts before `2026-11-15T14:36:00Z` purely because of the space, which made
    // the same instant look older. Unparsable input is treated as "unknown".
    const recordedMs = Number.isFinite(Date.parse(recordedPassAt ?? '')) ? Date.parse(recordedPassAt) : null;
    const memoryMs = Number.isFinite(Date.parse(memoryAt ?? '')) ? Date.parse(memoryAt) : null;
    let maintain = null;
    if (recorded && recordedMs !== null && (memoryMs === null || recordedMs > memoryMs)) maintain = recorded;
    else if (memory) maintain = memory;
    else maintain = recorded;
    const stamp = (value) => (typeof value === 'string' ? value.slice(0, 19) : '—');
    if (maintain) ok.push(`最近一趟维护：${stamp(maintain.at)}（清意图 ${maintain.intentions} / 工作记忆 ${maintain.working}${Number.isFinite(maintain.ms) ? ` / ${maintain.ms}ms` : ''}）`);
    // A quiet pass writes no audit row, so the newest row can be hours old. Say
    // both instead of letting one stale timestamp read as "nothing ran".
    if (recorded && maintain && recordedMs !== null && memoryMs !== null && recordedMs < memoryMs) {
      ok.push(`最近一次有变更的维护：${stamp(recordedPassAt)}（清意图 ${recorded.intentions} / 工作记忆 ${recorded.working}）`);
    }
    // A configured LLM that keeps returning nothing is a different failure from a
    // missing adapter; surface it instead of letting dream_runs pile up silently.
    try {
      const dreamSince = new Date(now - 6 * 3_600_000).toISOString();
      // Labels now carry the reason (`llm-empty:empty-text:length`,
      // `llm-empty-retry:no-selection`, …), so match the family and show buckets.
      const emptyRows = db.prepare("SELECT error, COUNT(*) AS c FROM dream_runs WHERE error LIKE 'llm-empty%' AND created_at >= ? GROUP BY error").all(dreamSince);
      const emptyRuns = emptyRows.reduce((sum, row) => sum + Number(row.c ?? 0), 0);
      if (emptyRuns >= 5) {
        // Keep the retry bit visible: `llm-empty:empty-text:max-tokens` and
        // `llm-empty-retry:empty-text:max-tokens` are different stories and used
        // to render as two identical buckets.
        const pretty = (error) => {
          const raw = String(error ?? '');
          const retried = raw.startsWith('llm-empty-retry');
          const reason = raw.replace(/^llm-empty(-retry)?:?/, '') || 'unknown';
          return `${reason}${retried ? '（重试）' : ''}`;
        };
        const buckets = emptyRows.map((row) => `${pretty(row.error)}×${row.c}`).join(' · ');
        add('warn', 'LLM_EMPTY', `最近 6 小时有 ${emptyRuns} 次巩固调用返回空（${buckets}）`, { count: emptyRuns, buckets: Object.fromEntries(emptyRows.map((row) => [row.error, Number(row.c ?? 0)])) });
      }
    } catch { /* ignore */ }
    if (config?.features?.llm !== true) {
      // Without this the consolidation/dream path silently records no-llm on every
      // tick (hundreds of rows in the production store) and the memory layer never solidifies.
      add('warn', 'LLM_DISABLED', 'LLM 功能未开启（features.llm=false）：巩固/做梦只会空转，记得在 profile 配置里打开', { feature: 'llm' });
    }
    const slowMs = Number.isFinite(Number(config?.maintainSlowMs)) ? Number(config.maintainSlowMs) : 2000;
    const slowWindowHours = Number.isFinite(Number(config?.maintainSlowWindowHours)) ? Number(config.maintainSlowWindowHours) : 6;
    // A slow pass is usually followed by a quiet one within minutes (maintain runs
    // on the heartbeat), so judging only the newest pass would hide every real
    // stall. Consider both, but only recent ones: a stall from yesterday is
    // history, not "currently stalling".
    const windowStart = now - slowWindowHours * 3_600_000;
    const withinWindow = (pass) => {
      const at = Date.parse(pass?.passAt ?? pass?.at ?? '');
      return !Number.isFinite(at) || at >= windowStart;
    };
    const slowest = [maintain, recorded]
      .filter((pass) => Number.isFinite(pass?.ms) && withinWindow(pass))
      .sort((left, right) => right.ms - left.ms)[0] ?? null;
    if (slowest && slowest.ms > slowMs) {
      const slowAt = slowest.passAt ?? slowest.at ?? null;
      const slowParsed = Date.parse(slowAt ?? '');
      const ageMinutes = Number.isFinite(slowParsed) ? Math.max(0, Math.round((now - slowParsed) / 60_000)) : null;
      const ageText = ageMinutes === null ? '' : `，距现在 ${ageMinutes} 分钟`;
      add('warn', 'SLOW_MAINTAIN', `维护耗时 ${slowest.ms}ms（${stamp(slowAt)}${ageText}），可能卡住宿主心跳`, { ms: slowest.ms, at: slowAt, ageMinutes });
    }
    if (capture.total > 0) {
      ok.push(`捕获过滤：${capture.total} 轮宿主对话中，剥掉注入 ${capture.stripped} 轮、截断 ${capture.truncated} 轮`);
    }
    if (inhibition.enabled) {
      ok.push(`抑制在线：${inhibition.count} 条被压制（均值 ${inhibition.average}）`);
      if (inhibition.count > 60) add('warn', 'INHIBITION_HIGH', `${inhibition.count} 条记忆正被抑制，可能压得太狠`, { count: inhibition.count });
    }

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
      inhibition,
      capture,
      vectors,
      maintain,
      consolidation: consolidationReport(scopeId, now),
      // Last pass that actually changed something (audit row), so callers can
      // distinguish "quiet heartbeat" from "nothing has run in hours".
      maintainLastChanged: recorded,
      summaryLayers,
    };
  }

  return { audit };
}
