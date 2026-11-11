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

  function diaryForget(id) {
    return db.prepare('DELETE FROM diary_entries WHERE scope_id = ? AND id = ?').run(scopeId, id).changes > 0;
  }

  async function dreamGenerate({ at = Date.now(), maxSources = 5 } = {}) {
    const since = new Date(at - 7 * 86400000).toISOString();
    const recent = traces.listSince(scopeId, since, { limit: 200 })
      .filter((trace) => trace.kind !== 'reflection')
      .sort((a, b) => Number(b.importance) - Number(a.importance))
      .slice(0, maxSources);
    if (recent.length === 0) {
      const text = '梦里，一片很安静的海，没有写完的句子。';
      const id = makeId('drm');
      db.prepare('INSERT INTO dreams(id, scope_id, text, source_count, model, at) VALUES (?, ?, ?, 0, ?, ?)')
        .run(id, scopeId, text, 'template', new Date(at).toISOString());
      return { id, text, sourceCount: 0, model: 'template', at: new Date(at).toISOString() };
    }
    let text = null;
    let model = 'template';
    if (llm && typeof llm === 'function') {
      try {
        text = await llm({
          pieces: recent.map((trace) => trace.title || sentence(trace.content)),
          emotions: emotion?.text?.() ?? '',
        });
        if (text) model = 'llm';
      } catch {
        text = null;
      }
    }
    if (!text) {
      const pieces = [...new Set(recent.map((trace) => sentence(trace.title || trace.content)))].slice(0, 5);
      text = `梦里，${pieces.join('，')}。醒来时只记得一点温度。`;
    }
    const id = makeId('drm');
    const atIso = new Date(at).toISOString();
    db.prepare('INSERT INTO dreams(id, scope_id, text, source_count, model, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, scopeId, text, recent.length, model, atIso);
    return { id, text, sourceCount: recent.length, model, at: atIso };
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

  return { diaryWrite, diaryList, diaryForget, dreamGenerate, dreamList, sleep, sleepRuns };
}
