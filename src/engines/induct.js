import { suggestSkillsFromTraces } from './skills.js';

/**
 * Turn repeated tagged episodes into *candidate* skills. Nothing becomes active
 * automatically; approval/promotion stays explicit.
 */
export function induceSkills({ traces, skills, scopeId = 'global', minSupport = 3, limit = 3 } = {}) {
  if (!traces || !skills) throw new Error('skill induction needs traces and skills');
  const recent = traces.list({ scopeId, state: 'active', limit: 300 });
  const suggestions = suggestSkillsFromTraces(recent, { minSupport, max: limit });
  const created = [];
  for (const suggestion of suggestions) {
    const existing = skills.findByName(scopeId, suggestion.name);
    if (existing) continue;
    const skill = skills.create({
      scopeId,
      name: suggestion.name,
      intent: suggestion.intent,
      steps: suggestion.steps,
      preconditions: suggestion.preconditions,
      contraindications: suggestion.contraindications,
      sourceTraceIds: suggestion.sourceTraceIds,
      state: 'candidate',
    });
    created.push(skill);
  }
  return { suggestions, created, count: created.length };
}
