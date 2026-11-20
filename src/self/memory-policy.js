import { nowIso } from '../core/time.js';

/**
 * Memory policy: how memory flows is a decision, not a hard-coded constant.
 *
 * A policy is an ordinary `policies` row (kind: 'memory'): propose → approve →
 * rollback, every step audited by the evolution engine. Defaults come from the
 * config, so an install without a policy behaves exactly as before.
 *
 * Current knobs:
 *   - evergreenKinds: trace kinds that compression never auto-archives
 *   - consolidateOnTick / deepConsolidateHour / deepConsolidateLimit: consolidation cadence
 */
export function createMemoryPolicy({ policies = null, config = {} } = {}) {
  const defaults = Object.freeze({
    evergreenKinds: ['identity', 'promise'],
    consolidateOnTick: config.consolidateOnTick === true || config.features?.consolidateOnTick === true,
    deepConsolidateHour: Number(config.deepConsolidateHour ?? 4),
    deepConsolidateLimit: Number(config.deepConsolidateLimit ?? 60),
    compressionMinAgeDays: Number(config.compression?.minAgeDays ?? 7),
  });

  function current() {
    try {
      const active = policies?.active?.('memory');
      const cfg = active?.config;
      if (cfg && typeof cfg === 'object') {
        return {
          ...defaults,
          ...cfg,
          source: 'policy',
          policyId: active.id,
          policyVersion: active.version,
          activatedAt: active.activatedAt ?? null,
        };
      }
    } catch {
      /* a bad policy row must never block memory */
    }
    return { ...defaults, source: 'config' };
  }

  function evergreen(kind) {
    const list = current().evergreenKinds;
    return Array.isArray(list) && list.includes(String(kind ?? ''));
  }

  function describe() {
    const value = current();
    const lines = [
      `记忆策略来源：${value.source === 'policy' ? `policy v${value.policyVersion}（${value.policyId}）` : '配置文件默认'}`,
      `evergreen：${value.evergreenKinds?.join('、') || '（空）'}`,
      `巩固：tick=${value.consolidateOnTick ? '开' : '关'} · 深整理 ${value.deepConsolidateHour} 点 · 上限 ${value.deepConsolidateLimit} 条`,
    ];
    return lines.join('\n');
  }

  return { defaults, current, evergreen, describe, at: nowIso() };
}
