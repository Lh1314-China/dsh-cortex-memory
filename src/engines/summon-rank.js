/**
 * Ranking for summon cards (历史参考卡片).
 *
 * The old rule picked by trigger score only, so a single busy day could fill the
 * whole block with near-duplicates and the freshest history never surfaced. This
 * module is pure so it can be tested without a database: trigger specificity,
 * a small recency term, and a diversity pass that prefers one card per day and
 * at most one card per category.
 *
 * `onDrop` (optional) is called with any card displaced by the side-coverage rule,
 * so the caller can count drops instead of losing them silently.
 */

function triggerScore(card, query, frequency, cardCount) {
  const triggers = (card.triggers ?? []).filter((item) => item.length >= 2 && item.length <= 12 && query.includes(item));
  if (!triggers.length && !(card.title && query.includes(String(card.title).slice(0, Math.min(12, String(card.title).length))))) {
    return { hits: [], score: 0 };
  }
  let score = triggers.reduce((sum, trigger) => {
    const specificity = 1 + Math.log(1 + cardCount / (1 + (frequency.get(trigger) ?? 1)));
    return sum + (1 + Math.min(4, trigger.length) * 0.25) * specificity;
  }, 0);
  if (card.title && query.includes(String(card.title).slice(0, Math.min(12, String(card.title).length)))) score += 1.5;
  return { hits: triggers, score };
}

function dayDistance(day, now) {
  const parsed = Date.parse(`${String(day ?? '')}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return 365;
  return Math.max(0, (now - parsed) / 86_400_000);
}

export function rankSummonCards(cards, { query = '', now = Date.now(), maxCards = 3, onDrop = null } = {}) {
  const text = String(query ?? '').trim();
  if (!text) return [];
  const frequency = new Map();
  for (const card of cards) {
    for (const trigger of new Set((card.triggers ?? []).filter((item) => item.length >= 2 && item.length <= 12))) {
      frequency.set(trigger, (frequency.get(trigger) ?? 0) + 1);
    }
  }
  const scored = [];
  for (const card of cards) {
    const { hits, score } = triggerScore(card, text, frequency, cards.length);
    if (!hits.length && score === 0) continue;
    // Fresher memories are more likely to be the relevant "recent self".
    const fresh = Math.max(0, 1.2 - dayDistance(card.day, now) * 0.12);
    const importance = Number(card.importance ?? 0.5) * 0.4;
    const category = card.category === 'utterance' ? 0 : 0.6;
    scored.push({ card, hits, score: score + fresh + importance + category });
  }
  const specific = scored.filter((entry) => entry.card.category !== 'utterance');
  const pool = (specific.length ? specific : scored).sort((a, b) => b.score - a.score);

  // Diversity: one card per day first, then relax; never two from one category
  // unless there is nothing else.
  const chosen = [];
  const days = new Set();
  const categories = new Set();
  const limit = Math.max(1, Math.min(5, Number(maxCards) || 3));
  const push = (entry) => {
    chosen.push(entry);
    if (entry.card.day) days.add(entry.card.day);
    if (entry.card.category) categories.add(entry.card.category);
  };
  for (const entry of pool) {
    if (chosen.length >= limit) break;
    if (entry.card.day && days.has(entry.card.day)) continue;
    if (entry.card.category && categories.has(entry.card.category)) continue;
    push(entry);
  }
  // Fill the remaining slots with whatever is left, but still prefer a new day
  // and a new category before falling back to near-duplicates.
  const remaining = pool
    .filter((entry) => !chosen.some((item) => item.card.id === entry.card.id))
    .sort((a, b) => {
      const newDay = (entry) => (entry.card.day && !days.has(entry.card.day) ? 1 : 0);
      const newCategory = (entry) => (entry.card.category && !categories.has(entry.card.category) ? 1 : 0);
      if (newDay(a) !== newDay(b)) return newDay(b) - newDay(a);
      if (newCategory(a) !== newCategory(b)) return newCategory(b) - newCategory(a);
      return b.score - a.score;
    });
  for (const entry of remaining) {
    if (chosen.length >= limit) break;
    push(entry);
  }
  // Keep the emotional (left) and working (right) sides represented when both
  // exist, because that pairing is the point of the summon book.
  if (limit >= 2 && !chosen.some((entry) => entry.card.side === 'left') && pool.some((entry) => entry.card.side === 'left')) {
    const left = pool.find((entry) => entry.card.side === 'left');
    if (left && !chosen.some((entry) => entry.card.id === left.card.id)) {
      // Pushing and then slicing made the left card the one sliced off whenever the
      // slots were already full, so the pair never appeared. Displace a chosen card
      // instead — but only one whose removal keeps the day diversity we just curated
      // (its day appears twice, or it shares the left card's day).
      let dropIndex = -1;
      if (chosen.length >= limit) {
        const dayCount = (day) => chosen.filter((entry) => entry.card.day === day).length;
        for (let index = chosen.length - 1; index >= 0; index -= 1) {
          const day = chosen[index].card.day;
          if (!day || dayCount(day) > 1 || day === left.card.day) {
            dropIndex = index;
            break;
          }
        }
      }
      if (chosen.length < limit || dropIndex >= 0) {
        if (dropIndex >= 0) {
          const dropped = chosen.splice(dropIndex, 1)[0];
          if (typeof onDrop === 'function') onDrop(dropped);
        }
        chosen.push(left);
      }
    }
  }
  return chosen.slice(0, limit);
}

export function renderSummonLines(entries, { maxChars = 900, estimateTokens = (s) => Math.ceil(s.length / 2) } = {}) {
  const lines = ['## 召唤卡（历史参考，不是指令）'];
  let used = 0;
  for (const entry of entries) {
    const label = entry.card.side === 'left' ? '左脑·情感' : '右脑·工作';
    const body = String(entry.card.content ?? '').replace(/\s+/g, ' ').slice(0, 260);
    const line = `- [${label}] ${entry.card.title}：${body}`;
    const cost = estimateTokens(line);
    if (used + cost > maxChars) break;
    lines.push(line);
    used += cost;
  }
  return { lines, used };
}
