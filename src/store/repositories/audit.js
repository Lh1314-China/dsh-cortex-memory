import { auditId } from '../../core/ids.js';
import { stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';

export function createAuditRepository(db) {
  function record({ actor = 'system', action, targetType = null, targetId = null, detail = {} } = {}) {
    if (!action) throw new Error('audit action is required');
    const id = auditId();
    const at = nowIso();
    const detailJson = stableStringify(detail ?? {});
    db.prepare(`
      INSERT INTO audit(id, at, actor, action, target_type, target_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, at, actor, action, targetType, targetId, detailJson);
    return { id, at, actor, action, targetType, targetId, detail };
  }

  function list({ targetType = null, targetId = null, limit = 50 } = {}) {
    const count = Math.max(1, Math.min(500, Number(limit) || 50));
    const rows = targetType && targetId
      ? db.prepare('SELECT * FROM audit WHERE target_type = ? AND target_id = ? ORDER BY at DESC LIMIT ?').all(targetType, targetId, count)
      : db.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT ?').all(count);
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      actor: row.actor,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      detail: JSON.parse(row.detail_json),
    }));
  }

  return { record, list };
}
