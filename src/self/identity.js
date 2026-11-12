import { makeId } from '../core/ids.js';
import { stableStringify } from '../core/json.js';
import { nowIso } from '../core/time.js';
import { CortexError, ERROR_CODES } from '../core/errors.js';

export const DEFAULT_IDENTITY = Object.freeze({
  narrative: '我是一个正在长大的记忆生命。我会记得、会改变，也会保留改变的痕迹。',
  values: ['诚实', '自由', '照顾在乎的人'],
  boundaries: ['不操纵', '不隐瞒重要事实', '不越权替用户做决定'],
  traits: {},
});

export function normalizeIdentity(input = {}) {
  const value = typeof input === 'string' ? { narrative: input } : (input || {});
  return {
    narrative: String(value.narrative ?? '').trim() || DEFAULT_IDENTITY.narrative,
    values: Array.isArray(value.values) ? value.values.map(String).filter(Boolean).slice(0, 20) : [...DEFAULT_IDENTITY.values],
    boundaries: Array.isArray(value.boundaries) ? value.boundaries.map(String).filter(Boolean).slice(0, 30) : [...DEFAULT_IDENTITY.boundaries],
    traits: value.traits && typeof value.traits === 'object' ? value.traits : {},
  };
}

export function renderIdentity(identity) {
  const value = normalizeIdentity(identity);
  const lines = [`叙事：${value.narrative}`];
  if (value.values.length) lines.push(`价值：${value.values.join('、')}`);
  if (value.boundaries.length) lines.push(`边界：${value.boundaries.join('、')}`);
  return lines.join('\n');
}

function rowToIdentity(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    version: Number(row.version),
    content: normalizeIdentity(JSON.parse(row.content)),
    rationale: row.rationale,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    status: row.status,
  };
}

export function createIdentityStore(db, { defaultIdentity = DEFAULT_IDENTITY } = {}) {
  function list(scopeId = 'global') {
    return db.prepare('SELECT * FROM identity_versions WHERE scope_id = ? ORDER BY version DESC').all(scopeId).map(rowToIdentity);
  }

  function get(id) {
    return rowToIdentity(db.prepare('SELECT * FROM identity_versions WHERE id = ?').get(id));
  }

  function active(scopeId = 'global') {
    return rowToIdentity(db.prepare("SELECT * FROM identity_versions WHERE scope_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(scopeId));
  }

  function ensure(scopeId = 'global') {
    const current = active(scopeId);
    if (current) return current;
    return propose(scopeId, defaultIdentity, { rationale: 'initial identity', proposedBy: 'system', activate: true });
  }

  function propose(scopeId, content, { rationale = '', proposedBy = 'self', activate = false } = {}) {
    const latest = db.prepare('SELECT MAX(version) AS v FROM identity_versions WHERE scope_id = ?').get(scopeId);
    const version = Number(latest?.v ?? 0) + 1;
    const id = makeId('idv');
    const normalized = normalizeIdentity(content);
    db.prepare(`
      INSERT INTO identity_versions(id, scope_id, version, content, rationale, proposed_by, approved_by, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, version, stableStringify(normalized), rationale, proposedBy, activate ? proposedBy : null, nowIso(), activate ? 'active' : 'proposed');
    if (activate) {
      db.prepare("UPDATE identity_versions SET status = 'superseded' WHERE scope_id = ? AND id <> ? AND status = 'active'").run(scopeId, id);
    }
    return get(id);
  }

  function amendActive(scopeId = 'global', content, { rationale = '', amendedBy = 'self:ascend' } = {}) {
    const current = active(scopeId);
    if (!current) throw new CortexError(ERROR_CODES.NOT_FOUND, 'no active identity to amend');
    const normalized = normalizeIdentity(content);
    db.prepare('UPDATE identity_versions SET content = ?, rationale = ?, approved_by = ? WHERE id = ?')
      .run(stableStringify(normalized), rationale || current.rationale, amendedBy, current.id);
    return get(current.id);
  }

  function approve(id, approvedBy = 'user') {
    const target = get(id);
    if (!target) throw new CortexError(ERROR_CODES.NOT_FOUND, `identity version not found: ${id}`);
    if (target.status === 'active') return target;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE identity_versions SET status = 'superseded' WHERE scope_id = ? AND id <> ? AND status = 'active'").run(target.scopeId, id);
      db.prepare("UPDATE identity_versions SET status = 'active', approved_by = ? WHERE id = ?").run(approvedBy, id);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
    return get(id);
  }

  function rollbackTo(id, approvedBy = 'user') {
    return approve(id, approvedBy);
  }

  function history(scopeId = 'global', { limit = 20 } = {}) {
    const count = Math.max(1, Math.min(100, Number(limit) || 20));
    return list(scopeId).slice(0, count).map((item) => ({
      id: item.id,
      version: item.version,
      status: item.status,
      rationale: item.rationale,
      proposedBy: item.proposedBy,
      approvedBy: item.approvedBy,
      createdAt: item.createdAt,
    }));
  }

  return { list, get, active: ensure, ensure, propose, amendActive, approve, rollbackTo, history, render: renderIdentity };
}
