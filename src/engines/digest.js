import { nowIso } from '../core/time.js';

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function createDigestEngine({ traces, summaries, emotion = null, goals = null, feedback = null, scopeId = 'global' } = {}) {
  if (!traces) throw new Error('digest engine needs traces');

  function daily({ date = dayKey(Date.now()), now = Date.now(), persist = true } = {}) {
    const all = traces.list({ scopeId, limit: 5000 });
    const rows = all.filter((trace) => dayKey(trace.recordedAt) === date);
    const byKind = {};
    for (const trace of rows) byKind[trace.kind] = (byKind[trace.kind] ?? 0) + 1;
    const important = rows.slice().sort((a, b) => Number(b.importance) - Number(a.importance)).slice(0, 5);
    const emotions = emotion?.events?.({ limit: 200 })?.filter((event) => dayKey(event.at) === date) ?? [];
    const activeGoals = goals?.list?.({ scopeId, status: 'active', limit: 20 }) ?? [];
    const feedbackRows = (() => {
      try { return feedback?.list?.({ limit: 500 })?.filter((row) => dayKey(row.at) === date) ?? []; } catch { return []; }
    })();
    const content = [
      `# ${date} 记忆摘要`,
      '',
      `- 新记忆：${rows.length} 条（${Object.entries(byKind).map(([kind, count]) => `${kind} ${count}`).join(' / ') || '无'}）`,
      `- 情绪事件：${emotions.length} 条`,
      `- 反馈：${feedbackRows.length} 条`,
      `- 进行中的目标：${activeGoals.length} 条`,
      '',
      '## 重要记忆',
      ...(important.length ? important.map((trace) => `- ${trace.title || trace.content.slice(0, 60)}（${trace.kind}）`) : ['- 无']),
      '',
      '## 情绪',
      ...(emotions.length ? emotions.slice(0, 8).map((event) => `- ${event.emotions.map((item) => item.name).join('、')}：${event.text.slice(0, 80)}`) : ['- 无']),
      '',
    ].join('\n');
    let summary = null;
    if (persist && rows.length > 0) {
      summary = summaries.insert({
        scopeId,
        level: 'digest',
        title: `${date} 摘要`,
        content,
        sourceIds: rows.map((trace) => trace.id),
        coverage: rows.length ? Math.min(1, important.length / rows.length) : 0,
      });
    }
    return { date, counts: { traces: rows.length, emotions: emotions.length, feedback: feedbackRows.length, goals: activeGoals.length }, byKind, important, content, summary, at: nowIso(now) };
  }

  return { daily };
}
