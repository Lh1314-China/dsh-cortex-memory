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
  let lastGuardianDeepAt = 0;
  const autoDreamDays = new Set();
  const edgeReviewSeen = new Set();

  function localDay(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  async function runLifeAutomation(report) {
    const features = cortex.config?.features ?? {};
    if (!cortex.life || (features.autoDiary !== true && features.autoDream !== true && features.autoFeeling !== true)) return;
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
    if (consolidateOnTick && cortex.consolidation?.run) {
      try {
        report.steps.consolidation = await cortex.consolidation.run({ scopeId: cortex.config?.scope ?? 'global', now: now(), limit: 10 });
      } catch (error) {
        report.steps.consolidation = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    try {
      await runAutoEvolve(report);
    } catch (error) {
      report.steps.autoEvolve = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await runGraphAuto(report);
    } catch (error) {
      report.steps.autoGraph = { error: error instanceof Error ? error.message : String(error) };
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

  return { start, stop, runOnce, status: () => ({ running: Boolean(timer), intervalMs: Math.max(5_000, Number(intervalMs) || 60_000) }) };
}
