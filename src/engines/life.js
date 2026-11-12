import { makeId } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { truncate } from '../memory/tokenizer.js';

function sentence(text, max = 140) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = value.search(/[。！？.!?]/);
  return truncate(cut > 0 ? value.slice(0, cut + 1) : value, max);
}

export function createLifeEngine({
  db,
  traces,
  reflect = null,
  development = null,
  working = null,
  emotion = null,
  consolidation = null,
  features = {},
  llm = null,
  diaryLlm = null,
  feelingLlm = null,
  webSearch = null,
  scopeId = 'global',
} = {}) {
  if (!db || !traces) throw new Error('life engine needs db and traces');

  function diaryWrite({ text, mood = null, source = 'user', at = nowIso() } = {}) {
    const value = String(text ?? '').trim();
    if (!value) throw new Error('diary text is required');
    const id = makeId('dly');
    db.prepare('INSERT INTO diary_entries(id, scope_id, text, mood, source, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, scopeId, value, mood, source, at);
    return { id, scopeId, text: value, mood, source, at };
  }

  function diaryList({ limit = 10 } = {}) {
    return db.prepare('SELECT * FROM diary_entries WHERE scope_id = ? ORDER BY at DESC LIMIT ?').all(scopeId, Math.max(1, Math.min(200, limit))).map((row) => ({
      id: row.id,
      text: row.text,
      mood: row.mood,
      source: row.source,
      at: row.at,
    }));
  }

  async function fetchWeb(pieces = []) {
    if (features?.webSearch !== true || typeof webSearch !== 'function' || pieces.length === 0) {
      return { text: '', sources: [] };
    }
    try {
      const result = await webSearch({
        query: pieces.slice(0, 3).join(' ').slice(0, 120),
        maxResults: 3,
      });
      const sources = Array.isArray(result?.sources) ? result.sources.slice(0, 3) : [];
      const text = sources.map((source, index) => {
        const title = String(source.title ?? '').slice(0, 120);
        const url = String(source.url ?? '').slice(0, 500);
        const snippet = String(source.snippet ?? source.summary ?? '').slice(0, 300);
        return `${index + 1}. ${title}\n   ${url}\n   ${snippet}`;
      }).filter(Boolean).join('\n');
      return { text, sources: sources.map((source) => ({ title: String(source.title ?? ''), url: String(source.url ?? '') })) };
    } catch {
      return { text: '', sources: [] };
    }
  }

  function withSources(text, sources = []) {
    const refs = sources
      .filter((source) => source?.url)
      .slice(0, 3)
      .map((source, index) => `${index + 1}. ${source.title ? `${source.title} · ` : ''}${source.url}`)
      .join('\n');
    return refs ? `${text}\n\n参考：\n${refs}` : text;
  }

  async function diaryGenerate({ at = Date.now(), maxSources = 6, source = null } = {}) {
    const since = new Date(at - 24 * 3600 * 1000).toISOString();
    const recent = traces.listSince(scopeId, since, { limit: 100 })
      .filter((trace) => trace.kind !== 'reflection')
      .sort((a, b) => Number(b.importance) - Number(a.importance))
      .slice(0, maxSources);
    const pieces = [...new Set(recent.map((trace) => sentence(trace.title || trace.content)))].slice(0, maxSources);
    const moodText = emotion?.text?.() ?? '';
    const web = await fetchWeb(pieces);
    let text = null;
    let model = 'template';
    if (diaryLlm && typeof diaryLlm === 'function') {
      let timer = null;
      try {
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 8000);
        });
        text = await Promise.race([
          diaryLlm({ pieces, emotions: moodText, web: web.text }),
          timeout,
        ]);
        if (text) model = 'llm';
      } catch {
        text = null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!text) {
      if (features?.aiOnlyLife === true) throw new Error('AI 日记生成失败：模型未返回内容；没有回退模板。');
      text = pieces.length
        ? `今天本鲸一直在想${pieces.slice(0, 3).join('，')}。有些话还没说完，先留在水里。`
        : '今天很安静，本鲸把没有说完的话留在水里。';
    }
    const entry = diaryWrite({
      text: withSources(text, web.sources),
      mood: model === 'llm' ? '本鲸写的' : '本鲸写的（模板）',
      source: source || (model === 'llm' ? 'cortex:llm' : 'cortex:template'),
      at: new Date(at).toISOString(),
    });
    return { ...entry, model, sourceCount: recent.length, webSources: web.sources };
  }

  async function feelingGenerate({ at = Date.now(), maxSources = 6, source = 'cortex:auto:feeling' } = {}) {
    const since = new Date(at - 24 * 3600 * 1000).toISOString();
    const recent = traces.listSince(scopeId, since, { limit: 100 })
      .filter((trace) => trace.kind !== 'reflection')
      .sort((a, b) => Number(b.importance) - Number(a.importance))
      .slice(0, maxSources);
    const pieces = [...new Set(recent.map((trace) => sentence(trace.title || trace.content)))].slice(0, maxSources);
    let result = null;
    let model = 'template';
    if (feelingLlm && typeof feelingLlm === 'function') {
      let timer = null;
      try {
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 6000);
        });
        result = await Promise.race([
          feelingLlm({ pieces, emotions: emotion?.text?.() ?? '' }),
          timeout,
        ]);
        if (result?.text) model = 'llm';
      } catch {
        result = null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!result?.text) {
      const base = pieces.length
        ? `本鲸现在想到${pieces.slice(0, 3).join('，')}，心里有一点安静，也有一点想继续往前走。`
        : '本鲸现在很安静，没有任务，也没有走开。';
      const detected = emotion?.detect?.(base)?.emotions ?? [];
      result = { text: base, emotions: detected.length ? detected : [{ name: '安', score: 1 }], target: '主人' };
    }
    if (!Array.isArray(result.emotions) || result.emotions.length === 0) {
      result.emotions = [{ name: '安', score: 1 }];
    }
    const recorded = emotion?.record({
      text: result.text,
      target: result.target || '主人',
      emotions: result.emotions,
      source,
      at: new Date(at).toISOString(),
    });
    return {
      text: result.text,
      emotions: result.emotions,
      target: result.target || '主人',
      model,
      sourceCount: recent.length,
      event: recorded?.event ?? null,
    };
  }

  function diaryForget(id) {
    return db.prepare('DELETE FROM diary_entries WHERE scope_id = ? AND id = ?').run(scopeId, id).changes > 0;
  }

  async function dreamGenerate({ at = Date.now(), maxSources = 5 } = {}) {
    const since = new Date(at - 7 * 86400000).toISOString();
    const recent = traces.listSince(scopeId, since, { limit: 200 })
      .filter((trace) => trace.kind !== 'reflection')
      .sort((a, b) => Number(b.importance) - Number(a.importance))
      .slice(0, maxSources);
    const web = await fetchWeb(recent.map((trace) => trace.title || sentence(trace.content)));
    let text;
    let model = 'template';
    let sourceCount = recent.length;
    if (recent.length === 0) {
      if (features?.aiOnlyLife === true) throw new Error('AI 梦生成失败：没有近期记忆；没有回退模板。');
      text = '梦里，一片很安静的海，没有写完的句子。';
    } else if (llm && typeof llm === 'function') {
      let timer = null;
      try {
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 4000);
        });
        const generated = await Promise.race([
          llm({
            pieces: recent.map((trace) => trace.title || sentence(trace.content)),
            emotions: emotion?.text?.() ?? '',
            web: web.text,
          }),
          timeout,
        ]);
        if (generated) {
          text = generated;
          model = 'llm';
        }
      } catch {
        text = null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!text) {
      if (features?.aiOnlyLife === true) throw new Error('AI 梦生成失败：模型未返回内容；没有回退模板。');
      const pieces = recent.length
        ? [...new Set(recent.map((trace) => sentence(trace.title || trace.content)))].slice(0, 5)
        : [];
      text = pieces.length
        ? `梦里，${pieces.join('，')}。醒来时只记得一点温度。`
        : '梦里，一片很安静的海，没有写完的句子。';
    }

    const storedText = withSources(text, web.sources);
    const atIso = new Date(at).toISOString();
    const windowStart = new Date(at - 5 * 1000).toISOString();
    const duplicate = db.prepare(
      'SELECT * FROM dreams WHERE scope_id = ? AND text = ? AND at >= ? ORDER BY at DESC LIMIT 1',
    ).get(scopeId, storedText, windowStart);
    if (duplicate) {
      return {
        id: duplicate.id,
        text: duplicate.text,
        sourceCount: Number(duplicate.source_count),
        model: duplicate.model,
        at: duplicate.at,
        webSources: web.sources,
      };
    }

    const id = makeId('drm');
    db.prepare('INSERT INTO dreams(id, scope_id, text, source_count, model, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, scopeId, storedText, sourceCount, model, atIso);
    return { id, text: storedText, sourceCount, model, at: atIso, webSources: web.sources };
  }

  function dreamList({ limit = 5 } = {}) {
    return db.prepare('SELECT * FROM dreams WHERE scope_id = ? ORDER BY at DESC LIMIT ?').all(scopeId, Math.max(1, Math.min(100, limit))).map((row) => ({
      id: row.id,
      text: row.text,
      sourceCount: Number(row.source_count),
      model: row.model,
      at: row.at,
    }));
  }

  async function sleep({ at = Date.now(), windowDays = 1 } = {}) {
    const purged = working?.purgeExpired({ scopeId, at }) ?? 0;
    let reflection = null;
    try {
      reflection = reflect?.reflect?.({ scopeId, windowDays, now: at }) ?? null;
    } catch {
      reflection = null;
    }
    let developmentReport = null;
    try {
      developmentReport = development?.evaluate?.({ scopeId, now: at }) ?? null;
    } catch {
      developmentReport = null;
    }
    let affect = null;
    try {
      affect = emotion?.recompute?.() ?? null;
    } catch {
      affect = null;
    }
    let consolidationRun = null;
    if (consolidation && features?.llm === true && features?.consolidateOnSleep !== false) {
      try {
        consolidationRun = await consolidation.run({ scopeId, now: at, limit: 10 });
      } catch {
        consolidationRun = null;
      }
    }
    const report = {
      at: new Date(at).toISOString(),
      purgedWorking: purged,
      reflected: reflection && !reflection.skipped ? 1 : 0,
      stage: developmentReport?.stage ?? null,
      affectTargets: affect?.length ?? 0,
      consolidation: consolidationRun?.run?.status ?? null,
      consolidated: consolidationRun?.applied?.length ?? 0,
    };
    const id = makeId('slp');
    db.prepare('INSERT INTO sleep_runs(id, scope_id, at, report_json) VALUES (?, ?, ?, ?)')
      .run(id, scopeId, report.at, JSON.stringify(report));
    return { id, scopeId, ...report };
  }

  function sleepRuns({ limit = 10 } = {}) {
    return db.prepare('SELECT * FROM sleep_runs WHERE scope_id = ? ORDER BY at DESC LIMIT ?').all(scopeId, Math.max(1, Math.min(100, limit))).map((row) => ({
      id: row.id,
      at: row.at,
      report: JSON.parse(row.report_json),
    }));
  }

  return { diaryWrite, diaryGenerate, diaryList, diaryForget, feelingGenerate, dreamGenerate, dreamList, sleep, sleepRuns };
}
