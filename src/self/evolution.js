import { nowIso } from '../core/time.js';

/**
 * Autonomous evolution, but gated:
 *
 * selfOptimize observes calibration/health/skills and writes *candidate*
 * policies. It never activates them. Activation is an explicit approval, and
 * every version can be rolled back. Identity changes go through the separate
 * identityStore proposal/approval flow.
 */
export function createEvolutionEngine({
  policies,
  identityStore = null,
  skills = null,
  health = null,
  growth = null,
  audit = null,
  logger = null,
  guard = null,
  qualityGuard = null,
} = {}) {
  const evaluateQuality = typeof qualityGuard === 'function' ? qualityGuard : null;
  if (!policies) throw new Error('evolution engine needs a policy repository');
  const guardConfig = {
    autoActivate: true,
    maxPerDay: 4,
    minIntervalMs: 60 * 60 * 1000,
    canaryTicks: 3,
    rollbackOnError: true,
    ...(guard && typeof guard === 'object' ? guard : {}),
  };
  const canaries = new Map();
  let lastActivatedAt = 0;
  let dayKey = '';
  let dayCount = 0;

  function propose({ kind, config, rationale = '', metrics = null, scopeId = 'global' } = {}) {
    const policy = policies.create({ kind, config, rationale, metrics });
    audit?.record?.({
      actor: 'self',
      action: 'policy.propose',
      targetType: 'policy',
      targetId: policy.id,
      detail: { kind, version: policy.version, rationale },
    });
    return { ...policy, scopeId };
  }

  function approve(id, { approvedBy = 'user' } = {}) {
    const activated = policies.activate(id);
    audit?.record?.({
      actor: approvedBy,
      action: 'policy.activate',
      targetType: 'policy',
      targetId: activated.id,
      detail: { kind: activated.kind, version: activated.version },
    });
    return activated;
  }

  function rollback(kind, toId = null, { approvedBy = 'user' } = {}) {
    if (!kind) throw new Error('policy kind is required for rollback');
    const activated = policies.rollback(kind, toId);
    audit?.record?.({
      actor: approvedBy,
      action: 'policy.rollback',
      targetType: 'policy',
      targetId: activated.id,
      detail: { kind: activated.kind, version: activated.version },
    });
    return activated;
  }

  function selfOptimize({ scopeId = 'global', baseline = false } = {}) {
    const proposals = [];
    const calibration = growth?.calibration?.({ scopeId }) ?? null;
    if (calibration?.brier != null && calibration.brier > 0.25) {
      proposals.push(propose({
        kind: 'retrieval',
        config: { confidenceWeight: 0.2, recentWeight: 0.08, note: 'calibration high' },
        rationale: `Brier ${calibration.brier.toFixed(3)} > 0.25，建议提高置信权重、降低近期偏置`,
        metrics: { brier: calibration.brier, ece: calibration.ece, n: calibration.n },
        scopeId,
      }));
    }
    const report = health?.audit?.({ scopeId }) ?? null;
    if (report?.issues?.some((issue) => issue.code === 'JOB_BACKLOG')) {
      proposals.push(propose({
        kind: 'maintenance',
        config: { runJobs: true, maxJobs: 20 },
        rationale: '后台任务积压，建议在空闲时批量 drain',
        metrics: { issues: report.issues.length },
        scopeId,
      }));
    }
    if (report?.issues?.some((issue) => issue.code === 'FTS_DRIFT')) {
      proposals.push(propose({
        kind: 'repair',
        config: { action: 'reindexFts' },
        rationale: 'FTS 索引漂移，建议重建',
        metrics: { issues: report.issues.length },
        scopeId,
      }));
    }
    if (skills) {
      const active = skills.list({ scopeId, state: 'active', limit: 100 });
      for (const skill of active) {
        if (skill.successRate < 0.5 && skill.successCount + skill.failureCount >= 3) {
          proposals.push(propose({
            kind: 'skill',
            config: { action: 'deprecate', skillId: skill.id },
            rationale: `技能「${skill.name}」成功率 ${Math.round(skill.successRate * 100)}%，建议降级`,
            metrics: { successRate: skill.successRate },
            scopeId,
          }));
        }
      }
    }
    if (baseline === true && proposals.length === 0) {
      const pending = policies.list({ status: 'candidate', limit: 20 });
      if (!pending.some((policy) => policy.kind === 'retrieval')) {
        proposals.push(propose({
          kind: 'retrieval',
          config: { recentWeight: 0.06, confidenceWeight: 0.18, note: 'baseline-telemetry' },
          rationale: '当前没有紧急健康问题；生成一个保守的检索权重候选，交给金丝雀和语义探针验证',
          metrics: { healthScore: report?.score ?? null, calibration: calibration ?? null },
          scopeId,
        }));
      }
    }
    return { proposals, count: proposals.length, at: nowIso() };
  }

  function autoEvolve({ scopeId = 'global' } = {}) {
    const optimized = selfOptimize({ scopeId });
    if (guardConfig.autoActivate !== true) {
      return { ...optimized, activated: [], deferred: 'auto-activate-off', guard: { ...guardConfig } };
    }
    const today = nowIso().slice(0, 10);
    if (today !== dayKey) { dayKey = today; dayCount = 0; }
    const activated = [];
    const errors = [];
    for (const proposal of optimized.proposals) {
      if (dayCount >= guardConfig.maxPerDay) break;
      if (lastActivatedAt && Date.now() - lastActivatedAt < guardConfig.minIntervalMs) break;
      try {
        const previous = policies.active(proposal.kind);
        const baseline = proposal.kind === 'retrieval' && evaluateQuality
          ? evaluateQuality({ scopeId, phase: 'before' })
          : null;
        const policy = approve(proposal.id, { approvedBy: 'self:autoEvolve' });
        const quality = proposal.kind === 'retrieval' && evaluateQuality
          ? evaluateQuality({ scopeId, phase: 'after', baseline })
          : null;
        if (quality && quality.ok === false) {
          const target = previous?.id ? policies.rollback(policy.kind, previous.id) : policies.deactivate(policy.kind);
          audit?.record?.({
            actor: 'self:autoEvolve',
            action: 'policy.autoevolve.quality-rollback',
            targetType: 'policy',
            targetId: policy.id,
            detail: { kind: policy.kind, quality, previousId: previous?.id ?? null, to: target?.id ?? null },
          });
          errors.push({ id: proposal.id, error: 'quality-guard', quality });
          continue;
        }
        canaries.set(policy.id, {
          kind: policy.kind,
          previousId: previous?.id ?? null,
          ticks: 0,
          activatedAt: Date.now(),
        });
        lastActivatedAt = Date.now();
        dayCount += 1;
        activated.push(policy);
      } catch (error) {
        errors.push({ id: proposal.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { ...optimized, activated, errors, guard: { ...guardConfig, usedToday: dayCount, pendingCanaries: canaries.size } };
  }

  function observeHealth(report = {}) {
    if (guardConfig.rollbackOnError !== true) return { rolledBack: [], pending: canaries.size, skipped: 'rollback-off' };
    const guardian = report?.steps?.guardian ?? report?.guardian ?? report;
    const issues = Array.isArray(guardian?.issues) ? guardian.issues : [];
    const failed = guardian?.ok === false || guardian?.integrity === 'error' || issues.some((issue) => issue?.code);
    const rolledBack = [];
    if (failed) {
      for (const [id, canary] of [...canaries.entries()]) {
        try {
          const target = canary.previousId ? policies.rollback(canary.kind, canary.previousId) : policies.deactivate(canary.kind);
          audit?.record?.({
            actor: 'self:autoRollback',
            action: 'policy.autoevolve.rollback',
            targetType: 'policy',
            targetId: id,
            detail: { kind: canary.kind, previousId: canary.previousId, to: target?.id ?? null, reason: issues.map((issue) => issue.code).filter(Boolean).slice(0, 3) },
          });
          rolledBack.push({ id, kind: canary.kind, to: target?.id ?? null });
          canaries.delete(id);
        } catch (error) {
          rolledBack.push({ id, kind: canary.kind, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { rolledBack, pending: canaries.size };
    }
    for (const [id, canary] of [...canaries.entries()]) {
      canary.ticks += 1;
      if (canary.ticks >= guardConfig.canaryTicks) {
        canaries.delete(id);
        audit?.record?.({
          actor: 'self:canary',
          action: 'policy.autoevolve.promote',
          targetType: 'policy',
          targetId: id,
          detail: { kind: canary.kind, ticks: canary.ticks },
        });
      } else {
        canaries.set(id, canary);
      }
    }
    return { rolledBack, pending: canaries.size };
  }

  function proposeIdentity({ scopeId = 'global', content, rationale = '' } = {}) {
    if (!identityStore) throw new Error('identity store is not available');
    const proposal = identityStore.propose(scopeId, content, { rationale, proposedBy: 'self' });
    audit?.record?.({
      actor: 'self',
      action: 'identity.propose',
      targetType: 'identity',
      targetId: proposal.id,
      detail: { version: proposal.version, rationale },
    });
    return proposal;
  }

  function approveIdentity(id, { approvedBy = 'user' } = {}) {
    if (!identityStore) throw new Error('identity store is not available');
    const approved = identityStore.approve(id, approvedBy);
    audit?.record?.({
      actor: approvedBy,
      action: 'identity.approve',
      targetType: 'identity',
      targetId: approved.id,
      detail: { version: approved.version },
    });
    return approved;
  }

  function status({ scopeId = 'global' } = {}) {
    return {
      active: {
        retrieval: policies.active('retrieval'),
        maintenance: policies.active('maintenance'),
        repair: policies.active('repair'),
        skill: policies.active('skill'),
      },
      candidates: policies.list({ status: 'candidate', limit: 20 }),
      identity: identityStore?.active?.(scopeId) ?? null,
      guard: {
        ...guardConfig,
        usedToday: dayCount,
        pendingCanaries: canaries.size,
        canaries: [...canaries.values()].map((canary) => ({ kind: canary.kind, ticks: canary.ticks, previousId: canary.previousId })),
      },
    };
  }

  async function evaluate({ id, queries = [], current, candidate } = {}) {
    const policy = policies.get(id);
    if (!policy) throw new Error(`policy not found: ${id}`);
    const { comparePolicies } = await import('../engines/evaluate.js');
    const comparison = await comparePolicies({ queries, current, candidate });
    const updated = policies.updateMetrics(id, comparison);
    audit?.record?.({
      actor: 'self',
      action: 'policy.evaluate',
      targetType: 'policy',
      targetId: id,
      detail: { before: comparison.before, after: comparison.after, delta: comparison.delta },
    });
    return { ...updated, comparison };
  }

  return { propose, approve, rollback, selfOptimize, autoEvolve, observeHealth, proposeIdentity, approveIdentity, status, evaluate };
}
