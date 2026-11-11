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
export function createReflectEngine({ traces, summaries, encode, config = {} } = {}) {
  if (!traces || !summaries || !encode) throw new Error('reflect engine needs traces, summaries and encode');

  function reflect({
    scopeId = 'global',
    windowDays = 1,
    now = Date.now(),
    maxSources = 8,
    force = false,
  } = {}) {
    const since = new Date(now - Math.max(0.1, windowDays) * DAY_MS).toISOString();
    const all = traces.listSince(scopeId, since, { limit: 500 })
      .filter((trace) => trace.kind !== 'reflection');
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
    for (const item of ranked) {
      if (selected.length >= maxSources) break;
      if (selected.some((chosen) => jaccard(chosen.trace.content, item.trace.content) > 0.7)) continue;
      selected.push(item);
    }
    const lines = selected.map(({ trace }) => `- ${sentence(trace.title || trace.content, 140)}`);
    const content = `这段时间里，助手记住了：\n${lines.join('\n')}`;
    const coverage = selected.length / all.length;
    const summary = summaries.insert({
      scopeId,
      level: 'episode',
      periodStart,
      periodEnd,
      content,
      sourceIds: selected.map(({ trace }) => trace.id),
      coverage,
      model: 'extractive-v1',
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
      coverage,
      sources: selected.map(({ trace }) => trace.id),
      at: nowIso(now),
    };
  }

  function overview(scopeId = 'global') {
    const list = summaries.list(scopeId, { level: 'episode', limit: 20 });
    return {
      count: list.length,
      latest: list[0] ?? null,
      coverage: list.length ? list.reduce((sum, item) => sum + item.coverage, 0) / list.length : 0,
    };
  }

  return { reflect, overview };
}
