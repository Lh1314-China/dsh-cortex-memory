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
} = {}) {
  if (!policies) throw new Error('evolution engine needs a policy repository');

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

  function selfOptimize({ scopeId = 'global' } = {}) {
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
    return { proposals, count: proposals.length, at: nowIso() };
  }

  function autoEvolve({ scopeId = 'global' } = {}) {
    const optimized = selfOptimize({ scopeId });
    const activated = [];
    const errors = [];
    for (const proposal of optimized.proposals) {
      try {
        activated.push(approve(proposal.id, { approvedBy: 'self:autoEvolve' }));
      } catch (error) {
        errors.push({ id: proposal.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { ...optimized, activated, errors };
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

  return { propose, approve, rollback, selfOptimize, autoEvolve, proposeIdentity, approveIdentity, status, evaluate };
}
