import { makeId } from '../../core/ids.js';
import { nowIso } from '../../core/time.js';

function parse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToCard(row) {
  if (!row) return null;
  const manual = parse(row.manual_json ?? '{}', {});
  return {
    id: row.id,
    scopeId: row.scope_id,
    side: row.side,
    title: manual.title ?? row.title,
    content: manual.content ?? row.content,
    triggers: Array.isArray(manual.triggers) ? manual.triggers : parse(row.triggers_json, []),
    category: row.category,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    day: row.day,
    importance: manual.importance ?? Number(row.importance),
    manual: manual,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToVolume(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    side: row.side,
    title: row.title,
    category: row.category,
    index: row.index_text,
    content: row.content,
    cardIds: parse(row.card_ids_json, []),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSummonRepository(db) {
  function upsertCard(card = {}) {
    const existing = db.prepare(
      'SELECT * FROM summon_cards WHERE scope_id = ? AND source_kind = ? AND source_id = ?',
    ).get(card.scopeId ?? 'global', card.sourceKind ?? null, card.sourceId ?? null);
    const now = nowIso();
    const id = existing?.id ?? card.id ?? makeId('scd');
    db.prepare(`
      INSERT INTO summon_cards(id, scope_id, side, title, content, triggers_json, category,
                               source_kind, source_id, day, importance, manual_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_id, source_kind, source_id) DO UPDATE SET
        side = excluded.side, title = excluded.title, content = excluded.content,
        triggers_json = excluded.triggers_json, category = excluded.category,
        day = excluded.day, importance = excluded.importance, status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      id, card.scopeId ?? 'global', card.side, card.title, card.content,
      JSON.stringify(card.triggers ?? []), card.category ?? null,
      card.sourceKind ?? null, card.sourceId ?? null, card.day,
      Number(card.importance ?? 0.5), existing?.manual_json ?? '{}', card.status ?? 'active',
      existing?.created_at ?? now, now,
    );
    return getCard(id);
  }

  function getCard(id) {
    return rowToCard(db.prepare('SELECT * FROM summon_cards WHERE id = ?').get(id));
  }

  function listCards({ scopeId = 'global', day = null, side = null, limit = 300 } = {}) {
    const clauses = ['scope_id = ?', "status = 'active'"];
    const values = [scopeId];
    if (day) { clauses.push('day = ?'); values.push(day); }
    if (side) { clauses.push('side = ?'); values.push(side); }
    values.push(Math.max(1, Math.min(1000, Number(limit) || 300)));
    return db.prepare(`SELECT * FROM summon_cards WHERE ${clauses.join(' AND ')} ORDER BY day DESC, importance DESC, created_at DESC LIMIT ?`).all(...values).map(rowToCard);
  }

  function updateCard(id, patch = {}) {
    const current = getCard(id);
    if (!current) return null;
    const manual = {
      ...(current.manual ?? {}),
      ...(patch.title == null ? {} : { title: String(patch.title) }),
      ...(patch.content == null ? {} : { content: String(patch.content) }),
      ...(Array.isArray(patch.triggers) ? { triggers: patch.triggers.map(String) } : {}),
      ...(patch.importance == null ? {} : { importance: Number(patch.importance) }),
    };
    db.prepare('UPDATE summon_cards SET manual_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(manual), nowIso(), id);
    return getCard(id);
  }

  function upsertVolume(volume = {}) {
    const existing = db.prepare(
      'SELECT * FROM summon_volumes WHERE scope_id = ? AND side = ? AND category = ? AND period_start = ? AND period_end = ?',
    ).get(volume.scopeId ?? 'global', volume.side, volume.category ?? null, volume.periodStart ?? null, volume.periodEnd ?? null);
    const now = nowIso();
    const id = existing?.id ?? makeId('svl');
    db.prepare(`
      INSERT INTO summon_volumes(id, scope_id, side, title, category, index_text, content,
                                 card_ids_json, period_start, period_end, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_id, side, category, period_start, period_end) DO UPDATE SET
        title = excluded.title, index_text = excluded.index_text, content = excluded.content,
        card_ids_json = excluded.card_ids_json, status = excluded.status, updated_at = excluded.updated_at
    `).run(
      id, volume.scopeId ?? 'global', volume.side, volume.title, volume.category ?? null,
      volume.index ?? '', volume.content ?? '', JSON.stringify(volume.cardIds ?? []),
      volume.periodStart ?? null, volume.periodEnd ?? null, volume.status ?? 'active',
      existing?.created_at ?? now, now,
    );
    return getVolume(id);
  }

  function getVolume(id) {
    return rowToVolume(db.prepare('SELECT * FROM summon_volumes WHERE id = ?').get(id));
  }

  function listVolumes({ scopeId = 'global', side = null, limit = 100 } = {}) {
    const clauses = ['scope_id = ?', "status = 'active'"];
    const values = [scopeId];
    if (side) { clauses.push('side = ?'); values.push(side); }
    values.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    return db.prepare(`SELECT * FROM summon_volumes WHERE ${clauses.join(' AND ')} ORDER BY period_end DESC, updated_at DESC LIMIT ?`).all(...values).map(rowToVolume);
  }

  return { upsertCard, getCard, listCards, updateCard, upsertVolume, getVolume, listVolumes };
}
