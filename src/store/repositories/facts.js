import { factId, hashText } from '../../core/ids.js';
import { asJsonArray, stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';
import { CortexError, ERROR_CODES } from '../../core/errors.js';

function rowToFact(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    subjectId: row.subject_id,
    predicate: row.predicate,
    objectId: row.object_id,
    objectLiteral: row.object_literal,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    recordedAt: row.recorded_at,
    confidence: Number(row.confidence ?? 0.7),
    status: row.status,
    sourceEventId: row.source_event_id,
    invalidatedBy: row.invalidated_by,
    supersededAt: row.superseded_at ?? null,
    evidence: asJsonArray(row.evidence_json),
    hash: row.hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sameObject(fact, { objectId = null, objectLiteral = null }) {
  return (fact.objectId ?? null) === (objectId ?? null)
    && (fact.objectLiteral ?? null) === (objectLiteral ?? null);
}

function combineConfidence(a, b) {
  return Math.min(1, 1 - (1 - Number(a || 0)) * (1 - Number(b || 0)));
}

export function createFactRepository(db) {
  function get(id) {
    return rowToFact(db.prepare('SELECT * FROM facts WHERE id = ?').get(id));
  }

  function insertFact({
    scopeId, subjectId, predicate, objectId = null, objectLiteral = null,
    validFrom, validTo = null, recordedAt, confidence = 0.7,
    status = 'active', sourceEventId = null, evidence = [],
  }) {
    const now = nowIso();
    const id = factId();
    const hash = hashText(`${subjectId}|${predicate}|${objectId ?? ''}|${objectLiteral ?? ''}|${validFrom ?? ''}`);
    db.prepare(`
      INSERT INTO facts(
        id, scope_id, subject_id, predicate, object_id, object_literal,
        valid_from, valid_to, recorded_at, confidence, status,
        source_event_id, invalidated_by, superseded_at, evidence_json, hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, scopeId, subjectId, predicate, objectId, objectLiteral,
      validFrom, validTo, recordedAt, confidence, status,
      sourceEventId, null, null, stableStringify(evidence), hash, now, now,
    );
    return get(id);
  }

  function overlapping(scopeId, subjectId, predicate, at) {
    return db.prepare(`
      SELECT * FROM facts
      WHERE scope_id = ? AND subject_id = ? AND predicate = ?
        AND status IN ('active', 'disputed')
        AND (valid_to IS NULL OR valid_to > ?)
      ORDER BY valid_from ASC
    `).all(scopeId, subjectId, predicate, at).map(rowToFact);
  }

  function addEvidence(fact, entry) {
    const evidence = [...(fact.evidence ?? []), entry].slice(-32);
    const confidence = combineConfidence(fact.confidence, entry.confidence ?? 0.5);
    db.prepare('UPDATE facts SET confidence = ?, evidence_json = ?, updated_at = ? WHERE id = ?')
      .run(confidence, stableStringify(evidence), nowIso(), fact.id);
    return get(fact.id);
  }

  /**
   * Belief revision entry point. The caller is responsible for wrapping this in
   * a transaction when it also appends an event / audit row.
   */
  function resolve({
    scopeId = 'global',
    subjectId,
    predicate,
    objectId = null,
    objectLiteral = null,
    validFrom = nowIso(),
    validTo = null,
    recordedAt = nowIso(),
    confidence = 0.7,
    sourceEventId = null,
    evidence = [],
  } = {}) {
    if (!subjectId || !predicate) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'subjectId and predicate are required');
    if (!objectId && !objectLiteral) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'objectId or objectLiteral is required');
    const existing = overlapping(scopeId, subjectId, predicate, validFrom);
    if (existing.length === 0) {
      const fact = insertFact({
        scopeId, subjectId, predicate, objectId, objectLiteral, validFrom, validTo,
        recordedAt, confidence, status: 'active', sourceEventId, evidence,
      });
      return { action: 'created', fact, invalidated: [] };
    }
    const exact = existing.find((fact) => sameObject(fact, { objectId, objectLiteral }));
    if (exact) {
      const updated = addEvidence(exact, {
        eventId: sourceEventId,
        confidence,
        at: recordedAt,
      });
      return { action: 'corroborate', fact: updated, invalidated: [] };
    }
    const later = existing.filter((fact) => fact.validFrom <= validFrom).at(-1);
    if (later) {
      if (later.validFrom === validFrom) {
        // Same start, different object: keep both but mark them disputed and
        // record the dispute. A later reflection/verification can resolve it.
        const disputed = existing.map((fact) => {
          db.prepare("UPDATE facts SET status = 'disputed', updated_at = ? WHERE id = ?").run(nowIso(), fact.id);
          return { ...fact, status: 'disputed' };
        });
        const fact = insertFact({
          scopeId, subjectId, predicate, objectId, objectLiteral, validFrom, validTo,
          recordedAt, confidence, status: 'disputed', sourceEventId, evidence,
        });
        const dispute = createDispute({ scopeId, subjectId, predicate, factA: later.id, factB: fact.id });
        return { action: 'dispute', fact, invalidated: [], disputed, dispute };
      }
      db.prepare("UPDATE facts SET status = 'invalidated', valid_to = ?, invalidated_by = NULL, superseded_at = ?, updated_at = ? WHERE id = ?")
        .run(validFrom, recordedAt, nowIso(), later.id);
      const fact = insertFact({
        scopeId, subjectId, predicate, objectId, objectLiteral, validFrom, validTo,
        recordedAt, confidence, status: 'active', sourceEventId, evidence,
      });
      db.prepare('UPDATE facts SET invalidated_by = ? WHERE id = ?').run(fact.id, later.id);
      return { action: 'supersede', fact, invalidated: [{ ...later, status: 'invalidated', validTo: validFrom }] };
    }
    // New fact describes an earlier interval than the current one. Keep it as
    // a historical fact ending where the newer fact begins.
    const firstLater = existing[0];
    const boundedTo = validTo ?? firstLater?.validFrom ?? null;
    const fact = insertFact({
      scopeId, subjectId, predicate, objectId, objectLiteral, validFrom, validTo: boundedTo,
      recordedAt, confidence, status: 'active', sourceEventId, evidence,
    });
    return { action: 'backfill', fact, invalidated: [] };
  }

  function createDispute({ scopeId, subjectId, predicate, factA, factB }) {
    const id = `dsp_${hashText(`${factA}|${factB}`, 12)}`;
    const now = nowIso();
    db.prepare(`
      INSERT INTO disputes(id, scope_id, subject_id, predicate, fact_a, fact_b, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
      ON CONFLICT(id) DO UPDATE SET status = 'open'
    `).run(id, scopeId, subjectId, predicate, factA, factB, now);
    return { id, scopeId, subjectId, predicate, factA, factB, status: 'open', createdAt: now };
  }

  function queryAt({ scopeId = 'global', subjectId, predicate = null, at = nowIso(), includeDisputed = true } = {}) {
    const statuses = includeDisputed ? "('active','disputed','invalidated')" : "('active','invalidated')";
    const rows = predicate
      ? db.prepare(`
          SELECT * FROM facts
          WHERE scope_id = ? AND subject_id = ? AND predicate = ?
            AND status IN ${statuses}
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_to IS NULL OR valid_to > ?)
          ORDER BY valid_from DESC
        `).all(scopeId, subjectId, predicate, at, at)
      : db.prepare(`
          SELECT * FROM facts
          WHERE scope_id = ? AND subject_id = ?
            AND status IN ${statuses}
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_to IS NULL OR valid_to > ?)
          ORDER BY predicate ASC, valid_from DESC
        `).all(scopeId, subjectId, at, at);
    return rows.map(rowToFact);
  }

  function queryBeliefAt({ scopeId = 'global', subjectId, predicate = null, at = nowIso(), includeDisputed = true } = {}) {
    const statuses = includeDisputed ? "('active','disputed','invalidated')" : "('active','invalidated')";
    const rows = predicate
      ? db.prepare(`
          SELECT * FROM facts
          WHERE scope_id = ? AND subject_id = ? AND predicate = ?
            AND status IN ${statuses}
            AND recorded_at <= ?
            AND (superseded_at IS NULL OR superseded_at > ?)
          ORDER BY recorded_at DESC
        `).all(scopeId, subjectId, predicate, at, at)
      : db.prepare(`
          SELECT * FROM facts
          WHERE scope_id = ? AND subject_id = ?
            AND status IN ${statuses}
            AND recorded_at <= ?
            AND (superseded_at IS NULL OR superseded_at > ?)
          ORDER BY predicate ASC, recorded_at DESC
        `).all(scopeId, subjectId, at, at);
    return rows.map(rowToFact);
  }

  function list({ scopeId = 'global', subjectId = null, status = null, limit = 100 } = {}) {
    const count = Math.max(1, Math.min(10000, Number(limit) || 100));
    if (subjectId && status) {
      return db.prepare('SELECT * FROM facts WHERE scope_id = ? AND subject_id = ? AND status = ? ORDER BY valid_from DESC LIMIT ?').all(scopeId, subjectId, status, count).map(rowToFact);
    }
    if (subjectId) {
      return db.prepare('SELECT * FROM facts WHERE scope_id = ? AND subject_id = ? ORDER BY valid_from DESC LIMIT ?').all(scopeId, subjectId, count).map(rowToFact);
    }
    if (status) {
      return db.prepare('SELECT * FROM facts WHERE scope_id = ? AND status = ? ORDER BY valid_from DESC LIMIT ?').all(scopeId, status, count).map(rowToFact);
    }
    return db.prepare('SELECT * FROM facts WHERE scope_id = ? ORDER BY valid_from DESC LIMIT ?').all(scopeId, count).map(rowToFact);
  }

  function invalidate(id, { at = nowIso(), by = null } = {}) {
    db.prepare("UPDATE facts SET status = 'invalidated', valid_to = ?, invalidated_by = ?, superseded_at = ?, updated_at = ? WHERE id = ?")
      .run(at, by, nowIso(), nowIso(), id);
    return get(id);
  }

  function disputes({ scopeId = 'global', status = 'open', limit = 50 } = {}) {
    const count = Math.max(1, Math.min(200, Number(limit) || 50));
    return db.prepare('SELECT * FROM disputes WHERE scope_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?').all(scopeId, status, count)
      .map((row) => ({
        id: row.id,
        scopeId: row.scope_id,
        subjectId: row.subject_id,
        predicate: row.predicate,
        factA: row.fact_a,
        factB: row.fact_b,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolution: row.resolution,
      }));
  }

  return { get, resolve, queryAt, queryBeliefAt, list, invalidate, disputes, overlapping };
}
