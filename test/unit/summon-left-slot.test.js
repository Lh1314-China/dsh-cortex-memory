import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSummonCards } from '../../src/engines/summon-rank.js';

function card(id, side, day, extra = {}) {
  return {
    id,
    side,
    day,
    category: 'decision',
    title: `关于 ${id} 的决定`,
    content: `内容 ${id}`,
    triggers: ['向量回填', id],
    importance: 0.8,
    ...extra,
  };
}

test('槽位满时补齐左卡：挤掉最弱的一项，而不是把自己裁掉', () => {
  const cards = [
    card('r1', 'right', '2026-11-15'),
    card('r2', 'right', '2026-11-14'),
    card('l1', 'left', '2026-11-15'),
  ];
  const dropped = [];
  const picked = rankSummonCards(cards, {
    query: '向量回填 这件事怎么处理',
    maxCards: 2,
    onDrop: (entry) => dropped.push(entry.card.id),
  });
  assert.equal(picked.length, 2, '名额不能超');
  assert.ok(picked.some((entry) => entry.card.side === 'left'), '左卡必须出现在结果里');
  assert.equal(dropped.length, 1, '挤掉的卡要回报，不能悄悄消失');
  assert.equal(dropped[0], 'r1', '应挤掉与左卡同一天、分数较低的那张，保住跨天多样性');
  assert.ok(!picked.some((entry) => entry.card.id === dropped[0]), '被挤掉的卡不该同时在结果里');
});

test('槽位没满时左卡直接补位，不触发丢弃', () => {
  const cards = [
    card('r1', 'right', '2026-11-15'),
    card('l1', 'left', '2026-11-14'),
  ];
  const dropped = [];
  const picked = rankSummonCards(cards, {
    query: '向量回填 这件事怎么处理',
    maxCards: 3,
    onDrop: (entry) => dropped.push(entry.card.id),
  });
  assert.equal(picked.length, 2);
  assert.equal(dropped.length, 0);
});
