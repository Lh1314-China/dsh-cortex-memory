/**
 * Autonomy tick: execute only the safe, local intentions and surface the rest
 * as proposals. It never sends messages or changes identity by itself.
 */
export function createAutonomyEngine({
  initiativeStore,
  reflect = null,
  retrieve = null,
  working = null,
  selfStore = null,
  scopeId = 'global',
  now = () => Date.now(),
} = {}) {
  if (!initiativeStore) throw new Error('autonomy needs an initiative store');

  function tick({ at = now(), max = 2 } = {}) {
    const pending = initiativeStore.pending(scopeId, { now: at, limit: Math.max(1, Math.min(20, max * 4)) });
    const executed = [];
    const proposals = [];
    for (const intention of pending) {
      if (executed.length >= max) break;
      if (intention.kind === 'consolidate' && reflect) {
        try {
          const result = reflect.reflect({ scopeId, windowDays: 1, now: at });
          executed.push({ id: intention.id, kind: intention.kind, result });
          initiativeStore.mark(intention.id, 'acted', { kind: 'reflect', summaryId: result?.summary?.id ?? null, skipped: result?.skipped ?? false });
        } catch (error) {
          initiativeStore.mark(intention.id, 'failed', { error: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }
      if (intention.kind === 'recall' && retrieve) {
        const query = intention.payload?.topic ?? intention.payload?.text ?? intention.reason ?? '';
        try {
          const result = retrieve.search(String(query), { scopeId, limit: 5, now: at });
          executed.push({ id: intention.id, kind: intention.kind, result: { count: result.items.length, ids: result.items.map((item) => item.id) } });
          initiativeStore.mark(intention.id, 'acted', { kind: 'recall', count: result.items.length });
        } catch (error) {
          initiativeStore.mark(intention.id, 'failed', { error: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }
      proposals.push({
        id: intention.id,
        kind: intention.kind,
        reason: intention.reason,
        payload: intention.payload,
        requires: intention.kind === 'propose' ? 'approval' : 'host',
      });
    }
    return { executed, proposals, at: new Date(at).toISOString(), pending: pending.length };
  }

  function status() {
    const pending = initiativeStore.pending(scopeId, { limit: 20 });
    return {
      pending: pending.length,
      byKind: pending.reduce((acc, item) => { acc[item.kind] = (acc[item.kind] ?? 0) + 1; return acc; }, {}),
      items: pending.map((item) => ({ id: item.id, kind: item.kind, priority: item.priority, reason: item.reason })),
    };
  }

  return { tick, status };
}
