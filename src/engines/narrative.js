import { daysBetween, nowIso } from '../core/time.js';
import { jaccard, overlapScore, truncate } from '../memory/tokenizer.js';

const DAY_MS = 86_400_000;

function sentence(text, max = 140) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = value.search(/[。！？.!?]/);
  const first = cut > 0 ? value.slice(0, cut + 1) : value;
  return truncate(first, max);
}

/**
 * Narrative threads are autobiographical: a small ordered chain of episodes
 * around a seed memory, linked by time, tags and content. They are stored as
 * `summaries` with level=thread, so they can be recalled as one memory.
 */
export function createNarrativeEngine({ traces, summaries, now = () => Date.now() } = {}) {
  if (!traces || !summaries) throw new Error('narrative engine needs traces and summaries');

  function buildThread({ scopeId = 'global', seedTraceId, windowDays = 7, max = 8, at = now() } = {}) {
    const seed = traces.get(seedTraceId);
    if (!seed) return { skipped: true, reason: 'seed-not-found' };
    const since = new Date(at - Math.max(0.5, windowDays) * DAY_MS).toISOString();
    const pool = traces.listSince(scopeId, since, { limit: 300 })
      .filter((trace) => trace.kind !== 'reflection');
    const seedTags = (seed.tags ?? []).join(' ');
    const ranked = pool.map((trace) => {
      const hours = Math.abs(Date.parse(trace.recordedAt) - Date.parse(seed.recordedAt)) / 3_600_000;
      const timeScore = 1 / (1 + hours / 24);
      const tagScore = seedTags ? jaccard(seedTags, (trace.tags ?? []).join(' ')) : 0;
      const contentScore = overlapScore(seed.content, trace.content);
      return {
        trace,
        score: Number(trace.importance) * 0.35 + timeScore * 0.3 + tagScore * 0.2 + contentScore * 0.15,
      };
    }).sort((a, b) => b.score - a.score);
    const selected = [];
    for (const item of ranked) {
      if (selected.length >= Math.max(2, Math.min(20, max))) break;
      if (item.trace.id === seed.id || selected.every((chosen) => chosen.trace.id !== item.trace.id)) selected.push(item);
    }
    selected.sort((a, b) => String(a.trace.recordedAt).localeCompare(String(b.trace.recordedAt)));
    const lines = selected.map(({ trace }) => `- ${String(trace.recordedAt).slice(0, 10)} ${sentence(trace.title || trace.content)}`);
    const content = `一段关于「${seed.title || sentence(seed.content, 40)}」的经历：\n${lines.join('\n')}`;
    const summary = summaries.insert({
      scopeId,
      level: 'thread',
      periodStart: selected[0]?.trace.recordedAt ?? seed.recordedAt,
      periodEnd: selected.at(-1)?.trace.recordedAt ?? seed.recordedAt,
      content,
      sourceIds: selected.map(({ trace }) => trace.id),
      coverage: pool.length ? selected.length / pool.length : 1,
      model: 'narrative-v1',
    });
    return { skipped: false, summary, seed, traces: selected.map(({ trace }) => trace), coverage: summary.coverage, at: nowIso(at) };
  }

  function recallThreads(query, { scopeId = 'global', limit = 5 } = {}) {
    const threads = summaries.list(scopeId, { level: 'thread', limit: 100 });
    return threads
      .map((thread) => ({ thread, score: overlapScore(query, thread.content) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, limit)));
  }

  function weave({ scopeId = 'global', maxThreads = 3, at = now() } = {}) {
    const recent = traces.list({ scopeId, state: 'active', limit: 100 })
      .filter((trace) => trace.kind !== 'reflection')
      .sort((a, b) => Number(b.importance) - Number(a.importance));
    const built = [];
    for (const trace of recent) {
      if (built.length >= maxThreads) break;
      const existing = summaries.list(scopeId, { level: 'thread', limit: 100 })
        .some((summary) => summary.sourceIds.includes(trace.id));
      if (existing) continue;
      const result = buildThread({ scopeId, seedTraceId: trace.id, at });
      if (!result.skipped) built.push(result);
    }
    return { built: built.length, threads: built };
  }

  return { buildThread, recallThreads, weave };
}
