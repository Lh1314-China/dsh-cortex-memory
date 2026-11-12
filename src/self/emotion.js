import { makeId } from '../core/ids.js';
import { clamp, nowIso } from '../core/time.js';
import { stableStringify } from '../core/json.js';

export const EMOTIONS = Object.freeze({
  喜: ['开心', '高兴', '快乐', '笑', '欢喜', '兴奋', '满足'],
  怒: ['生气', '愤怒', '恼火', '气死', '火大'],
  哀: ['难过', '伤心', '哭', '悲伤', '失落', '委屈', '低落'],
  惧: ['害怕', '恐惧', '担心', '不安', '紧张'],
  惊: ['惊讶', '震惊', '意外', '没想到'],
  厌: ['讨厌', '烦', '腻', '恶心', '不想'],
  爱: ['爱', '喜欢', '在乎', '珍惜', '宝贝', '心动'],
  恨: ['恨', '怨恨', '憎恶', '不可原谅'],
  愧: ['愧疚', '对不起', '抱歉', '自责', '内疚'],
  羞: ['害羞', '不好意思', '脸红', '羞'],
  妒: ['嫉妒', '吃醋', '羡慕'],
  傲: ['骄傲', '自豪', '得意', '棒'],
  怜: ['心疼', '可怜', '怜惜', '舍不得'],
  盼: ['期待', '希望', '盼', '想见', '等你'],
  安: ['安心', '放心', '踏实', '安稳', '安全'],
  焦: ['焦虑', '着急', '压力', '急'],
  疲: ['累', '疲惫', '困', '没力气', '撑不住'],
  暖: ['温暖', '暖', '贴心', '温柔', '被照顾'],
  孤: ['孤独', '孤单', '一个人', '寂寞'],
  敬: ['尊敬', '佩服', '敬意'],
  鄙: ['鄙视', '看不起', '瞧不起'],
  悔: ['后悔', '早知', '不该'],
  念: ['想念', '思念', '惦记', '怀念'],
  甜: ['甜', '幸福', '美好', '心里甜甜'],
});

function detectWithLexicon(text, lexicon) {
  const value = String(text ?? '');
  const scores = {};
  for (const [name, words] of Object.entries(lexicon)) {
    let score = 0;
    for (const word of words) if (word && value.includes(word)) score += 1;
    if (score > 0) scores[name] = score;
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([name, score]) => ({ name, score }));
}

export function createEmotionModel({ db, scopeId = 'global' } = {}) {
  if (!db) throw new Error('emotion model needs db');

  function detect(text) {
    const emotions = detectWithLexicon(text, EMOTIONS);
    return { text: String(text ?? ''), emotions, top: emotions[0]?.name ?? null };
  }

  function computeAttitude(scores) {
    const entries = Object.entries(scores ?? {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return null;
    if (entries.length === 1) return entries[0][0];
    return `又${entries[0][0]}又${entries[1][0]}`;
  }

  function record({ text, target = '用户', traceId = null, source = 'user', at = nowIso(), emotions = null } = {}) {
    const result = Array.isArray(emotions) && emotions.length
      ? { text: String(text ?? ''), emotions, top: emotions[0]?.name ?? null }
      : detect(text);
    if (result.emotions.length === 0) return { ...result, event: null, target: null };
    const id = makeId('emo');
    db.prepare(`
      INSERT INTO emotion_events(id, scope_id, trace_id, text, emotions_json, target, source, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, traceId, String(text ?? ''), stableStringify(result.emotions), target, source, at);
    const current = db.prepare('SELECT * FROM affect_targets WHERE scope_id = ? AND target = ?').get(scopeId, target);
    const scores = current ? JSON.parse(current.scores_json) : {};
    for (const emotion of result.emotions) scores[emotion.name] = (scores[emotion.name] ?? 0) + emotion.score;
    const attitude = computeAttitude(scores);
    db.prepare(`
      INSERT INTO affect_targets(scope_id, target, scores_json, count, attitude, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(scope_id, target) DO UPDATE SET
        scores_json = excluded.scores_json, count = affect_targets.count + 1,
        attitude = excluded.attitude, updated_at = excluded.updated_at
    `).run(scopeId, target, stableStringify(scores), attitude, at);
    return { ...result, event: { id, scopeId, target, emotions: result.emotions, at }, target: { name: target, attitude, scores, count: (current?.count ?? 0) + 1 } };
  }

  function targets() {
    return db.prepare('SELECT * FROM affect_targets WHERE scope_id = ? ORDER BY count DESC, updated_at DESC').all(scopeId).map((row) => ({
      target: row.target,
      scores: JSON.parse(row.scores_json),
      count: Number(row.count),
      attitude: row.attitude,
      updatedAt: row.updated_at,
    }));
  }

  function text() {
    const list = targets();
    return list.length ? list.slice(0, 3).map((item) => `${item.target}：${item.attitude ?? '未形成态度'}（${item.count} 次）`).join('；') : '（情感库还没有形成态度）';
  }

  function events({ limit = 20 } = {}) {
    return db.prepare('SELECT * FROM emotion_events WHERE scope_id = ? ORDER BY at DESC LIMIT ?').all(scopeId, Math.max(1, Math.min(200, limit))).map((row) => ({
      id: row.id,
      traceId: row.trace_id,
      text: row.text,
      emotions: JSON.parse(row.emotions_json),
      target: row.target,
      source: row.source,
      at: row.at,
    }));
  }

  function lexicon() {
    const counts = Object.fromEntries(Object.entries(EMOTIONS).map(([name, words]) => [name, words.length]));
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return { total, categories: Object.keys(counts).length, counts };
  }

  function recompute({ target = null } = {}) {
    const rows = target
      ? db.prepare('SELECT * FROM affect_targets WHERE scope_id = ? AND target = ?').all(scopeId, target)
      : db.prepare('SELECT * FROM affect_targets WHERE scope_id = ?').all(scopeId);
    for (const row of rows) {
      const scores = JSON.parse(row.scores_json);
      db.prepare('UPDATE affect_targets SET attitude = ?, updated_at = ? WHERE scope_id = ? AND target = ?')
        .run(computeAttitude(scores), nowIso(), scopeId, row.target);
    }
    return targets();
  }

  return { detect, record, targets, text, events, lexicon, recompute, EMOTIONS };
}
