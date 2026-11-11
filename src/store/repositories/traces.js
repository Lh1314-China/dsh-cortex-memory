import { hashText, traceId } from '../../core/ids.js';
import { asJsonArray, stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';
import { ftsText, buildMatchQuery } from '../../memory/tokenizer.js';
import { CortexError, ERROR_CODES } from '../../core/errors.js';

const COLUMNS = [
  'title', 'content', 'summary', 'keywords_json', 'tags_json', 'event_id',
  'session_id', 'turn_id', 'actor', 'source', 'valid_at', 'recorded_at',
  'last_access_at', 'access_count', 'importance', 'confidence', 'salience',
  'valence', 'arousal', 'sensitivity', 'state', 'compression', 'stability',
  'difficulty', 'retrievability', 'review_count', 'lapse_count',
  'last_review_at', 'hash', 'updated_at',
];

const FIELD_MAP = Object.freeze({
  title: 'title',
  content: 'content',
  summary: 'summary',
  kind: 'kind',
  keywords: 'keywords_json',
  tags: 'tags_json',
  eventId: 'event_id',
  sessionId: 'session_id',
  turnId: 'turn_id',
  actor: 'actor',
  source: 'source',
  validAt: 'valid_at',
  recordedAt: 'recorded_at',
  lastAccessAt: 'last_access_at',
  accessCount: 'access_count',
  importance: 'importance',
  confidence: 'confidence',
  salience: 'salience',
  valence: 'valence',
  arousal: 'arousal',
  sensitivity: 'sensitivity',
  state: 'state',
  compression: 'compression',
  stability: 'stability',
  difficulty: 'difficulty',
  retrievability: 'retrievability',
  reviewCount: 'review_count',
  lapseCount: 'lapse_count',
  lastReviewAt: 'last_review_at',
  hash: 'hash',
});

function rowToTrace(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    summary: row.summary,
    keywords: asJsonArray(row.keywords_json),
    tags: asJsonArray(row.tags_json),
    eventId: row.event_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    actor: row.actor,
    source: row.source,
    validAt: row.valid_at,
    recordedAt: row.recorded_at,
    lastAccessAt: row.last_access_at,
    accessCount: Number(row.access_count ?? 0),
    importance: Number(row.importance ?? 0.5),
    confidence: Number(row.confidence ?? 0.7),
    salience: Number(row.salience ?? 0.5),
    valence: Number(row.valence ?? 0),
    arousal: Number(row.arousal ?? 0),
    sensitivity: row.sensitivity,
    state: row.state,
    compression: row.compression,
    stability: Number(row.stability ?? 1),
    difficulty: Number(row.difficulty ?? 5),
    retrievability: Number(row.retrievability ?? 1),
    reviewCount: Number(row.review_count ?? 0),
    lapseCount: Number(row.lapse_count ?? 0),
    lastReviewAt: row.last_review_at,
    hash: row.hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTraceRepository(db) {
  function syncFts(trace) {
    db.prepare('DELETE FROM traces_fts_index WHERE trace_id = ?').run(trace.id);
    const text = ftsText(`${trace.title ?? ''} ${trace.content ?? ''} ${trace.summary ?? ''}`);
    if (text) {
      db.prepare('INSERT INTO traces_fts_index(trace_id, text) VALUES (?, ?)').run(trace.id, text);
    }
  }

  function insert(input = {}) {
    const content = String(input.content ?? '').trim();
    if (!content) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'trace content is required');
    if (!input.eventId) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'trace eventId is required');
    const now = nowIso();
    const id = input.id || traceId();
    const trace = {
      id,
      scopeId: input.scopeId || 'global',
      kind: input.kind || 'observation',
      title: input.title ?? null,
      content,
      summary: input.summary ?? null,
      keywords: asJsonArray(input.keywords),
      tags: asJsonArray(input.tags),
      eventId: input.eventId,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId ?? null,
      actor: input.actor ?? 'user',
      source: input.source ?? null,
      validAt: input.validAt ?? input.recordedAt ?? now,
      recordedAt: input.recordedAt ?? now,
      lastAccessAt: input.lastAccessAt ?? null,
      accessCount: Number(input.accessCount ?? 0),
      importance: Number(input.importance ?? 0.5),
      confidence: Number(input.confidence ?? 0.7),
      salience: Number(input.salience ?? 0.5),
      valence: Number(input.valence ?? 0),
      arousal: Number(input.arousal ?? 0),
      sensitivity: input.sensitivity ?? 'personal',
      state: input.state ?? 'active',
      compression: input.compression ?? 'raw',
      stability: Number(input.stability ?? 1),
      difficulty: Number(input.difficulty ?? 5),
      retrievability: Number(input.retrievability ?? 1),
      reviewCount: Number(input.reviewCount ?? 0),
      lapseCount: Number(input.lapseCount ?? 0),
      lastReviewAt: input.lastReviewAt ?? null,
      hash: input.hash ?? hashText(content),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    db.prepare(`
      INSERT INTO traces(
        id, scope_id, kind, title, content, summary, keywords_json, tags_json,
        event_id, session_id, turn_id, actor, source, valid_at, recorded_at,
        last_access_at, access_count, importance, confidence, salience, valence,
        arousal, sensitivity, state, compression, stability, difficulty,
        retrievability, review_count, lapse_count, last_review_at, hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trace.id, trace.scopeId, trace.kind, trace.title, trace.content, trace.summary,
      stableStringify(trace.keywords), stableStringify(trace.tags), trace.eventId,
      trace.sessionId, trace.turnId, trace.actor, trace.source, trace.validAt,
      trace.recordedAt, trace.lastAccessAt, trace.accessCount, trace.importance,
      trace.confidence, trace.salience, trace.valence, trace.arousal,
      trace.sensitivity, trace.state, trace.compression, trace.stability,
      trace.difficulty, trace.retrievability, trace.reviewCount, trace.lapseCount,
      trace.lastReviewAt, trace.hash, trace.createdAt, trace.updatedAt,
    );
    syncFts(trace);
    return trace;
  }

  function get(id) {
    return rowToTrace(db.prepare('SELECT * FROM traces WHERE id = ?').get(id));
  }

  function findByEvent(eventId) {
    return rowToTrace(db.prepare('SELECT * FROM traces WHERE event_id = ? ORDER BY recorded_at ASC LIMIT 1').get(eventId));
  }

  function findByHash(scopeId, hash) {
    return rowToTrace(db.prepare('SELECT * FROM traces WHERE scope_id = ? AND hash = ? ORDER BY recorded_at ASC LIMIT 1').get(scopeId, hash));
  }

  function list({ scopeId = 'global', state = null, limit = 50, offset = 0 } = {}) {
    const count = Math.max(1, Math.min(10000, Number(limit) || 50));
    const skip = Math.max(0, Number(offset) || 0);
    const rows = state
      ? db.prepare('SELECT * FROM traces WHERE scope_id = ? AND state = ? ORDER BY recorded_at DESC LIMIT ? OFFSET ?').all(scopeId, state, count, skip)
      : db.prepare('SELECT * FROM traces WHERE scope_id = ? ORDER BY recorded_at DESC LIMIT ? OFFSET ?').all(scopeId, count, skip);
    return rows.map(rowToTrace);
  }

  function listSince(scopeId, sinceIso, { limit = 200, state = 'active' } = {}) {
    const count = Math.max(1, Math.min(1000, Number(limit) || 200));
    const rows = state
      ? db.prepare('SELECT * FROM traces WHERE scope_id = ? AND state = ? AND recorded_at >= ? ORDER BY recorded_at ASC LIMIT ?').all(scopeId, state, sinceIso, count)
      : db.prepare('SELECT * FROM traces WHERE scope_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC LIMIT ?').all(scopeId, sinceIso, count);
    return rows.map(rowToTrace);
  }

  function update(id, patch = {}) {
    const current = get(id);
    if (!current) throw new CortexError(ERROR_CODES.NOT_FOUND, `trace not found: ${id}`);
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(FIELD_MAP)) {
      if (!(key in patch)) continue;
      let value = patch[key];
      if (key === 'keywords' || key === 'tags') value = stableStringify(asJsonArray(value));
      sets.push(`${column} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return current;
    sets.push('updated_at = ?');
    values.push(nowIso());
    values.push(id);
    db.prepare(`UPDATE traces SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    const next = get(id);
    if ('title' in patch || 'content' in patch || 'summary' in patch) syncFts(next);
    return next;
  }

  function touch(id, at = nowIso()) {
    db.prepare('UPDATE traces SET last_access_at = ?, access_count = access_count + 1, updated_at = ? WHERE id = ?').run(at, at, id);
    return get(id);
  }

  function remove(id) {
    db.prepare('DELETE FROM traces_fts_index WHERE trace_id = ?').run(id);
    const result = db.prepare('DELETE FROM traces WHERE id = ?').run(id);
    return result.changes > 0;
  }

  function searchFts(query, { scopeId = 'global', limit = 30, includeArchived = false } = {}) {
    const match = buildMatchQuery(query);
    if (!match) return [];
    const count = Math.max(1, Math.min(200, Number(limit) || 30));
    const stateClause = includeArchived ? "t.state IN ('active','archived')" : "t.state = 'active'";
    const rows = db.prepare(`
      SELECT t.*, bm25(traces_fts_index) AS fts_rank
      FROM traces_fts_index
      JOIN traces t ON t.id = traces_fts_index.trace_id
      WHERE traces_fts_index MATCH ?
        AND t.scope_id = ?
        AND ${stateClause}
      ORDER BY fts_rank ASC
      LIMIT ?
    `).all(match, scopeId, count);
    return rows.map((row) => ({ ...rowToTrace(row), ftsRank: Number(row.fts_rank ?? 0) }));
  }

  function count({ scopeId = null, state = null } = {}) {
    if (scopeId && state) return Number(db.prepare('SELECT COUNT(*) AS c FROM traces WHERE scope_id = ? AND state = ?').get(scopeId, state).c);
    if (scopeId) return Number(db.prepare('SELECT COUNT(*) AS c FROM traces WHERE scope_id = ?').get(scopeId).c);
    return Number(db.prepare('SELECT COUNT(*) AS c FROM traces').get().c);
  }

  function ftsCount() {
    return Number(db.prepare('SELECT COUNT(*) AS c FROM traces_fts_index').get().c);
  }

  function reindexFts() {
    db.exec('DELETE FROM traces_fts_index');
    const rows = db.prepare('SELECT id, title, content, summary FROM traces').all();
    for (const row of rows) syncFts({ id: row.id, title: row.title, content: row.content, summary: row.summary });
    return rows.length;
  }

  function duplicateHashes(scopeId = 'global', { limit = 20 } = {}) {
    return db.prepare(`
      SELECT hash, COUNT(*) AS c FROM traces WHERE scope_id = ? GROUP BY hash HAVING c > 1 LIMIT ?
    `).all(scopeId, Math.max(1, Math.min(100, limit))).map((row) => ({ hash: row.hash, count: Number(row.c) }));
  }

  return { insert, get, findByEvent, findByHash, list, listSince, update, touch, remove, searchFts, count, ftsCount, reindexFts, duplicateHashes };
}
