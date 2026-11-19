/**
 * Retrieval-induced forgetting, engineering edition.
 *
 * Anderson & Spellman showed that practising one item suppresses its
 * competitors, and that the suppression decays. This module keeps that as a
 * small, explicit penalty stored in trace metadata: when a recall selects one
 * memory and drops a near-duplicate competitor, the competitor gets a small
 * inhibition that halves every `halfLifeDays`. It is off by default.
 */
const DAY_MS = 86_400_000;

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function suppressionOf(metadata, now = Date.now(), { halfLifeDays = 14 } = {}) {
  const raw = clamp01(metadata?.inhibition ?? 0);
  if (!raw) return 0;
  const at = Date.parse(metadata?.suppressedAt ?? '');
  if (!Number.isFinite(at)) return raw;
  const days = Math.max(0, (now - at) / DAY_MS);
  const life = Math.max(1, Number(halfLifeDays) || 14);
  return clamp01(raw * Math.pow(0.5, days / life));
}

export function withSuppression(metadata, now = Date.now(), { step = 0.15, cap = 1, halfLifeDays = 14 } = {}) {
  const current = suppressionOf(metadata, now, { halfLifeDays });
  return {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    inhibition: clamp01(Math.min(Number(cap) || 1, current + (Number(step) || 0.15))),
    suppressedAt: new Date(now).toISOString(),
  };
}

export function competingFactor(metadata, now = Date.now(), { strength = 0.35, halfLifeDays = 14 } = {}) {
  return 1 - suppressionOf(metadata, now, { halfLifeDays }) * (Number(strength) || 0);
}
