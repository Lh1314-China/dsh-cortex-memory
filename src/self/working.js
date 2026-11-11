import { makeId } from '../core/ids.js';
import { clamp, nowIso } from '../core/time.js';
import { estimateTokens, truncate } from '../memory/tokenizer.js';

function rowToWorking(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    kind: row.kind,
    text: row.text,
    priority: Number(row.priority),
    pinned: Number(row.pinned) === 1,
    sourceTraceId: row.source_trace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export function createWorkingStore(db) {
  function add({ scopeId = 'global', kind = 'focus', text, priority = 0.5, pinned = false, sourceTraceId = null, ttlMs = null, at = Date.now() } = {}) {
    const value = String(text ?? '').trim();
    if (!value) throw new Error('working item text is required');
    const id = makeId('wrk');
    const now = nowIso(at);
    const expiresAt = ttlMs ? new Date(at + Math.max(0, Number(ttlMs))).toISOString() : null;
    db.prepare(`
      INSERT INTO working_items(id, scope_id, kind, text, priority, pinned, source_trace_id, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scopeId, kind, value, clamp(priority, 0, 1), pinned ? 1 : 0, sourceTraceId, now, now, expiresAt);
    return get(id);
  }

  function get(id) {
    return rowToWorking(db.prepare('SELECT * FROM working_items WHERE id = ?').get(id));
  }

  function list({ scopeId = 'global', includeExpired = false, limit = 50, at = Date.now() } = {}) {
    const count = Math.max(1, Math.min(200, Number(limit) || 50));
    const now = nowIso(at);
    const rows = includeExpired
      ? db.prepare('SELECT * FROM working_items WHERE scope_id = ? ORDER BY pinned DESC, priority DESC, updated_at DESC LIMIT ?').all(scopeId, count)
      : db.prepare('SELECT * FROM working_items WHERE scope_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY pinned DESC, priority DESC, updated_at DESC LIMIT ?').all(scopeId, now, count);
    return rows.map(rowToWorking);
  }

  function update(id, patch = {}) {
    const current = get(id);
    if (!current) return null;
    db.prepare('UPDATE working_items SET priority = ?, pinned = ?, text = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.priority == null ? current.priority : clamp(patch.priority, 0, 1),
        patch.pinned == null ? (current.pinned ? 1 : 0) : (patch.pinned ? 1 : 0),
        patch.text == null ? current.text : String(patch.text),
        nowIso(),
        id,
      );
    return get(id);
  }

  function remove(id) {
    return db.prepare('DELETE FROM working_items WHERE id = ?').run(id).changes > 0;
  }

  function purgeExpired({ scopeId = 'global', at = Date.now() } = {}) {
    return db.prepare('DELETE FROM working_items WHERE scope_id = ? AND expires_at IS NOT NULL AND expires_at <= ?').run(scopeId, nowIso(at)).changes;
  }

  return { add, get, list, update, remove, purgeExpired };
}

function rowToGoal(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: Number(row.priority),
    progress: Number(row.progress),
    parentId: row.parent_id,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createGoalStore(db) {
  function add({ scopeId = 'global', title, description = null, priority = 0.5, parentId = null, dueAt = null } = {}) {
    const clean = String(title ?? '').trim();
    if (!clean) throw new Error('goal title is required');
    const id = makeId('gol');
    const now = nowIso();
    db.prepare(`
      INSERT INTO goals(id, scope_id, title, description, status, priority, progress, parent_id, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)
    `).run(id, scopeId, clean, description, clamp(priority, 0, 1), parentId, dueAt, now, now);
    return get(id);
  }

  function get(id) {
    return rowToGoal(db.prepare('SELECT * FROM goals WHERE id = ?').get(id));
  }

  function list({ scopeId = 'global', status = null, limit = 50 } = {}) {
    const count = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = status
      ? db.prepare('SELECT * FROM goals WHERE scope_id = ? AND status = ? ORDER BY priority DESC, updated_at DESC LIMIT ?').all(scopeId, status, count)
      : db.prepare('SELECT * FROM goals WHERE scope_id = ? ORDER BY priority DESC, updated_at DESC LIMIT ?').all(scopeId, count);
    return rows.map(rowToGoal);
  }

  function update(id, patch = {}) {
    const current = get(id);
    if (!current) return null;
    const status = patch.status ?? current.status;
    const progress = patch.progress == null ? current.progress : clamp(patch.progress, 0, 1);
    db.prepare('UPDATE goals SET title = ?, description = ?, status = ?, priority = ?, progress = ?, due_at = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title ?? current.title,
        patch.description ?? current.description,
        status,
        patch.priority == null ? current.priority : clamp(patch.priority, 0, 1),
        status === 'completed' ? 1 : progress,
        patch.dueAt ?? current.dueAt,
        nowIso(),
        id,
      );
    return get(id);
  }

  function complete(id) {
    return update(id, { status: 'completed', progress: 1 });
  }

  return { add, get, list, update, complete };
}

export function renderWorkingMemory(items, { budgetTokens = 500 } = {}) {
  const lines = [];
  let used = 0;
  for (const item of items) {
    const prefix = item.pinned ? '📌 ' : '- ';
    const line = `${prefix}${item.kind}: ${truncate(item.text, 220)}`;
    const cost = estimateTokens(line);
    if (used + cost > budgetTokens) break;
    lines.push(line);
    used += cost;
  }
  return { text: lines.join('\n'), used, count: lines.length };
}
