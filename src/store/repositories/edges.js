import { edgeId } from '../../core/ids.js';
import { stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';

function rowToEdge(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    fromId: row.from_id,
    toId: row.to_id,
    rel: row.rel,
    weight: Number(row.weight),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    metadata: JSON.parse(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createEdgeRepository(db) {
  function get(id) {
    return rowToEdge(db.prepare('SELECT * FROM edges WHERE id = ?').get(id));
  }

  function upsert({ scopeId = 'global', fromId, toId, rel = 'related', weight = 1, validFrom = nowIso(), validTo = null, metadata = {} } = {}) {
    if (!fromId || !toId) throw new Error('edge needs fromId and toId');
    const existing = db.prepare(`
      SELECT * FROM edges WHERE scope_id = ? AND from_id = ? AND to_id = ? AND rel = ? AND (valid_to IS NULL OR valid_to > ?)
      ORDER BY valid_from DESC LIMIT 1
    `).get(scopeId, fromId, toId, rel, validFrom);
    if (existing) {
      db.prepare('UPDATE edges SET weight = ?, metadata_json = ?, updated_at = ? WHERE id = ?')
        .run(Number(weight), stableStringify(metadata), nowIso(), existing.id);
      return get(existing.id);
    }
    const id = edgeId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO edges(id, scope_id, from_id, to_id, rel, weight, valid_from, valid_to, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, fromId, toId, rel, Number(weight), validFrom, validTo, stableStringify(metadata), now, now);
    return get(id);
  }

  function neighbors(id, { scopeId = 'global', at = nowIso(), direction = 'both', limit = 200 } = {}) {
    const count = Math.max(1, Math.min(10000, Number(limit) || 200));
    const atValue = at;
    let rows = [];
    if (direction === 'out' || direction === 'both') {
      rows = rows.concat(db.prepare(`
        SELECT * FROM edges WHERE scope_id = ? AND from_id = ?
          AND (valid_from IS NULL OR valid_from <= ?)
          AND (valid_to IS NULL OR valid_to > ?)
        LIMIT ?
      `).all(scopeId, id, atValue, atValue, count));
    }
    if (direction === 'in' || direction === 'both') {
      rows = rows.concat(db.prepare(`
        SELECT * FROM edges WHERE scope_id = ? AND to_id = ?
          AND (valid_from IS NULL OR valid_from <= ?)
          AND (valid_to IS NULL OR valid_to > ?)
        LIMIT ?
      `).all(scopeId, id, atValue, atValue, count));
    }
    const seen = new Set();
    return rows.map(rowToEdge).filter((edge) => {
      if (seen.has(edge.id)) return false;
      seen.add(edge.id);
      return true;
    });
  }

  function list({ scopeId = 'global', limit = 200 } = {}) {
    const count = Math.max(1, Math.min(10000, Number(limit) || 200));
    return db.prepare('SELECT * FROM edges WHERE scope_id = ? ORDER BY updated_at DESC LIMIT ?').all(scopeId, count).map(rowToEdge);
  }

  function invalidate(id, { at = nowIso() } = {}) {
    db.prepare('UPDATE edges SET valid_to = ?, updated_at = ? WHERE id = ?').run(at, nowIso(), id);
    return get(id);
  }

  return { get, upsert, neighbors, list, invalidate };
}
