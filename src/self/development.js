import { makeId } from '../core/ids.js';
import { clamp, nowIso } from '../core/time.js';

export const STAGES = Object.freeze(['infancy', 'childhood', 'adolescence', 'adulthood']);

export const STAGE_POLICY = Object.freeze({
  infancy: { maxPerHour: 1, maxPerTurn: 1, minPriority: 0.55, label: '依赖期' },
  childhood: { maxPerHour: 2, maxPerTurn: 1, minPriority: 0.45, label: '形成期' },
  adolescence: { maxPerHour: 3, maxPerTurn: 2, minPriority: 0.38, label: '探索期' },
  adulthood: { maxPerHour: 4, maxPerTurn: 2, minPriority: 0.3, label: '成熟期' },
});

/**
 * Development is descriptive, not a reward. It is computed from observable
 * history (memory depth, feedback, calibration, skills, relationships and
 * consolidation) so the stage can be explained and replayed.
 */
export function computeMaturity({
  traces = 0,
  feedback = 0,
  calibration = null,
  activeSkills = 0,
  summaries = 0,
  relationships = [],
} = {}) {
  const memoryDepth = clamp(traces / 200, 0, 1);
  const feedbackDepth = clamp(feedback / 50, 0, 1);
  const calibrationQuality = calibration?.brier == null ? 0.25 : clamp(1 - calibration.brier, 0, 1);
  const skillDepth = clamp(activeSkills / 5, 0, 1);
  const narrativeDepth = clamp(summaries / 10, 0, 1);
  const relationshipDepth = relationships.length
    ? relationships.reduce((sum, item) => sum + (Number(item.familiarity) * 0.6 + Number(item.trust) * 0.4), 0) / relationships.length
    : 0;
  const maturity = clamp(
    memoryDepth * 0.25
    + feedbackDepth * 0.15
    + calibrationQuality * 0.2
    + skillDepth * 0.15
    + narrativeDepth * 0.1
    + relationshipDepth * 0.15,
    0,
    1,
  );
  return {
    maturity: Math.round(maturity * 1000) / 1000,
    metrics: { memoryDepth, feedbackDepth, calibrationQuality, skillDepth, narrativeDepth, relationshipDepth },
  };
}

export function stageFor(maturity) {
  if (maturity < 0.2) return 'infancy';
  if (maturity < 0.42) return 'childhood';
  if (maturity < 0.68) return 'adolescence';
  return 'adulthood';
}

export function nextStage(stage) {
  const index = STAGES.indexOf(stage);
  return index >= 0 && index < STAGES.length - 1 ? STAGES[index + 1] : null;
}

function rowToMetric(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeId: row.scope_id,
    at: row.at,
    ...JSON.parse(row.metrics_json),
  };
}

export function createDevelopmentStore(db) {
  function record(scopeId, metrics, { at = nowIso() } = {}) {
    const id = makeId('grm');
    db.prepare('INSERT INTO growth_metrics(id, scope_id, at, metrics_json) VALUES (?, ?, ?, ?)')
      .run(id, scopeId, at, JSON.stringify(metrics));
    return rowToMetric(db.prepare('SELECT * FROM growth_metrics WHERE id = ?').get(id));
  }

  function latest(scopeId = 'global') {
    return rowToMetric(db.prepare('SELECT * FROM growth_metrics WHERE scope_id = ? ORDER BY at DESC LIMIT 1').get(scopeId));
  }

  function history(scopeId = 'global', { limit = 20 } = {}) {
    const count = Math.max(1, Math.min(100, Number(limit) || 20));
    return db.prepare('SELECT * FROM growth_metrics WHERE scope_id = ? ORDER BY at DESC LIMIT ?').all(scopeId, count).map(rowToMetric);
  }

  return { record, latest, history };
}

export function createDevelopmentEngine({
  traces,
  feedback = null,
  summaries = null,
  skills = null,
  relationships = null,
  growth = null,
  selfStore = null,
  audit = null,
  store = null,
} = {}) {
  if (!traces) throw new Error('development engine needs traces');

  function evaluate({ scopeId = 'global', now = Date.now() } = {}) {
    const traceCount = traces.count({ scopeId });
    const feedbackCount = feedback?.list?.({ scopeId, limit: 1000 })?.length ?? 0;
    const calibration = growth?.calibration?.({ scopeId }) ?? null;
    const activeSkills = skills?.list?.({ scopeId, state: 'active', limit: 100 })?.length ?? 0;
    const summaryCount = summaries?.list?.(scopeId, { limit: 100 })?.length ?? 0;
    const relations = relationships?.list?.(scopeId) ?? [];
    const computed = computeMaturity({
      traces: traceCount,
      feedback: feedbackCount,
      calibration,
      activeSkills,
      summaries: summaryCount,
      relationships: relations,
    });
    const stage = stageFor(computed.maturity);
    const previous = selfStore?.get?.(scopeId)?.stage ?? null;
    if (selfStore) selfStore.update(scopeId, { stage });
    const record = store?.record?.(scopeId, {
      stage,
      previousStage: previous,
      maturity: computed.maturity,
      ...computed.metrics,
      traceCount,
      feedbackCount,
      activeSkills,
      summaryCount,
    }, { at: nowIso(now) }) ?? null;
    if (previous && previous !== stage) {
      audit?.record?.({
        actor: 'self',
        action: 'stage.change',
        targetType: 'self',
        targetId: scopeId,
        detail: { from: previous, to: stage, maturity: computed.maturity },
      });
    }
    return {
      scopeId,
      stage,
      previousStage: previous,
      maturity: computed.maturity,
      metrics: computed.metrics,
      counts: { traceCount, feedbackCount, activeSkills, summaryCount, relationships: relations.length },
      policy: STAGE_POLICY[stage],
      record,
      at: nowIso(now),
    };
  }

  return { evaluate, stageFor, nextStage, STAGE_POLICY };
}
