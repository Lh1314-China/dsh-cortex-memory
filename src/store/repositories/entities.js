import { entityId, hashText } from '../../core/ids.js';
import { asJsonArray, stableStringify } from '../../core/json.js';
import { nowIso } from '../../core/time.js';
import { CortexError, ERROR_CODES } from '../../core/errors.js';

export function canonicalName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowToEntity(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    type: row.type,
    name: row.name,
    canonical: row.canonical,
    aliases: asJsonArray(row.aliases_json),
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createEntityRepository(db) {
  function get(id) {
    return rowToEntity(db.prepare('SELECT * FROM entities WHERE id = ?').get(id));
  }

  function findByName(scopeId, name) {
    const canonical = canonicalName(name);
    return rowToEntity(db.prepare('SELECT * FROM entities WHERE scope_id = ? AND canonical = ?').get(scopeId, canonical));
  }

  function upsert({ scopeId = 'global', type = 'concept', name, aliases = [], summary = null } = {}) {
    const clean = String(name ?? '').trim();
    if (!clean) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'entity name is required');
    const canonical = canonicalName(clean);
    const existing = findByName(scopeId, clean);
    const now = nowIso();
    if (existing) {
      const mergedAliases = [...new Set([...(existing.aliases ?? []), ...asJsonArray(aliases)])].slice(0, 32);
      const nextSummary = summary ?? existing.summary;
      db.prepare('UPDATE entities SET aliases_json = ?, summary = ?, updated_at = ? WHERE id = ?')
        .run(stableStringify(mergedAliases), nextSummary, now, existing.id);
      return { ...existing, aliases: mergedAliases, summary: nextSummary, updatedAt: now, action: 'merged' };
    }
    const id = entityId();
    db.prepare(`
      INSERT INTO entities(id, scope_id, type, name, canonical, aliases_json, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, type, clean, canonical, stableStringify(asJsonArray(aliases)), summary, now, now);
    return { id, scopeId, type, name: clean, canonical, aliases: asJsonArray(aliases), summary, createdAt: now, updatedAt: now, action: 'created' };
  }

  function list({ scopeId = 'global', limit = 100, offset = 0 } = {}) {
    const count = Math.max(1, Math.min(10000, Number(limit) || 100));
    const skip = Math.max(0, Number(offset) || 0);
    return db.prepare('SELECT * FROM entities WHERE scope_id = ? ORDER BY name ASC LIMIT ? OFFSET ?')
      .all(scopeId, count, skip).map(rowToEntity);
  }

  function search(scopeId, query, { limit = 20 } = {}) {
    const value = `%${String(query ?? '').trim().toLowerCase()}%`;
    if (value === '%%') return [];
    const count = Math.max(1, Math.min(100, Number(limit) || 20));
    return db.prepare('SELECT * FROM entities WHERE scope_id = ? AND (canonical LIKE ? OR name LIKE ?) ORDER BY name ASC LIMIT ?')
      .all(scopeId, value, value, count).map(rowToEntity);
  }

  return { get, findByName, upsert, list, search };
}
