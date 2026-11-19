/**
 * Alias resolution for people.
 *
 * The same person can be stored under two targets (a nickname from the early
 * days and the configured address now), so the relationship model would never
 * accumulate and the affect counts would split. Everything that takes a target
 * name goes through this resolver first, so aliases converge on the configured
 * user address. `persona.userAliases` adds local nicknames.
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
