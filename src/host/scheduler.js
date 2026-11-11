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
} = {}) {
  if (!cortex) throw new Error('scheduler needs cortex');
  let timer = null;
  let running = false;

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
      if (cortex.retention) {
        const plan = cortex.retention.plan({ now: now(), limit: 20 });
        report.steps.retention = { active: plan.active, candidates: plan.count };
      }
    } catch (error) {
      report.steps.retention = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (cortex.guardian) report.steps.guardian = cortex.guardian.check();
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
