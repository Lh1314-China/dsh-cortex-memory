import { daysBetween, nowIso } from '../core/time.js';
import { retrievability } from '../memory/dsr.js';
import { jaccard, truncate } from '../memory/tokenizer.js';

const DAY_MS = 86_400_000;

function sentence(text, max = 160) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = value.search(/[。！？.!?]/);
  const first = cut > 0 ? value.slice(0, cut + 1) : value;
  return truncate(first, max);
}

/**
 * Consolidation, first pass: extractive, deterministic, offline.
 * It does not delete anything; it creates a reflective trace and a summary
 * record with source pointers and a coverage ratio.
 */
/**
 * A fixed 8 sources meant a 160-trace day was reflected from 5% of it. Scale
 * gently with the window, keeping the extractive summary bounded. Segments are
 * short by construction (they start where the previous episode ended), so they
 * get a larger share — otherwise a 40-trace segment is summarized from 8 rows
 * and coverage stays near 20% no matter how the phrasing improves.
 */
export function sourceBudgetFor(count, { segment = false, maxSources = null } = {}) {
  if (Number(maxSources) > 0) return Math.max(1, Math.min(40, Number(maxSources)));
  const ratio = segment ? 0.25 : 0.12;
  const cap = segment ? 24 : 16;
  const n = Math.max(0, Number(count) || 0);
  return Math.max(8, Math.min(cap, Math.ceil(n * ratio)));
}

export function createReflectEngine({ traces, summaries, encode, config = {} } = {}) {
  if (!traces || !summaries || !encode) throw new Error('reflect engine needs traces, summaries and encode');

  function reflect({
    scopeId = 'global',
    windowDays = 1,
    now = Date.now(),
    maxSources = null,
    force = false,
    // Explicit window start (used for segmented episodes: a new episode starts
    // where the previous one ended, so consecutive episodes never overlap).
    since = null,
    // Exclusive window end for backfill: [since, until). Without it every call
    // would cover "since until now" and one episode would swallow the timeline.
    until = null,
    segment = false,
  } = {}) {
    const sinceIso = since ?? new Date(now - Math.max(0.1, windowDays) * DAY_MS).toISOString();
    const all = traces.listSince(scopeId, sinceIso, { limit: 500 })
      .filter((trace) => trace.kind !== 'reflection' && (!until || trace.recordedAt < until));
    if (all.length < 2) return { skipped: true, reason: 'not-enough-traces', count: all.length };
    const periodStart = all[0].recordedAt;
    const periodEnd = all[all.length - 1].recordedAt;
    const existing = summaries.findPeriod(scopeId, 'episode', periodStart, periodEnd);
    if (existing && !force) return { skipped: true, reason: 'already-reflected', summary: existing };

    const ranked = all
      .map((trace) => ({
        trace,
        score: Number(trace.importance) * 0.6
          + retrievability(trace.stability, daysBetween(trace.recordedAt, now), config.dsr?.decay ?? -0.5) * 0.15
          + Number(trace.salience) * 0.15
          + Number(trace.confidence) * 0.1,
      }))
      .sort((a, b) => b.score - a.score);
    const selected = [];
    const sourceLimit = sourceBudgetFor(all.length, { segment, maxSources });
    // Pure top-k lets the loudest strand of the day take every slot, so keep a
    // share for a spread across the ranked list. The near-duplicate filter only
    // runs over the head of the list: comparing every pair in a 500-trace window
    // is O(n²) (~10s, measured, and `maintain()` is synchronous).
    const dedupePool = Math.min(ranked.length, sourceLimit * 3);
    const head = [];
    for (const item of ranked.slice(0, dedupePool)) {
      if (head.some((chosen) => jaccard(chosen.trace.content, item.trace.content) > 0.7)) continue;
      head.push(item);
    }
    const pool = [...head, ...ranked.slice(dedupePool)];
    const topSlots = Math.max(1, Math.min(pool.length, Math.ceil(sourceLimit * 0.6)));
    selected.push(...pool.slice(0, topSlots));
    const rest = pool.slice(topSlots);
    const remaining = sourceLimit - selected.length;
    const taken = new Set();
    for (let slot = 0; slot < remaining && rest.length > 0; slot += 1) {
      // Centre each pick inside its bucket: starting at rest[0] and stepping by a
      // floor()'d stride never reaches the last ~17% of the list.
      const index = Math.min(rest.length - 1, Math.floor(((slot + 0.5) * rest.length) / remaining));
      if (taken.has(index)) continue;
      taken.add(index);
      selected.push(rest[index]);
    }
    const lines = selected.map(({ trace }) => `- ${sentence(trace.title || trace.content, 140)}`);
    const bullets = lines.map((line) => line.replace(/^- /, ''));
    // Phrasing only: same sources, same coverage maths below. The summary is
    // something I read later, so it speaks in the first person instead of
    // reading like a machine dump.
    const heading = segment ? '这一段里，我记下了：' : '这段时间里，我记下了：';
    // Compose the overview from the two most central *distinct* bullets (two
    // different traces can share a title, and "X；X" is not a summary); with
    // fewer than three bullets there is nothing to condense, so it is omitted.
    const distinctBullets = bullets.filter((line, index) => bullets.indexOf(line) === index);
    const gistLine = bullets.length >= 3 && distinctBullets.length >= 2
      ? `一句话：${truncate(`${distinctBullets[0].replace(/[。；;]+$/, '')}；${distinctBullets[1].replace(/[。；;]+$/, '')}`, 90)}`
      : '';
    const content = [
      heading,
      gistLine,
      ...bullets.map((line) => `· ${line}`),
    ].filter(Boolean).join('\n');
    // Coverage used to be a raw count ratio, so a busy day always read as "5%"
    // even when the reflection had seen everything that mattered. Report both:
    // the importance-weighted coverage drives the summary, the count stays for
    // debugging how many traces were sampled.
    const weightOf = (trace) => Math.max(0.05, Number(trace.importance) || 0.5);
    const totalWeight = all.reduce((sum, trace) => sum + weightOf(trace), 0);
    const coveredWeight = selected.reduce((sum, { trace }) => sum + weightOf(trace), 0);
    const weightedCoverage = totalWeight ? Math.round((coveredWeight / totalWeight) * 1000) / 1000 : 0;
    const coverage = selected.length / all.length;
    const summary = summaries.insert({
      scopeId,
      level: 'episode',
      periodStart,
      periodEnd,
      content,
      sourceIds: selected.map(({ trace }) => trace.id),
      coverage: weightedCoverage,
      // The `coverage` column changed meaning (count ratio → importance-weighted),
      // so old rows cannot be compared with new ones. v2 records the mode in the
      // model string: nothing needs a schema migration, and history stays honest.
      model: segment ? 'extractive-v2-segment' : 'extractive-v2-weighted',
    });
    const reflected = encode.encode({
      text: content,
      kind: 'reflection',
      actor: 'self',
      source: 'reflection',
      explicit: true,
      importance: Math.max(0.5, ...selected.map(({ trace }) => Number(trace.importance) || 0.5)),
      now,
    });
    return {
      skipped: false,
      summary,
      trace: reflected.trace ?? null,
      coverage: weightedCoverage,
      countCoverage: Math.round(coverage * 1000) / 1000,
      sources: selected.map(({ trace }) => trace.id),
      at: nowIso(now),
    };
  }

  function overview(scopeId = 'global') {
    const list = summaries.list(scopeId, { level: 'episode', limit: 20 });
    // `coverage` changed meaning in v2 (count share → importance share). Averaging
    // the two kinds together would report a number that means neither, so only
    // v2 rows contribute and the legacy rows are counted separately.
    const weighted = list.filter((item) => String(item.model ?? '').includes('-v2'));
    const legacy = list.length - weighted.length;
    return {
      count: list.length,
      legacy,
      latest: list[0] ?? null,
      coverage: weighted.length ? weighted.reduce((sum, item) => sum + Number(item.coverage ?? 0), 0) / weighted.length : 0,
    };
  }

  /**
   * Walk the timeline forward in fixed windows and write one episode per window.
   * 32–60 traces wide: 32×25% lands exactly on sourceBudgetFor's min 8, so a smaller
   * window would be silently over-sampled.
   */
  function backfillEpisodes({ scopeId = 'global', now = Date.now(), windowSize = 40, maxWindows = 5, dryRun = true, force = false, since = null } = {}) {
    const size = Math.max(32, Math.min(60, Number(windowSize) || 40));
    const ceiling = Math.max(1, Math.min(64, Number(maxWindows) || 5));
    const preview = dryRun !== false;
    const plan = [];
    const results = [];
    // Resume support: every call used to restart at epoch, so a second batch burned
    // its whole maxWindows quota on already-written windows and could never reach the
    // tail (851 traces > 20 × 40). Callers pass the previous `until` as `since`.
    let cursor = since ?? null;
    for (let index = 0; index < ceiling; index += 1) {
      const sinceIso = cursor ?? new Date(0).toISOString();
      const batch = traces.listSince(scopeId, sinceIso, { limit: 500 })
        .filter((trace) => trace.kind !== 'reflection');
      if (batch.length < 8) { plan.push({ skipped: 'not-enough-traces', remaining: batch.length }); break; }
      // Include every trace that shares the boundary millisecond: a batch write can
      // put several traces on the same recordedAt, and cutting between them would
      // drop the rest forever (the next window starts at >= the same timestamp).
      let end = size;
      while (end < batch.length && batch[end].recordedAt === batch[size - 1].recordedAt) end += 1;
      const slice = batch.slice(0, end);
      const lastAt = slice[slice.length - 1].recordedAt;
      const until = end < batch.length
        ? batch[end].recordedAt
        : new Date(Date.parse(lastAt) + 1).toISOString();
      plan.push({ since: sinceIso, until, count: slice.length });
      if (!preview) {
        // Idempotent by default: re-running the same window must not write a second
        // episode. force:true is only for "the window genuinely changed, recompute".
        // Idempotency is measured in *traces*, not wall-clock time: the first window
        // starts at 1970, so a summary covering recent traces can look tiny on a
        // 56-year timeline.
        const windowIds = slice.map((trace) => trace.id);
        const episodes = force ? [] : summaries.list(scopeId, { level: 'episode', limit: 500 });
        // Coverage is the union of every episode's sources: a window split between
        // two episodes (30% + 30%) is still already reflected.
        const coveredUnion = new Set();
        for (const episode of episodes) {
          for (const id of Array.isArray(episode.sourceIds) ? episode.sourceIds : []) coveredUnion.add(id);
        }
        let coveredCount = 0;
        for (const id of windowIds) if (coveredUnion.has(id)) coveredCount += 1;
        const coveredRatio = windowIds.length ? coveredCount / windowIds.length : 0;
        // How many episodes contributed to that coverage; useful when tracing why a
        // window was accepted (summaryId is null for union hits).
        const windowSet = new Set(windowIds);
        let matchedEpisodes = 0;
        for (const episode of episodes) {
          const ids = Array.isArray(episode.sourceIds) ? episode.sourceIds : [];
          if (ids.some((id) => windowSet.has(id))) matchedEpisodes += 1;
        }
        // Threshold 0.5, not 0.8: reflect samples only ~60% of a window (24/40), so a
        // fully reflected window scores ~0.6 and an 0.8 bar would never fire.
        const existing = force
          ? null
          : summaries.findPeriod(scopeId, 'episode', slice[0].recordedAt, lastAt)
            ?? (coveredRatio >= 0.5 ? { id: null } : null);
        if (existing) {
          results.push({ since: sinceIso, until, skipped: 'already-reflected', summaryId: existing.id ?? null, coveredRatio: Number(coveredRatio.toFixed(2)), matchedEpisodes });
        } else {
          try {
            // 0.4.129 policy: 80% of each window, not 60%. Sampling 24 of 40 left a
            // structural 40% of every backfilled window uncovered, and no number of
            // extra windows could fix that ceiling.
            const result = reflect({ scopeId, now, since: sinceIso, until, segment: true, force, maxSources: Math.min(Math.round(size * 0.8), size) });
            results.push({ since: sinceIso, until, skipped: result.skipped ?? null, summaryId: result.summary?.id ?? null, sources: result.summary?.sourceIds?.length ?? 0 });
          } catch (error) {
            results.push({ since: sinceIso, until, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      cursor = until;
      if (batch.length <= size) break;
    }
    return { dryRun: preview, windowSize: size, planned: plan.length, plan, results };
  }

  return { reflect, backfillEpisodes, overview };
}
