/**
 * Optional host heartbeat. It does not generate messages; it only runs the
 * safe autonomy tick, drains jobs, plans retention and checks invariants.
 * The interval is unref'ed so it never keeps a process alive by itself.
 */
export function createScheduler({
  cortex,
  intervalMs = 60_000,
  logger = null,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  now = () => Date.now(),
  consolidateOnTick = false,
  isIdle = () => true,
} = {}) {
  if (!cortex) throw new Error('scheduler needs cortex');
  let timer = null;
  let running = false;
  let autoEvolveAt = 0;
  let lastReviewAt = 0;
  let lastSummonSyncAt = 0;
  let lastMaintenanceAt = 0;
  // While the vector queue still has a backlog the pass runs every two minutes
  // (each pass only drains for a bounded slice, so it needs repetition); once
  // the queue is empty it falls back to the normal ten-minute cadence.
  let maintenanceGapMs = 10 * 60_000;
  let lastGuardianDeepAt = 0;
  // Near-duplicate merging is cheap to check and expensive to forget: without a
  // periodic pass the merge layer stayed empty forever (dedupe only ran when a
  // caller asked for it by hand).
  let lastDedupeAt = 0;
  // One wider consolidation pass a day, so the 30-minute delta trigger is not the
  // only thing that ever looks at the store.
  let lastDeepDay = '';
  const autoDreamDays = new Set();
  const edgeReviewSeen = new Set();

  function localDay(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  async function runLifeAutomation(report) {
    const features = cortex.config?.features ?? {};
    if (!cortex.life || (features.autoDiary !== true && features.autoDream !== true && features.autoFeeling !== true && features.autoSleep !== true)) return;
    if (typeof cortex.scopeWritable === 'function' && !cortex.scopeWritable(cortex.config?.scope ?? 'global')) return;
    const at = now();
    const date = new Date(at);
    const day = localDay(at);
    const hour = date.getHours();
    const minute = date.getMinutes();
    let diary = [];
    try {
      diary = cortex.life.diaryList({ limit: 80 });
    } catch {
      diary = [];
    }
    if (features.autoDiary === true) {
      const slot = hour === 12 ? '12' : hour === 22 ? '22' : null;
      if (slot && minute < 10) {
        const source = `cortex:auto:slot:${slot}`;
        const done = diary.some((entry) => entry.source === source && localDay(entry.at) === day);
        if (!done) {
          try {
            report.steps.autoDiary = await cortex.life.diaryGenerate({ at, source });
          } catch (error) {
            report.steps.autoDiary = { error: error instanceof Error ? error.message : String(error) };
          }
        }
      }
    }

    if (features.autoFeeling === true && isIdle()) {
      try {
        const events = cortex.emotion?.events?.({ limit: 20 }) ?? [];
        const lastFeeling = events.find((event) => String(event.source ?? '').startsWith('cortex:auto:feeling'));
        if (!lastFeeling || at - Date.parse(lastFeeling.at) >= 55 * 60 * 1000) {
          report.steps.autoFeeling = await cortex.life.feelingGenerate({
            at,
            source: 'cortex:auto:feeling',
          });
        }
      } catch (error) {
        report.steps.autoFeeling = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (features.autoDream === true && hour === 22 && minute >= 5 && minute < 10 && !autoDreamDays.has(day)) {
      try {
        const latest = cortex.life.dreamList({ limit: 1 })[0] ?? null;
        const sameDayLate = latest && localDay(latest.at) === day && new Date(latest.at).getHours() >= 22;
        if (!sameDayLate) {
          report.steps.autoDream = await cortex.life.dreamGenerate({ at });
        }
        autoDreamDays.add(day);
      } catch (error) {
        report.steps.autoDream = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    // Nothing used to call life.sleep() on a schedule, so `consolidateOnSleep`
    // never had a chance to run. Sleep is only started when the host is idle and
    // the previous sleep is at least 20h old (or none exists).
    if (features.autoSleep === true && isIdle()) {
      try {
        const latestSleep = cortex.life.sleepRuns({ limit: 1 })[0] ?? null;
        const lastAt = latestSleep ? Date.parse(latestSleep.at) : NaN;
        if (!Number.isFinite(lastAt) || at - lastAt >= 20 * 3_600_000) {
          report.steps.autoSleep = await cortex.life.sleep({ at });
        }
      } catch (error) {
        report.steps.autoSleep = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  async function runGraphAuto(report) {
    const features = cortex.config?.features ?? {};
    if (!cortex.graphCandidates || !cortex.graphCandidateAction) return;
    try {
      const candidates = cortex.graphCandidates({ scopeId: cortex.config?.scope ?? 'global', limit: 50 });
      if (features.aiEdgeReview === true) {
        if (!cortex.reviewGraphCandidate) return;
        const reviewed = [];
        for (const edge of candidates.slice(0, 3)) {
          if (edgeReviewSeen.has(edge.id)) continue;
          edgeReviewSeen.add(edge.id);
          const review = await cortex.reviewGraphCandidate(edge);
          reviewed.push(edge.id);
          if (!review) continue;
          if (review.decision === 'approve') {
            cortex.graphCandidateAction({ action: 'approve', id: edge.id, scopeId: cortex.config?.scope ?? 'global', review });
          } else if (review.decision === 'reject') {
            cortex.graphCandidateAction({ action: 'reject', id: edge.id, scopeId: cortex.config?.scope ?? 'global', review });
          }
        }
        if (reviewed.length) report.steps.aiEdgeReview = { reviewed: reviewed.length, decisions: reviewed.length };
        return;
      }
      if (features.autoGraphCandidates !== true) return;
      let approved = 0;
      for (const edge of candidates) {
        const confidence = Number(edge.metadata?.confidence ?? edge.weight ?? 0);
        if (confidence < 0.55) continue;
        cortex.graphCandidateAction({ action: 'approve', id: edge.id, scopeId: cortex.config?.scope ?? 'global' });
        approved += 1;
      }
      if (approved) report.steps.autoGraph = { approved, scanned: candidates.length };
    } catch (error) {
      report.steps.autoGraph = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function runSummonSync(report) {
    if (!cortex.rebuildSummonBook) return;
    const at = now();
    if (lastSummonSyncAt && at - lastSummonSyncAt < 10 * 60_000) return;
    try {
      report.steps.summon = cortex.rebuildSummonBook({ scopeId: cortex.config?.scope ?? 'global', incremental: true });
      lastSummonSyncAt = at;
    } catch (error) {
      report.steps.summon = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function runReview(report) {
    if (!cortex.reviewIntentions) return;
    const at = now();
    if (lastReviewAt && at - lastReviewAt < 90 * 60 * 1000) return;
    if (typeof cortex.scopeWritable === 'function' && !cortex.scopeWritable(cortex.config?.scope ?? 'global')) return;
    try {
      report.steps.review = cortex.reviewIntentions({ at });
      lastReviewAt = at;
      if (cortex.labelEntities) {
        report.steps.entityLabels = await cortex.labelEntities({
          scopeId: cortex.config?.scope ?? 'global',
          limit: 2,
        });
      }
    } catch (error) {
      report.steps.review = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Timestamp of the last consolidation that was NOT caused by the per-tick path.
   * The tick path has no interval gate, so when features.consolidateOnTick is on
   * it writes a run every minute and a naive "last run" would make the delta
   * trigger permanently "too soon".
   */
  function lastRealConsolidationAt(scopeId) {
    try {
      // audit has no scope column, so resolve the scope through dream_runs.
      const row = cortex.db?.prepare?.(
        "SELECT a.at FROM audit a JOIN dream_runs d ON d.id = a.target_id WHERE a.action = 'consolidation.run' AND a.detail_json NOT LIKE '%\"caller\":\"tick\"%' AND d.scope_id = ? ORDER BY a.at DESC LIMIT 1",
      )?.get?.(scopeId);
      if (row?.at) return Date.parse(row.at);
    } catch { /* fall back to the run table */ }
    const last = cortex.consolidation.list?.({ scopeId, limit: 1 })?.[0] ?? null;
    return last?.at ? Date.parse(last.at) : null;
  }

  async function runAutoConsolidate(report) {
    const features = cortex.config?.features ?? {};
    if (features.consolidateOnTraceDelta !== true || !cortex.consolidation?.run) return;
    const scopeId = cortex.config?.scope ?? 'global';
    if (typeof cortex.scopeWritable === 'function' && !cortex.scopeWritable(scopeId)) return;
    const at = now();
    const lastAt = lastRealConsolidationAt(scopeId);
    // minutes → ms; the floor is one minute, not 60_000 (that would be 3.6e9 ms).
    const minGapMs = Math.max(1, Number(features.consolidateTraceGapMinutes ?? 30)) * 60_000;
    if (lastAt && Number.isFinite(lastAt) && at - lastAt < minGapMs) {
      report.steps.autoConsolidate = { skipped: 'too-soon', minutesSinceLast: Math.round((at - lastAt) / 60_000) };
      return;
    }
    const minNewTraces = Math.max(1, Number(features.consolidateTraceDelta ?? 20));
    const since = lastAt && Number.isFinite(lastAt) ? new Date(lastAt + 1).toISOString() : new Date(at - 24 * 3_600_000).toISOString();
    let fresh = 0;
    try {
      fresh = cortex.repos?.traces?.listSince?.(scopeId, since, { limit: 500 })?.length ?? 0;
    } catch (error) {
      report.steps.autoConsolidate = { error: error instanceof Error ? error.message : String(error) };
      return;
    }
    if (fresh < minNewTraces) {
      report.steps.autoConsolidate = { skipped: 'not-enough-new-traces', fresh, need: minNewTraces };
      return;
    }
    const result = await cortex.consolidation.run({ scopeId, limit: 30, now: at, caller: 'auto-trace-delta' });
    report.steps.autoConsolidate = {
      fresh,
      status: result.run.status,
      model: result.run.model,
      decisions: result.decisions.length,
      applied: result.applied.length,
      error: result.run.error ?? null,
    };
  }

  async function runAutoEvolve(report) {
    const features = cortex.config?.features ?? {};
    if (features.autoEvolve !== true || !cortex.evolution?.autoEvolve) return;
    const at = now();
    if (autoEvolveAt && at - autoEvolveAt < 6 * 60 * 60 * 1000) return;
    if (typeof cortex.scopeWritable === 'function' && !cortex.scopeWritable(cortex.config?.scope ?? 'global')) return;
    try {
      report.steps.autoEvolve = await cortex.evolution.autoEvolve({ scopeId: cortex.config?.scope ?? 'global' });
      autoEvolveAt = at;
    } catch (error) {
      report.steps.autoEvolve = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function localDayOf(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  /**
   * One deep pass a day, after deepConsolidateHour (local). The regular delta
   * trigger only sees "20 new traces since the last real run" and 30 candidates;
   * a day's housekeeping deserves a wider window. A fixed hour keeps the extra
   * LLM cost predictable, and the audit row (caller=deep-daily) prevents a
   * restart from running it twice in one day.
   */
  async function runDeepConsolidate(report) {
    if (!cortex.consolidation?.run) return;
    if (cortex.config?.deepConsolidateOnSchedule === false) return;
    const scopeId = cortex.config?.scope ?? 'global';
    if (typeof cortex.scopeWritable === 'function' && !cortex.scopeWritable(scopeId)) return;
    const at = now();
    const policy = cortex.memoryPolicy?.current?.() ?? null;
    const hour = Math.max(0, Math.min(23, Number(policy?.deepConsolidateHour ?? cortex.config?.deepConsolidateHour ?? 4)));
    if (new Date(at).getHours() < hour) return;
    const day = localDayOf(at);
    if (lastDeepDay === day) return;
    let alreadyToday = false;
    try {
      const row = cortex.db?.prepare?.("SELECT at FROM audit WHERE action = 'consolidation.run' AND detail_json LIKE '%\"caller\":\"deep-daily\"%' ORDER BY at DESC LIMIT 1")?.get?.();
      if (row?.at) alreadyToday = localDayOf(row.at) === day;
    } catch { /* fall through to the in-memory guard */ }
    if (alreadyToday) { lastDeepDay = day; return; }
    try {
      const result = await cortex.consolidation.run({
        scopeId,
        now: at,
        limit: Math.max(1, Math.min(80, Number(policy?.deepConsolidateLimit ?? cortex.config?.deepConsolidateLimit ?? 60))),
        caller: 'deep-daily',
        spread: true,
      });
      lastDeepDay = day;
      report.steps.deepConsolidate = {
        status: result.run?.status ?? null,
        decisions: result.decisions?.length ?? 0,
        applied: result.applied?.length ?? 0,
        skipped: result.skipped ?? null,
      };
    } catch (error) {
      report.steps.deepConsolidate = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function runAutoDedupe(report) {
    if (!cortex.consolidation?.dedupe) return;
    if (cortex.config?.dedupeOnSchedule === false) return;
    const scopeId = cortex.config?.scope ?? 'global';
    if (typeof cortex.scopeWritable === 'function' && !cortex.scopeWritable(scopeId)) return;
    const at = now();
    const gapHours = Math.max(1, Number(cortex.config?.dedupeGapHours ?? 6));
    if (lastDedupeAt && at - lastDedupeAt < gapHours * 3_600_000) return;
    try {
      const result = await cortex.consolidation.dedupe({
        scopeId,
        now: at,
        limit: Number(cortex.config?.dedupeLimit ?? 200),
        threshold: 0.8,
        caller: 'auto-dedupe',
      });
      lastDedupeAt = at;
      report.steps.autoDedupe = {
        status: result.run?.status ?? null,
        applied: result.applied?.length ?? 0,
        groups: result.decisions?.length ?? 0,
        skipped: result.skipped ?? null,
      };
    } catch (error) {
      report.steps.autoDedupe = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function runMaintenance(report) {
    const at = now();
    if (lastMaintenanceAt && at - lastMaintenanceAt < maintenanceGapMs) return;
    if (typeof cortex.scopeWritable === 'function' && !cortex.scopeWritable(cortex.config?.scope ?? 'global')) return;
    const scopeId = cortex.config?.scope ?? 'global';
    try {
      if (cortex.maintain) report.steps.maintain = cortex.maintain({ now: at, scopeId });
      if (cortex.vectorMaintain) {
        // A thousand+ traces can be missing embeddings after an upgrade. The
        // old 40/20 per pass needed hours; the queue is cheap to drain in bigger
        // batches because embedding is async and the pass is rare.
        report.steps.vectorMaintain = await cortex.vectorMaintain({
          scopeId,
          backfill: Number(cortex.config?.vectorBackfillBatch ?? 200),
          drain: Number(cortex.config?.vectorDrainBatch ?? 50),
          budgetMs: Number(cortex.config?.vectorDrainBudgetMs ?? 45000),
        });
        const pending = Number(report.steps.vectorMaintain?.pending ?? 0);
        const queued = Number(report.steps.vectorMaintain?.queued ?? 0);
        maintenanceGapMs = (pending > 0 || queued > 0) ? 2 * 60_000 : 10 * 60_000;
      }
      lastMaintenanceAt = at;
    } catch (error) {
      report.steps.maintain = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function runOnce() {
    if (running) return { skipped: true, reason: 'busy' };
    running = true;
    const report = { at: new Date(now()).toISOString(), steps: {} };
    try {
      if (cortex.autonomy) report.steps.autonomy = cortex.autonomy.tick({ at: now(), max: 1 });
    } catch (error) {
      report.steps.autonomy = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runReview(report);
    } catch (error) {
      report.steps.review = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runSummonSync(report);
    } catch (error) {
      report.steps.summon = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (cortex.runner?.runUntilIdle) report.steps.jobs = await cortex.runner.runUntilIdle({ now: now(), max: 3 });
      else if (cortex.runner?.runOne) report.steps.jobs = await cortex.runner.runOne({ now: now() });
    } catch (error) {
      report.steps.jobs = { error: error instanceof Error ? error.message : String(error) };
    }
    if ((consolidateOnTick || cortex.memoryPolicy?.current?.().consolidateOnTick === true) && cortex.consolidation?.run) {
      try {
        // The tick path used to fire on every tick (once a minute with the live
        // interval) — hundreds of no-llm rows prove it. Even with the flag on, honour the
        // same gap so enabling it cannot turn into a per-minute LLM call.
        const scopeId = cortex.config?.scope ?? 'global';
        const gapMs = Math.max(1, Number(cortex.config?.features?.consolidateTraceGapMinutes ?? 30)) * 60_000;
        const recent = cortex.consolidation.list?.({ scopeId, limit: 1 })?.[0] ?? null;
        const recentAt = recent?.at ? Date.parse(recent.at) : null;
        if (recentAt && Number.isFinite(recentAt) && now() - recentAt < gapMs) {
          report.steps.consolidation = { skipped: 'too-soon', minutesSinceLast: Math.round((now() - recentAt) / 60_000) };
        } else {
          report.steps.consolidation = await cortex.consolidation.run({ scopeId, now: now(), limit: 10, caller: 'tick' });
        }
      } catch (error) {
        report.steps.consolidation = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    try {
      await runAutoConsolidate(report);
    } catch (error) {
      report.steps.autoConsolidate = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runDeepConsolidate(report);
    } catch (error) {
      report.steps.deepConsolidate = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runAutoEvolve(report);
    } catch (error) {
      report.steps.autoEvolve = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runAutoDedupe(report);
    } catch (error) {
      report.steps.autoDedupe = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runGraphAuto(report);
    } catch (error) {
      report.steps.autoGraph = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runMaintenance(report);
    } catch (error) {
      report.steps.maintain = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runLifeAutomation(report);
    } catch (error) {
      report.steps.autoLife = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (cortex.retention) {
        const plan = cortex.retention.plan({ now: now(), limit: 20 });
        report.steps.retention = { active: plan.active, candidates: plan.count };
      }
    } catch (error) {
      report.steps.retention = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (cortex.guardian) {
        const at = now();
        const deep = !lastGuardianDeepAt || at - lastGuardianDeepAt >= 6 * 60 * 60 * 1000;
        report.steps.guardian = cortex.guardian.check({ deep });
        if (deep) lastGuardianDeepAt = at;
      }
      if (cortex.evolution?.observeHealth && report.steps.guardian) {
        report.steps.evolutionHealth = cortex.evolution.observeHealth(report);
      }
    } catch (error) {
      report.steps.guardian = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (cortex.emitTick) cortex.emitTick(report);
    } catch (error) {
      report.steps.tick = { error: error instanceof Error ? error.message : String(error) };
    }
    running = false;
    return report;
  }

  function start() {
    if (timer) return false;
    timer = setIntervalImpl(() => {
      runOnce().catch((error) => {
        logger?.warn?.(`cortex scheduler failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, Math.max(5_000, Number(intervalMs) || 60_000));
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearIntervalImpl(timer);
    timer = null;
    return true;
  }

  return { start, stop, runOnce, status: () => ({ running: Boolean(timer), intervalMs: Math.max(5_000, Number(intervalMs) || 60_000), maintenanceGapMs }) };
}
