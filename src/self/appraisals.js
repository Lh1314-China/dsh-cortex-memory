import { makeId } from '../core/ids.js';
import { stableStringify } from '../core/json.js';
import { nowIso } from '../core/time.js';

export function createAppraisalStore(db) {
  function record(scopeId, appraisal, { eventId = null, traceId = null, at = nowIso() } = {}) {
    const id = makeId('apr');
    db.prepare(`
      INSERT INTO appraisals(
        id, scope_id, event_id, trace_id, relevance, novelty, threat, opportunity,
        valence, arousal, identity_relevance, drive_deltas_json, relationship_json,
        confidence, evidence_json, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, scopeId, eventId, traceId,
      Number(appraisal.relevance ?? 0), Number(appraisal.novelty ?? 0),
      Number(appraisal.threat ?? 0), Number(appraisal.opportunity ?? 0),
      Number(appraisal.valence ?? 0), Number(appraisal.arousal ?? 0),
      Number(appraisal.identityRelevance ?? 0),
      stableStringify(appraisal.driveDeltas ?? {}),
      stableStringify(appraisal.relationship ?? {}),
      Number(appraisal.confidence ?? 0.6),
      stableStringify(appraisal.evidence ?? []),
      at,
    );
    return get(id);
  }

  function get(id) {
    const row = db.prepare('SELECT * FROM appraisals WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      scopeId: row.scope_id,
      eventId: row.event_id,
      traceId: row.trace_id,
      relevance: Number(row.relevance),
      novelty: Number(row.novelty),
      threat: Number(row.threat),
      opportunity: Number(row.opportunity),
      valence: Number(row.valence),
      arousal: Number(row.arousal),
      identityRelevance: Number(row.identity_relevance),
      driveDeltas: JSON.parse(row.drive_deltas_json),
      relationship: JSON.parse(row.relationship_json),
      confidence: Number(row.confidence),
      evidence: JSON.parse(row.evidence_json),
      at: row.at,
    };
  }

  function list(scopeId = 'global', { limit = 20 } = {}) {
    const count = Math.max(1, Math.min(200, Number(limit) || 20));
    return db.prepare('SELECT * FROM appraisals WHERE scope_id = ? ORDER BY at DESC LIMIT ?')
      .all(scopeId, count).map((row) => get(row.id));
  }

  return { record, get, list };
}
