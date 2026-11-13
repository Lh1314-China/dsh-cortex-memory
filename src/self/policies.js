import { policyId } from '../core/ids.js';
import { stableStringify } from '../core/json.js';
import { nowIso } from '../core/time.js';

function rowToPolicy(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    version: Number(row.version),
    config: JSON.parse(row.config_json),
    metrics: row.metrics_json ? JSON.parse(row.metrics_json) : null,
    status: row.status,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    canary: row.canary_json ? JSON.parse(row.canary_json) : null,
  };
}

export function createPolicyRepository(db) {
  function get(id) {
    return rowToPolicy(db.prepare('SELECT * FROM policies WHERE id = ?').get(id));
  }

  function list({ kind = null, status = null, limit = 50 } = {}) {
    const count = Math.max(1, Math.min(200, Number(limit) || 50));
    if (kind && status) return db.prepare('SELECT * FROM policies WHERE kind = ? AND status = ? ORDER BY version DESC LIMIT ?').all(kind, status, count).map(rowToPolicy);
    if (kind) return db.prepare('SELECT * FROM policies WHERE kind = ? ORDER BY version DESC LIMIT ?').all(kind, count).map(rowToPolicy);
    if (status) return db.prepare('SELECT * FROM policies WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, count).map(rowToPolicy);
    return db.prepare('SELECT * FROM policies ORDER BY created_at DESC LIMIT ?').all(count).map(rowToPolicy);
  }

  function active(kind) {
    return rowToPolicy(db.prepare("SELECT * FROM policies WHERE kind = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(kind));
  }

  function create({ kind, config = {}, metrics = null, rationale = '' } = {}) {
    if (!kind) throw new Error('policy kind is required');
    const latest = db.prepare('SELECT MAX(version) AS v FROM policies WHERE kind = ?').get(kind);
    const version = Number(latest?.v ?? 0) + 1;
    const id = policyId();
    db.prepare(`
      INSERT INTO policies(id, kind, version, config_json, metrics_json, status, created_at, activated_at)
      VALUES (?, ?, ?, ?, ?, 'candidate', ?, NULL)
    `).run(id, kind, version, stableStringify(config), metrics == null ? null : stableStringify(metrics), nowIso());
    const policy = get(id);
    return { ...policy, rationale };
  }

  function activate(id) {
    const target = get(id);
    if (!target) throw new Error(`policy not found: ${id}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE policies SET status = 'superseded' WHERE kind = ? AND status = 'active' AND id <> ?").run(target.kind, id);
      db.prepare("UPDATE policies SET status = 'active', activated_at = ? WHERE id = ?").run(nowIso(), id);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
    return get(id);
  }

  function rollback(kind, toId = null) {
    const activePolicy = active(kind);
    const candidates = list({ kind }).filter((policy) => policy.id !== activePolicy?.id && policy.status !== 'active');
    const target = toId ? get(toId) : candidates[0];
    if (!target) throw new Error(`no policy to roll back to for ${kind}`);
    return activate(target.id);
  }

  function deactivate(kind) {
    const current = active(kind);
    if (!current) return null;
    db.prepare("UPDATE policies SET status = 'candidate', activated_at = NULL, canary_json = NULL WHERE id = ?").run(current.id);
    return get(current.id);
  }

  function retire(id) {
    const target = get(id);
    if (!target) return null;
    db.prepare("UPDATE policies SET status = 'superseded', activated_at = NULL, canary_json = NULL WHERE id = ?").run(id);
    return get(id);
  }

  function setCanary(id, canary) {
    const policy = get(id);
    if (!policy) throw new Error(`policy not found: ${id}`);
    db.prepare('UPDATE policies SET canary_json = ? WHERE id = ?').run(canary == null ? null : stableStringify(canary), id);
    return get(id);
  }

  function listCanaries() {
    return db.prepare("SELECT * FROM policies WHERE status = 'active' AND canary_json IS NOT NULL ORDER BY activated_at DESC").all().map(rowToPolicy);
  }

  function updateMetrics(id, metrics) {
    const policy = get(id);
    if (!policy) throw new Error(`policy not found: ${id}`);
    db.prepare('UPDATE policies SET metrics_json = ? WHERE id = ?').run(stableStringify(metrics ?? null), id);
    return get(id);
  }

  return { get, list, active, create, activate, rollback, deactivate, retire, setCanary, listCanaries, updateMetrics };
}
