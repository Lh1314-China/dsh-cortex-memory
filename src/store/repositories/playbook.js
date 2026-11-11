import { makeId } from '../../core/ids.js';
import { nowIso } from '../../core/time.js';

function rowToRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags_json || '[]'),
    helpful: Number(row.helpful) || 0,
    harmful: Number(row.harmful) || 0,
    status: row.status,
    sourceTraceId: row.source_trace_id,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPlaybookRepository(db) {
  function add({ scopeId = 'global', title, body, tags = [], validFrom = nowIso(), validTo = null, status = 'active', sourceTraceId = null } = {}) {
    const cleanTitle = String(title ?? '').trim();
    const cleanBody = String(body ?? '').trim();
    if (!cleanTitle) throw new Error('playbook title is required');
    if (!cleanBody) throw new Error('playbook body is required');
    const id = makeId('pbr');
    const now = nowIso();
    db.prepare(`
      INSERT INTO playbook_rules(id, scope_id, title, body, tags_json, helpful, harmful, status, source_trace_id, valid_from, valid_to, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, cleanTitle, cleanBody, JSON.stringify(tags), status, sourceTraceId, validFrom, validTo, now, now);
    return get(id);
  }

  function get(id) {
    return rowToRule(db.prepare('SELECT * FROM playbook_rules WHERE id = ?').get(id));
  }

  function list({ scopeId = 'global', status = null, includeExpired = false, at = nowIso(), limit = 200 } = {}) {
    const params = [scopeId];
    let sql = 'SELECT * FROM playbook_rules WHERE scope_id = ?';
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (!includeExpired) { sql += ' AND (valid_to IS NULL OR valid_to > ?)'; params.push(at); }
    sql += ' ORDER BY (helpful - harmful) DESC, created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
    return db.prepare(sql).all(...params).map(rowToRule);
  }

  function active(scopeId = 'global', { at = nowIso(), limit = 50 } = {}) {
    return list({ scopeId, status: 'active', includeExpired: false, at, limit });
  }

  function vote(id, signal = 'helpful') {
    const rule = get(id);
    if (!rule) return null;
    const column = signal === 'harmful' ? 'harmful' : 'helpful';
    db.prepare(`UPDATE playbook_rules SET ${column} = ${column} + 1, updated_at = ? WHERE id = ?`).run(nowIso(), id);
    return get(id);
  }

  function retire(id) {
    const rule = get(id);
    if (!rule) return null;
    db.prepare("UPDATE playbook_rules SET status = 'retired', updated_at = ? WHERE id = ?").run(nowIso(), id);
    return get(id);
  }

  function approve(id) {
    const rule = get(id);
    if (!rule) return null;
    db.prepare("UPDATE playbook_rules SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), id);
    return get(id);
  }

  function setValidTo(id, validTo) {
    const rule = get(id);
    if (!rule) return null;
    db.prepare('UPDATE playbook_rules SET valid_to = ?, updated_at = ? WHERE id = ?').run(validTo, nowIso(), id);
    return get(id);
  }

  return { add, get, list, active, vote, retire, approve, setValidTo };
}
