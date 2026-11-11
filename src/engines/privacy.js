import { transaction } from '../store/database.js';
import { nowIso } from '../core/time.js';

/**
 * Privacy is separate from forgetting:
 * - archive = leave the trace in cold storage, discoverable by wake.
 * - delete = remove content and derived rows; the append-only event keeps only
 *   the content hash (the encode pipeline never writes raw text into the ledger).
 */
export function createPrivacyEngine({ db, traces, events, audit = null } = {}) {
  if (!db || !traces) throw new Error('privacy engine needs db and traces');

  function archiveTrace(traceId, { actor = 'user', reason = 'archive' } = {}) {
    const trace = traces.get(traceId);
    if (!trace) return { removed: false, reason: 'not-found' };
    const updated = traces.update(traceId, { state: 'archived', compression: 'archived' });
    audit?.record?.({
      actor,
      action: 'privacy.archive',
      targetType: 'trace',
      targetId: traceId,
      detail: { reason, eventId: trace.eventId },
    });
    return { removed: true, trace: updated };
  }

  function deleteTrace(traceId, { actor = 'user', reason = 'privacy' } = {}) {
    const trace = traces.get(traceId);
    if (!trace) return { removed: false, reason: 'not-found' };
    const result = transaction(db, () => {
      const feedback = db.prepare('DELETE FROM feedback WHERE trace_id = ?').run(traceId).changes;
      const appraisals = db.prepare('DELETE FROM appraisals WHERE trace_id = ?').run(traceId).changes;
      db.prepare('DELETE FROM embeddings WHERE trace_id = ?').run(traceId);
      const links = db.prepare('DELETE FROM memory_links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)').run('trace', traceId, 'trace', traceId).changes;
      const facts = trace.eventId
        ? db.prepare('DELETE FROM facts WHERE source_event_id = ?').run(trace.eventId).changes
        : 0;
      const summaries = db.prepare('DELETE FROM summaries WHERE source_ids_json LIKE ?').run(`%${traceId}%`).changes;
      const removed = traces.remove(traceId);
      audit?.record?.({
        actor,
        action: 'privacy.delete',
        targetType: 'trace',
        targetId: traceId,
        detail: {
          reason,
          eventId: trace.eventId,
          contentHash: trace.hash,
          contentLength: trace.content.length,
          deleted: { feedback, appraisals, links, facts, summaries, trace: removed ? 1 : 0 },
        },
      });
      return { removed, feedback, appraisals, links, facts, summaries };
    });
    return { removed: true, ...result, eventRetained: Boolean(events?.get?.(trace.eventId)) };
  }

  function forget({ traceId, mode = 'archive', actor = 'user', reason = '' } = {}) {
    if (!traceId) throw new Error('traceId is required');
    if (mode === 'delete') return deleteTrace(traceId, { actor, reason: reason || 'privacy' });
    if (mode === 'archive') return archiveTrace(traceId, { actor, reason: reason || 'archive' });
    throw new Error(`unknown forget mode: ${mode}`);
  }

  function deleteScope(scopeId, { actor = 'user', reason = 'privacy-scope' } = {}) {
    if (!scopeId) throw new Error('scopeId is required');
    const result = transaction(db, () => {
      const counts = {};
      const countOf = (table) => {
        try { return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE scope_id = ?`).get(scopeId)?.c ?? 0); } catch { return 0; }
      };
      counts.traces = countOf('traces');
      counts.facts = countOf('facts');
      counts.entities = countOf('entities');
      counts.edges = countOf('edges');
      counts.summaries = countOf('summaries');
      counts.feedback = countOf('feedback');
      counts.appraisals = countOf('appraisals');
      counts.emotionEvents = countOf('emotion_events');
      counts.working = countOf('working_items');
      counts.goals = countOf('goals');
      counts.skills = countOf('skills');
      counts.identity = countOf('identity_versions');
      counts.relationships = countOf('relationships');
      counts.intentions = countOf('intentions');
      counts.growth = countOf('growth_metrics');
      counts.disputes = countOf('disputes');
      counts.jobs = countOf('jobs');
      counts.diary = countOf('diary_entries');
      counts.dreams = countOf('dreams');
      counts.sleeps = countOf('sleep_runs');
      counts.affectTargets = countOf('affect_targets');
      counts.embeddings = (() => {
        try { return Number(db.prepare('SELECT COUNT(*) AS c FROM embeddings WHERE trace_id IN (SELECT id FROM traces WHERE scope_id = ?)').get(scopeId)?.c ?? 0); } catch { return 0; }
      })();
      counts.memoryLinks = countOf('memory_links');
      counts.selfState = countOf('self_state');

      db.prepare('DELETE FROM traces_fts_index WHERE trace_id IN (SELECT id FROM traces WHERE scope_id = ?)').run(scopeId);
      db.prepare('DELETE FROM embeddings WHERE trace_id IN (SELECT id FROM traces WHERE scope_id = ?)').run(scopeId);
      db.prepare('DELETE FROM memory_links WHERE scope_id = ?').run(scopeId);
      for (const table of ['feedback', 'appraisals', 'emotion_events', 'working_items', 'goals', 'summaries', 'facts', 'edges', 'entities', 'identity_versions', 'relationships', 'intentions', 'growth_metrics', 'disputes', 'skills', 'jobs', 'diary_entries', 'dreams', 'sleep_runs', 'traces']) {
        try { db.prepare(`DELETE FROM ${table} WHERE scope_id = ?`).run(scopeId); } catch { /* table may not exist in an older schema */ }
      }
      try { db.prepare('DELETE FROM affect_targets WHERE scope_id = ?').run(scopeId); } catch { /* optional */ }
      try { db.prepare('DELETE FROM self_state WHERE scope_id = ?').run(scopeId); } catch { /* optional */ }
      audit?.record?.({
        actor,
        action: 'privacy.delete-scope',
        targetType: 'scope',
        targetId: scopeId,
        detail: { reason, counts },
      });
      return counts;
    });
    return { scopeId, removed: true, counts: result };
  }

  return { forget, archiveTrace, deleteTrace, deleteScope };
}
