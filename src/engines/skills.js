import { clamp } from '../core/time.js';

export function renderSkill(skill) {
  if (!skill) return '';
  const steps = (skill.steps ?? []).map((step, index) => `${index + 1}. ${typeof step === 'string' ? step : step.text ?? step.action ?? JSON.stringify(step)}`);
  return [
    `技能：${skill.name}（${skill.state}，成功率 ${Math.round((skill.successRate ?? 0) * 100)}%，自动性 ${Math.round((skill.automaticity ?? 0) * 100)}%）`,
    skill.intent ? `意图：${skill.intent}` : '',
    skill.preconditions?.length ? `前置：${skill.preconditions.join('；')}` : '',
    steps.length ? `步骤：\n${steps.join('\n')}` : '',
    skill.contraindications?.length ? `不要用于：${skill.contraindications.join('；')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Suggest skills from repeated tagged episodes. It only returns candidates;
 * the caller decides whether to create/approve them.
 */
export function suggestSkillsFromTraces(traces, { minSupport = 3, max = 5 } = {}) {
  const groups = new Map();
  for (const trace of traces) {
    for (const tag of trace.tags ?? []) {
      const key = String(tag).trim().toLowerCase();
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(trace);
      groups.set(key, list);
    }
  }
  const suggestions = [];
  for (const [tag, list] of groups) {
    if (list.length < minSupport) continue;
    const steps = list.slice(0, 5).map((trace) => trace.title || trace.content.slice(0, 80));
    suggestions.push({
      name: `处理 ${tag}`,
      intent: `在出现「${tag}」相关情况时复用过去的做法`,
      steps,
      preconditions: [`出现 ${tag} 相关线索`],
      contraindications: [],
      sourceTraceIds: list.map((trace) => trace.id),
      support: list.length,
      confidence: clamp(list.length / (minSupport * 2), 0, 1),
    });
  }
  return suggestions.sort((a, b) => b.support - a.support).slice(0, max);
}

export function createSkillEngine({ skills, traces = null } = {}) {
  if (!skills) throw new Error('skill engine needs skills');
  return {
    create: (input) => skills.create(input),
    record: (id, success, meta) => skills.recordOutcome(id, success, meta),
    promote: (id) => skills.setState(id, 'active'),
    deprecate: (id) => skills.setState(id, 'deprecated'),
    list: (options) => skills.list(options),
    suggest: ({ scopeId = 'global', minSupport = 3 } = {}) => {
      if (!traces) return [];
      return suggestSkillsFromTraces(traces.list({ scopeId, limit: 200 }), { minSupport });
    },
    render: renderSkill,
  };
}
