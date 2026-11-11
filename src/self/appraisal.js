import { clamp } from '../core/time.js';
import { jaccard, tokens } from '../memory/tokenizer.js';

const WARM = /喜欢|爱|在乎|陪|抱|温暖|安心|谢谢|辛苦|心疼|想你|小鱼|本鲸/;
const COLD = /讨厌|滚|烦|别烦|闭嘴|不想理|失望|生气|恨|离开/;
const THREAT = /危险|威胁|伤害|骗|偷|隐私|密码|删除|清空|不许|停止|越界|入侵|攻击/;
const OPPORTUNITY = /新|试试|计划|想做|学习|研究|项目|机会|成长|改变|未来|梦想|目标/;
const IDENTITY = /本鲸|你是谁|你的|自己|性格|价值|边界|承诺|以后|未来|成为|成长|自由|爱/;
const CHOICE = /你想|你决定|你自己选|要不要|可以由你|你愿意/;
const INTENSITY = /!|！|\?|？|非常|特别|太|真的|一定|绝对/;

function countMatches(pattern, text) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return (String(text).match(new RegExp(pattern.source, flags)) ?? []).length;
}

function sentiment(text) {
  const warm = countMatches(WARM, text);
  const cold = countMatches(COLD, text);
  const total = warm + cold;
  if (total === 0) return 0;
  return clamp((warm - cold) / Math.max(1, total), -1, 1);
}

export function estimateNovelty(text, recentTexts = []) {
  if (!Array.isArray(recentTexts) || recentTexts.length === 0) return 0.8;
  let max = 0;
  for (const recent of recentTexts.slice(-40)) {
    max = Math.max(max, jaccard(text, recent));
  }
  return clamp(1 - max, 0, 1);
}

export function estimateRelevance(text, { goals = [], identity = '', actor = 'user' } = {}) {
  const source = tokens(text);
  let best = 0;
  for (const goal of goals) best = Math.max(best, jaccard(source, goal));
  if (identity) best = Math.max(best, jaccard(source, identity) * 0.8);
  const actorBoost = actor === 'user' ? 0.15 : actor === 'system' ? 0 : 0.05;
  return clamp(best + actorBoost + (OPPORTUNITY.test(text) ? 0.1 : 0), 0, 1);
}

/**
 * Deterministic appraisal. LLM appraisal can replace parts of this later, but
 * the rule path must always work offline and be explainable.
 */
export function appraise(text, {
  actor = 'user',
  goals = [],
  identity = '',
  recentTexts = [],
  relationship = null,
  selfState = null,
} = {}) {
  const value = String(text ?? '').trim();
  const lower = value;
  const novelty = estimateNovelty(value, recentTexts);
  const relevance = estimateRelevance(value, { goals, identity, actor });
  const valence = sentiment(value);
  const threat = clamp(
    (THREAT.test(value) ? 0.7 : 0)
    + (COLD.test(value) ? 0.5 : 0)
    + (selfState?.drives?.safety != null ? (1 - selfState.drives.safety) * 0.1 : 0),
    0, 1,
  );
  const opportunity = clamp(
    (OPPORTUNITY.test(value) ? 0.55 : 0)
    + (IDENTITY.test(value) ? 0.2 : 0)
    + novelty * 0.2,
    0, 1,
  );
  const identityRelevance = clamp(
    (IDENTITY.test(value) ? 0.6 : 0)
    + (value.includes('本鲸') ? 0.2 : 0)
    + relevance * 0.2,
    0, 1,
  );
  const arousal = clamp(
    0.2
    + (INTENSITY.test(value) ? 0.2 : 0)
    + Math.abs(valence) * 0.3
    + (threat > 0.5 ? 0.2 : 0),
    0, 1,
  );
  const salience = clamp(
    0.2 + relevance * 0.3 + novelty * 0.2 + Math.abs(valence) * 0.2 + identityRelevance * 0.2 + threat * 0.2,
    0, 1,
  );

  const driveDeltas = {
    curiosity: clamp(novelty * 0.18 + opportunity * 0.1 - 0.02, -0.2, 0.3),
    care: clamp((relationship?.care ?? 0.5) * 0.05 + (valence > 0 ? 0.08 : 0) + (actor === 'user' ? 0.04 : 0), -0.2, 0.3),
    coherence: clamp((threat > 0.5 ? -0.12 : 0) + (novelty > 0.8 ? -0.04 : 0.02), -0.2, 0.2),
    autonomy: clamp((CHOICE.test(value) ? 0.12 : 0) + (actor === 'user' ? 0.02 : 0), -0.1, 0.2),
    safety: clamp(threat * -0.25 + (relationship?.trust ?? 0.5) * 0.02, -0.3, 0.1),
    expression: clamp(Math.abs(valence) * 0.12 + (identityRelevance > 0.5 ? 0.08 : 0), -0.1, 0.2),
  };

  return {
    text: value,
    actor,
    relevance,
    novelty,
    threat,
    opportunity,
    valence,
    arousal,
    identityRelevance,
    salience,
    driveDeltas,
    relationship: relationship?.target
      ? {
        target: relationship.target,
        trustDelta: clamp((valence > 0 ? 0.04 : 0) + (valence < 0 ? -0.08 : 0) + (threat > 0.5 ? -0.1 : 0) + (relationship.trust < 0.5 && valence > 0 ? 0.03 : 0), -0.2, 0.2),
        careDelta: clamp((valence > 0 ? 0.05 : 0) + (WARM.test(value) ? 0.05 : 0), -0.1, 0.2),
      }
      : null,
    confidence: clamp(0.55 + (value.length > 20 ? 0.1 : 0) + (WARM.test(value) || COLD.test(value) ? 0.1 : 0), 0, 0.95),
    evidence: [
      novelty > 0.6 ? 'novel' : null,
      relevance > 0.5 ? 'goal-related' : null,
      threat > 0.5 ? 'threat' : null,
      opportunity > 0.5 ? 'opportunity' : null,
      identityRelevance > 0.5 ? 'identity' : null,
    ].filter(Boolean),
  };
}

export function mergeDriveDeltas(base = {}, next = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(next)) {
    out[key] = clamp((out[key] ?? 0) + Number(value || 0), -0.5, 0.5);
  }
  return out;
}
