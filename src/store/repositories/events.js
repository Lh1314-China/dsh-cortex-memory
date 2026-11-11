import { chainHash, eventId } from '../../core/ids.js';
import { stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';
import { CortexError, ERROR_CODES } from '../../core/errors.js';

function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    seq: Number(row.seq),
    at: row.at,
    kind: row.kind,
    actor: row.actor,
    scopeId: row.scope_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    operationId: row.operation_id,
    causationId: row.causation_id,
    payload: JSON.parse(row.payload_json),
    payloadJson: row.payload_json,
    hash: row.hash,
    prevHash: row.prev_hash,
  };
}

export function createEventRepository(db) {
  function append({
    kind,
    actor = 'system',
    scopeId = 'global',
    sessionId = null,
    turnId = null,
    operationId = null,
    causationId = null,
    payload = {},
    at = nowIso(),
  } = {}) {
    if (!kind) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'event kind is required');
    const payloadJson = stableStringify(payload ?? {});
    if (operationId) {
      const existing = db.prepare('SELECT * FROM events WHERE operation_id = ?').get(operationId);
      if (existing) {
        if (existing.payload_json !== payloadJson) {
          throw new CortexError(ERROR_CODES.CONFLICT, `operation ${operationId} already exists with a different payload`);
        }
        return rowToEvent(existing);
      }
    }
    const last = db.prepare('SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1').get();
    const seq = Number(last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? null;
    const hash = chainHash(prevHash, `${seq}\n${payloadJson}`);
    const id = eventId();
    db.prepare(`
      INSERT INTO events(id, seq, at, kind, actor, scope_id, session_id, turn_id,
                         operation_id, causation_id, payload_json, hash, prev_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, seq, at, kind, actor, scopeId, sessionId, turnId, operationId, causationId, payloadJson, hash, prevHash);
    return {
      id, seq, at, kind, actor, scopeId, sessionId, turnId,
      operationId, causationId, payload, payloadJson, hash, prevHash,
    };
  }

  function get(id) {
    return rowToEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(id));
  }

  function last(scopeId = null) {
    const row = scopeId
      ? db.prepare('SELECT * FROM events WHERE scope_id = ? ORDER BY seq DESC LIMIT 1').get(scopeId)
      : db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT 1').get();
    return rowToEvent(row);
  }

  function list({ scopeId = null, limit = 50, afterSeq = 0 } = {}) {
    const count = Math.max(1, Math.min(500, Number(limit) || 50));
    const rows = scopeId
      ? db.prepare('SELECT * FROM events WHERE scope_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?').all(scopeId, afterSeq, count)
      : db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?').all(afterSeq, count);
    return rows.map(rowToEvent);
  }

  function verifyChain(scopeId = null) {
    const rows = db.prepare('SELECT * FROM events ORDER BY seq ASC').all();
    const scopeCount = scopeId
      ? Number(db.prepare('SELECT COUNT(*) AS c FROM events WHERE scope_id = ?').get(scopeId)?.c ?? 0)
      : rows.length;
    let prevHash = null;
    let expectedSeq = 1;
    for (const row of rows) {
      if (Number(row.seq) !== expectedSeq) {
        return { ok: false, at: row.id, reason: `seq gap: expected ${expectedSeq}, got ${row.seq}` };
      }
      if ((row.prev_hash ?? null) !== prevHash) {
        return { ok: false, at: row.id, reason: 'prev_hash mismatch' };
      }
      const expectedHash = chainHash(prevHash, `${row.seq}\n${row.payload_json}`);
      if (expectedHash !== row.hash) {
        return { ok: false, at: row.id, reason: 'hash mismatch' };
      }
      prevHash = row.hash;
      expectedSeq += 1;
    }
    return { ok: true, count: scopeCount, head: prevHash };
  }

  function count(scopeId = null) {
    const row = scopeId
      ? db.prepare('SELECT COUNT(*) AS c FROM events WHERE scope_id = ?').get(scopeId)
      : db.prepare('SELECT COUNT(*) AS c FROM events').get();
    return Number(row?.c ?? 0);
  }

  return { append, get, last, list, verifyChain, count };
}
