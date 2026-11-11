import { nowIso } from '../core/time.js';

const SNAPSHOT_VERSION = 1;

export function exportSnapshot(cortex, { scopeId = 'global' } = {}) {
  const traces = cortex.repos.traces.list({ scopeId, limit: 5000 });
  const facts = cortex.repos.facts.list({ scopeId, limit: 5000 });
  const entities = cortex.repos.entities.list({ scopeId, limit: 5000 });
  const summaries = cortex.repos.summaries.list(scopeId, { limit: 500 });
  const skills = cortex.repos.skills.list({ scopeId, limit: 500 });
  return {
    format: 'dsh-cortex-snapshot',
    version: SNAPSHOT_VERSION,
    exportedAt: nowIso(),
    scopeId,
    self: cortex.self(scopeId),
    traces,
    facts,
    entities,
    summaries,
    skills,
    working: cortex.working.list({ scopeId, limit: 200 }),
    goals: cortex.goals.list({ scopeId, limit: 200 }),
  };
}

export function validateSnapshot(snapshot) {
  const issues = [];
  if (!snapshot || snapshot.format !== 'dsh-cortex-snapshot') issues.push('format mismatch');
  if (Number(snapshot?.version) > SNAPSHOT_VERSION) issues.push(`version ${snapshot.version} is newer than ${SNAPSHOT_VERSION}`);
  if (!Array.isArray(snapshot?.traces)) issues.push('traces must be an array');
  if (!Array.isArray(snapshot?.facts)) issues.push('facts must be an array');
  if (!Array.isArray(snapshot?.entities)) issues.push('entities must be an array');
  return { ok: issues.length === 0, issues, version: snapshot?.version ?? null };
}

export function importSnapshot(cortex, snapshot, { dryRun = false, scopeId = null } = {}) {
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) return { imported: false, reasons: validation.issues };
  const targetScope = scopeId ?? snapshot.scopeId ?? 'global';
  const traces = [];
  const skipped = [];
  for (const trace of snapshot.traces) {
    if (!trace?.content) { skipped.push({ id: trace?.id ?? null, reason: 'empty' }); continue; }
    if (dryRun) { traces.push({ dryRun: true, sourceId: trace.id }); continue; }
    const result = cortex.write({
      text: trace.content,
      title: trace.title ?? null,
      kind: trace.kind ?? 'utterance',
      tags: trace.tags ?? [],
      importance: trace.importance ?? 0.5,
      explicit: true,
      operationId: `snapshot:${trace.id}`,
      now: trace.recordedAt ? Date.parse(trace.recordedAt) : undefined,
      scopeId: targetScope,
    });
    traces.push({ dryRun: false, sourceId: trace.id, traceId: result.trace?.id ?? null, skipped: result.skipped === true, reason: result.reason ?? null });
  }
  return {
    imported: !dryRun,
    version: snapshot.version,
    scopeId: targetScope,
    traces: traces.length,
    skipped,
    items: traces,
  };
}
