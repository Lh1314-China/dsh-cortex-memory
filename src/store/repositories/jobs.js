import { jobId } from '../../core/ids.js';
import { stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    kind: row.kind,
    status: row.status,
    operationId: row.operation_id,
    payload: JSON.parse(row.payload_json),
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: row.run_after,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function createJobRepository(db) {
  function get(id) {
    return rowToJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
  }

  function enqueue({ kind, payload = {}, scopeId = 'global', operationId = null, runAfter = null, maxAttempts = 3 } = {}) {
    if (!kind) throw new Error('job kind is required');
    if (operationId) {
      const existing = db.prepare('SELECT * FROM jobs WHERE operation_id = ?').get(operationId);
      if (existing) {
        if (existing.kind !== kind) throw new Error(`operation ${operationId} already exists with kind ${existing.kind}`);
        return rowToJob(existing);
      }
    }
    const id = jobId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO jobs(id, scope_id, kind, status, operation_id, payload_json, result_json, error,
                       attempts, max_attempts, run_after, created_at, started_at, finished_at)
      VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, 0, ?, ?, ?, NULL, NULL)
    `).run(id, scopeId, kind, operationId, stableStringify(payload), Math.max(1, Number(maxAttempts) || 3), runAfter ?? now, now);
    return get(id);
  }

  function claimNext({ now = Date.now(), kinds = null } = {}) {
    const at = new Date(now).toISOString();
    const rows = kinds && kinds.length
      ? db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_after <= ? AND kind IN (" + kinds.map(() => '?').join(',') + ') ORDER BY created_at ASC LIMIT 1').all(at, ...kinds)
      : db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_after <= ? ORDER BY created_at ASC LIMIT 1").all(at);
    const row = rows[0];
    if (!row) return null;
    db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ?").run(at, row.id);
    return get(row.id);
  }

  function complete(id, result = null) {
    db.prepare("UPDATE jobs SET status = 'done', result_json = ?, error = NULL, finished_at = ? WHERE id = ?")
      .run(result == null ? null : stableStringify(result), nowIso(), id);
    return get(id);
  }

  function fail(id, error, { now = Date.now(), retryAfterMs = 30_000 } = {}) {
    const job = get(id);
    if (!job) throw new Error(`job not found: ${id}`);
    if (job.attempts < job.maxAttempts) {
      const runAfter = new Date(now + Math.max(0, retryAfterMs)).toISOString();
      db.prepare("UPDATE jobs SET status = 'pending', error = ?, run_after = ?, started_at = NULL WHERE id = ?")
        .run(String(error ?? 'failed'), runAfter, id);
    } else {
      db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?")
        .run(String(error ?? 'failed'), nowIso(), id);
    }
    return get(id);
  }

  function list({ status = null, limit = 50 } = {}) {
    const count = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = status
      ? db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, count)
      : db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(count);
    return rows.map(rowToJob);
  }

  function counts() {
    const rows = db.prepare('SELECT status, COUNT(*) AS c FROM jobs GROUP BY status').all();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.c)]));
  }

  return { get, enqueue, claimNext, complete, fail, list, counts };
}
