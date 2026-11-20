/**
 * Alias resolution for people.
 *
 * The same person was stored as two targets ("用户" from the early days and
 * "用户" now), so the relationship model never accumulated and the affect
 * counts split. Everything that takes a target name goes through this resolver
 * first, so aliases converge on the configured user address.
 */
const DEFAULT_USER_ALIASES = ['用户', '你', '您'];

export function createTargetResolver(persona = {}) {
  const canonical = String(persona?.userAddress ?? '你').trim() || '你';
  const aliases = new Set([canonical, ...DEFAULT_USER_ALIASES]);
  for (const item of Array.isArray(persona?.userAliases) ? persona.userAliases : []) {
    const value = String(item ?? '').trim();
    if (value) aliases.add(value);
  }
  function resolveTarget(target) {
    const value = String(target ?? '').trim();
    if (!value) return canonical;
    return aliases.has(value) ? canonical : value;
  }
  return { canonical, aliases, resolveTarget };
}
