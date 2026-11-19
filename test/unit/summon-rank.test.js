import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSummonCards, renderSummonLines } from '../../src/engines/summon-rank.js';

const now = Date.parse('2026-11-15T12:00:00Z');

function card(overrides) {
  return {
    id: 'c1', side: 'right', category: 'work', title: '打包 cortex', content: '打包并验证',
    triggers: ['打包'], importance: 0.6, day: '2026-11-15',
    ...overrides,
  };
}

test('新的那天优先，旧的同类被压下去', () => {
  const cards = [
    card({ id: 'old', day: '2026-11-01', triggers: ['打包'], category: 'work' }),
    card({ id: 'new', day: '2026-11-15', triggers: ['打包'], category: 'work' }),
  ];
  const ranked = rankSummonCards(cards, { query: '今天想打包一版', now, maxCards: 1 });
  assert.equal(ranked[0].card.id, 'new');
});

test('同一天只取一张，避免一整屏都是同一天', () => {
  const cards = [
    card({ id: 'a', day: '2026-11-15', triggers: ['打包'], category: 'work' }),
    card({ id: 'b', day: '2026-11-15', triggers: ['打包'], category: 'emotion', side: 'left' }),
    card({ id: 'c', day: '2026-11-14', triggers: ['打包'], category: 'work' }),
  ];
  const ranked = rankSummonCards(cards, { query: '打包', now, maxCards: 2 });
  const days = new Set(ranked.map((entry) => entry.card.day));
  assert.equal(ranked.length, 2);
  assert.equal(days.size, 2, '两张卡应该来自不同天');
});

test('同类只取一张，左侧情感卡仍会被补进来', () => {
  const cards = [
    card({ id: 'w1', day: '2026-11-15', category: 'work', triggers: ['打包'] }),
    card({ id: 'w2', day: '2026-11-14', category: 'work', triggers: ['打包'] }),
    card({ id: 'e1', day: '2026-11-13', category: 'emotion', side: 'left', triggers: ['打包'] }),
  ];
  const ranked = rankSummonCards(cards, { query: '打包', now, maxCards: 2 });
  assert.equal(ranked.length, 2);
  assert.ok(ranked.some((entry) => entry.card.side === 'left'), '应该有一张左侧情感卡');
});

test('不匹配查询的卡片不出现', () => {
  const ranked = rankSummonCards([card({ triggers: ['米饭'] })], { query: '打包', now });
  assert.equal(ranked.length, 0);
  assert.equal(renderSummonLines(ranked).lines.length, 1);
});
