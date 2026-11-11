import { nowIso } from '../core/time.js';
import { appraise as defaultAppraise } from '../self/appraisal.js';
import { selectIntentions, DEFAULT_INITIATIVE_POLICY } from '../self/initiative.js';
import { computeRetrievability } from '../memory/dsr.js';

/**
 * The developmental heartbeat.
 *
 * One step is: perceive -> appraise -> move self-state -> encode -> recall ->
 * propose intentions. It deliberately does not execute external actions; the
 * host adapter or the user decides those.
 */
export function createDevelopEngine({
  events,
  traces,
  facts = null,
  entities = null,
  encode,
  retrieve = null,
  selfStore,
  appraisalStore = null,
  initiativeStore = null,
  identityStore = null,
  relationshipStore = null,
  emotion = null,
  initiativePolicy = null,
  policy = DEFAULT_INITIATIVE_POLICY,
  appraise = defaultAppraise,
} = {}) {
  if (!selfStore) throw new Error('develop engine needs selfStore');
  if (!encode) throw new Error('develop engine needs encode');

  function step({
    text,
    actor = 'user',
    scopeId = 'global',
    sessionId = null,
    turnId = null,
    operationId = null,
    goals = [],
    identity = '',
    relationship = null,
    relationshipTarget = '主人',
    recentTexts = [],
    explicit = false,
    facts: factInput = [],
    now = Date.now(),
    recallQuery = null,
    recallBudget = 1200,
  } = {}) {
    const before = selfStore.get(scopeId);
    const activeIdentity = identityStore?.active?.(scopeId) ?? null;
    const currentRelationship = relationship
      ?? relationshipStore?.ensure?.(scopeId, relationshipTarget)
      ?? null;
    const identityText = identity || activeIdentity?.content?.narrative || '';
    const appraisal = appraise(text, {
      actor,
      goals,
      identity: identityText,
      recentTexts,
      relationship: currentRelationship,
      selfState: before,
    });
    const after = selfStore.applyAppraisal(scopeId, appraisal, { at: now });
    const encoded = encode.encode({
      text,
      actor,
      scopeId,
      sessionId,
      turnId,
      operationId,
      explicit,
      facts: factInput,
      now,
    });
    const appraisalRow = appraisalStore?.record?.(scopeId, appraisal, {
      eventId: encoded?.event?.id ?? null,
      traceId: encoded?.trace?.id ?? null,
      at: nowIso(now),
    }) ?? null;

    const emotionResult = (emotion && !encoded?.skipped)
      ? emotion.record({
        text,
        target: relationshipTarget,
        traceId: encoded?.trace?.id ?? null,
        source: actor,
        at: nowIso(now),
      })
      : null;

    let relationshipAfter = currentRelationship;
    if (relationshipStore && currentRelationship && appraisal.relationship) {
      relationshipAfter = relationshipStore.applyDelta(scopeId, currentRelationship.target, appraisal.relationship, {
        event: text.slice(0, 200),
        at: nowIso(now),
      });
    }

    let recall = null;
    if (retrieve && recallQuery) {
      recall = retrieve.search(recallQuery, { scopeId, budget: recallBudget, now });
    }

    const recentIntentions = initiativeStore?.recent?.(scopeId, { now, hours: 24, limit: 100 }) ?? [];
    let intentions = selectIntentions({
      selfState: after,
      appraisal,
      unresolvedDisputes: 0,
      pendingQuestions: 0,
      lastConsolidationAt: null,
      store: initiativeStore,
      scopeId,
      now,
      policy: (() => {
        try {
          const override = initiativePolicy?.();
          return override ? { ...policy, ...override } : policy;
        } catch {
          return policy;
        }
      })(),
      recent: recentIntentions,
    });

    return {
      at: nowIso(now),
      scopeId,
      before,
      appraisal,
      appraisalRow,
      self: after,
      identity: activeIdentity,
      relationship: relationshipAfter,
      emotion: emotionResult,
      encoded,
      recall,
      intentions,
      metrics: {
        salience: appraisal.salience,
        care: after.drives.care,
        coherence: after.drives.coherence,
        valence: after.mood.valence,
        retrievability: encoded?.trace ? computeRetrievability(encoded.trace, now) : null,
      },
    };
  }

  function snapshot(scopeId = 'global') {
    const self = selfStore.get(scopeId);
    const pending = initiativeStore?.pending?.(scopeId) ?? [];
    return {
      self,
      identity: identityStore?.active?.(scopeId) ?? null,
      relationships: relationshipStore?.list?.(scopeId) ?? [],
      pendingIntentions: pending,
      traceCount: traces?.count?.({ scopeId }) ?? null,
      at: nowIso(),
    };
  }

  return { step, snapshot };
}
