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
export function createNarrativeEngine({ traces, summaries, selfName = '助手', now = () => Date.now() } = {}) {
  if (!traces || !summaries) throw new Error('narrative engine needs traces and summaries');

  function buildThread({ scopeId = 'global', seedTraceId, windowDays = 7, windowHours = 24, max = 8, at = now() } = {}) {
    const seed = traces.get(seedTraceId);
    if (!seed) return { skipped: true, reason: 'seed-not-found' };
    // Query the seed's own time range. `listSince` walks forward from its start and
    // stops at `limit`, so with a store older than the limit the pool held 11-11 /
    // 11-12 residue while the seed was from tonight — every thread then fell through
    // to the 7-day fallback and read like last week's diary.
    const anchor = Date.parse(seed.recordedAt);
    const around = (spanHours, limit = 600) => {
      if (!Number.isFinite(anchor)) return [];
      const span = Math.max(1, Number(spanHours) || 24) * 3_600_000;
      const from = new Date(anchor - span).toISOString();
      const to = new Date(anchor + span).toISOString();
      const rows = typeof traces.range === 'function'
        ? traces.range(scopeId, from, to, { limit, state: 'active' })
        : traces.listSince(scopeId, from, { limit }).filter((trace) => Date.parse(trace.recordedAt) <= anchor + span);
      return rows.filter((trace) => trace.kind !== 'reflection');
    };
    // A thread is "what happened around this moment", not "the heaviest things I
    // remember". Soft weights cannot stop a 1.0 identity trace from last week from
    // crowding out the seed's neighbours, so the pool is bounded by time first:
    // seed ± windowHours, then ±72h, then ±windowDays only when the neighbourhood is
    // too quiet to make a line (a silent night still gets one). Every pass carries
    // headroom above its own traffic: a busy day already reaches ~320 traces in 24h,
    // so a 300-row cap would silently drop the newest neighbours.
    let windowHoursUsed = Math.max(1, Number(windowHours) || 24);
    let pool = around(windowHoursUsed, 600);
    if (pool.filter((trace) => trace.id !== seed.id).length < 2) {
      windowHoursUsed = Math.max(windowHoursUsed, 72);
      pool = around(windowHoursUsed, 1200);
    }
    if (pool.filter((trace) => trace.id !== seed.id).length < 2) {
      windowHoursUsed = Math.max(windowHoursUsed, Math.round(Math.max(0.5, windowDays) * 24));
      pool = around(windowHoursUsed, 2000);
    }
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
    // One flowing paragraph instead of a bullet dump: a thread is something you
    // read back, not a list you scan. The date prefix is stripped before the date is
    // stated once in the opener.
    //
    // Do not use sentence() here: it treats the dot inside a version number as a full
    // stop, so "dsh-cortex 0.4.139 打包交付" came out as "dsh-cortex 0." and every
    // thread read like a column of stumps. A dot counts as a sentence end only when
    // it is not followed by a digit.
    // Truncation must not stop mid-parenthesis or mid-clause: cut at the last
    // punctuation inside the budget, and drop an unclosed bracket tail first.
    const trimAtBoundary = (text, max = 90) => {
      if (text.length <= max) return text;
      let slice = text.slice(0, max);
      const openCn = slice.lastIndexOf('（');
      const closeCn = slice.lastIndexOf('）');
      if (openCn > closeCn && openCn >= 20) slice = slice.slice(0, openCn);
      const openEn = slice.lastIndexOf('(');
      const closeEn = slice.lastIndexOf(')');
      if (openEn > closeEn && openEn >= 20) slice = slice.slice(0, openEn);
      const boundary = Math.max(
        slice.lastIndexOf('，'), slice.lastIndexOf('；'), slice.lastIndexOf('。'),
        slice.lastIndexOf('：'), slice.lastIndexOf('、'),
      );
      if (boundary >= 20) slice = slice.slice(0, boundary);
      return slice.trim();
    };
    // Capture stores a 40-char title (it stops mid-parenthesis: "…验收（豆包装：desk")
    // while the content holds the whole turn. Read the content first and strip the
    // speaker prefix ("用户：" / the assistant's own name) capture writes in front of it.
    const speakerPrefix = ['用户', '助手', '系统', selfName, 'user', 'assistant']
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const stripSpeaker = (text) => String(text ?? '').replace(new RegExp(`^(?:${speakerPrefix})\\s*[：:]\\s*`, 'i'), '');
    // A quoted turn arrives as "用户：> …": the speaker prefix hides the quote marker, so
    // both have to come off together — one pass strips only the prefix and leaves "> ".
    const stripDecoration = (text) => {
      let value = String(text ?? '');
      for (let pass = 0; pass < 3; pass += 1) {
        const before = value;
        value = stripSpeaker(value).replace(/^\s*>\s*/, '');
        if (value === before) break;
      }
      return value;
    };
    // The seed topic is read aloud too: quote marker, speaker prefix, markdown emphasis,
    // a trailing dot, then a punctuation-safe cut. It must come from content as well —
    // the seed's own title is captured at 40 chars and would end the topic mid-sentence.
    const cleanTitle = (text) => stripDecoration(String(text ?? ''))
      .replace(/^\s*>\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/^20\d\d[-./年]\s*\d{1,2}[-./月]\s*\d{1,2}日?\s*[，,：:、]?\s*/, '')
      .replace(/[。；;.]+$/, '')
      .trim();
    const clean = (trace) => {
      const value = String(trace.content || trace.title || trace.summary || '').replace(/\s+/g, ' ').trim();
      const cut = value.search(/[。！？!?]|\.(?![0-9])/);
      const first = cut > 0 ? value.slice(0, cut + 1) : value;
      // Speaker prefix and quote marker come off together, in either order.
      return trimAtBoundary(stripDecoration(first), 90)
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/^20\d\d[-./年]\s*\d{1,2}[-./月]\s*\d{1,2}日?\s*[，,：:、]?\s*/, '')
        .replace(/[。；;]+$/, '')
        .trim();
    };
    // A fragment is not a beat in the story: skip stumps like "dsh-cortex 0." or a
    // trailing open bracket. Short human titles ("两天前", "刚刚这句") are fine, and a
    // full sentence that happens to end in an English dot is not a fragment.
    const isFragment = (text) => !text
      || text.length < 3
      || /[0-9]\.$/.test(text)
      || /[（(]$/.test(text)
      || /^[\s\p{P}\p{S}]+$/u.test(text);
    const parts = selected.map(({ trace }) => clean(trace)).filter((part) => !isFragment(part));
    const when = (iso) => {
      const date = new Date(iso);
      return Number.isFinite(date.getTime()) ? `${date.getMonth() + 1}月${date.getDate()}日` : '';
    };
    const opener = selected.length ? when(selected[0].trace.recordedAt) : '';
    const clauses = parts.map((part, index) => {
      if (index === 0) return part;
      if (index === parts.length - 1 && parts.length > 2) return `最后，${part}`;
      return `${index === 1 ? '接着' : '后来'}，${part}`;
    });
    const body = clauses.length
      ? `${opener ? `${opener}，` : ''}${clauses.join('；')}。`
      : '只留下了这一个种子，附近还没别的痕迹。';
    const seedTopic = cleanTitle(trimAtBoundary(String(seed.content || seed.title || '').replace(/\s+/g, ' ').trim(), 60))
      || sentence(seed.content, 40);
    const content = `一段关于「${seedTopic}」的经历：${body}`;
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
    return { skipped: false, summary, seed, traces: selected.map(({ trace }) => trace), coverage: summary.coverage, windowHours: windowHoursUsed, at: nowIso(at) };
  }

  function recallThreads(query, { scopeId = 'global', limit = 5 } = {}) {
    const threads = summaries.list(scopeId, { level: 'thread', limit: 100 });
    return threads
      .map((thread) => ({ thread, score: overlapScore(query, thread.content) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, limit)));
  }

  // Threads are rebuilt from the same recurring topics every pass, so without a
  // retention cap the table grows forever. Keep the newest `maxTotal`, drop the
  // oldest tail.
  function pruneThreads(scopeId, maxTotal) {
    const cap = Math.max(1, Math.min(200, Number(maxTotal) || 24));
    const threads = summaries.list(scopeId, { level: 'thread', limit: 500 });
    if (threads.length <= cap) return 0;
    let removed = 0;
    for (const thread of threads.slice(cap)) {
      try { if (summaries.remove?.(thread.id)) removed += 1; } catch { /* retention is best effort */ }
    }
    return removed;
  }

  function weave({ scopeId = 'global', maxThreads = 3, maxTotal = 24, windowHours = 24, at = now() } = {}) {
    const pruned = pruneThreads(scopeId, maxTotal);
    // Seed by recency, not importance: sorting by importance kept threading the
    // same old identity traces, so every thread read like "about the build" or
    // "about the promise". Recency makes the line follow what actually happened.
    const recent = traces.list({ scopeId, state: 'active', limit: 100 })
      .filter((trace) => trace.kind !== 'reflection')
      .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    const built = [];
    for (const trace of recent) {
      if (built.length >= maxThreads) break;
      const existing = summaries.list(scopeId, { level: 'thread', limit: 100 })
        .some((summary) => summary.sourceIds.includes(trace.id));
      if (existing) continue;
      const result = buildThread({ scopeId, seedTraceId: trace.id, windowHours, at });
      if (!result.skipped) built.push(result);
    }
    return { built: built.length, threads: built, pruned };
  }

  return { buildThread, recallThreads, weave, pruneThreads };
}
