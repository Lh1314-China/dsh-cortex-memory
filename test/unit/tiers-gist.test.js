import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTiers, renderTiers } from '../../src/prompt/tiers.js';

function item(overrides = {}) {
  return {
    id: 'trc_1',
    layer: 'L2',
    title: 'cortex 0.4.20 打包完成',
    snippet: '这是一段很长的工程细节，讲述了打包、测试、验证的每一步过程，后面还有很多很多字。第二句继续补充。',
    importance: 0.9,
    utility: 0.9,
    ...overrides,
  };
}

test('高重要度记忆注入时只给一句 gist，并带省略号', () => {
  const selection = selectTiers([item()], { gistChars: 24 });
  const line = selection.perm[0].render;
  assert.match(line, /打包完成/);
  assert.ok(line.endsWith('…') || line.includes('…'), line);
  assert.ok(line.length < 120, 'gist 应该比原 snippet 短得多');
});

test('短片段原样保留，不加省略号', () => {
  const selection = selectTiers([item({ snippet: '用户说会买米饭' })], { gistChars: 120 });
  const line = selection.perm[0].render;
  assert.match(line, /用户说会买米饭/);
  assert.doesNotMatch(line, /…/);
});

test('标题已经包含在正文开头时，不再重复一遍', () => {
  const title = '2026-11-15 17:35：0.4.60 打包，修 GLOB 陷阱';
  const snippet = `${title}。先备份再改，测试跑两遍。第三句。`;
  const selection = selectTiers([item({ title, snippet })], { gistChars: 120 });
  const line = selection.perm[0].render;
  const occurrences = (line.match(/0\.4\.60 打包/g) ?? []).length;
  assert.equal(occurrences, 1, `标题不该在冒号后再出现一次：${line}`);
  assert.match(line, /先备份再改/);
});

test('正文与标题完全相等时，不留悬空的冒号', () => {
  const title = '正文和标题一模一样的一句话';
  const selection = selectTiers([item({ title, snippet: title })], { gistChars: 120 });
  const line = selection.perm[0].render;
  assert.doesNotMatch(line, /：\s*$/, `不该以冒号结尾：${line}`);
  assert.match(line, /一模一样/);
});

test('cold 层给出「为什么可能值得取回」而不只是目录', () => {
  const selection = selectTiers([item({ importance: 0.2, sources: [{ name: 'recent', rank: 1 }] })]);
  assert.equal(selection.cold.length, 1);
  assert.match(selection.cold[0].render, /命中 recent/);
});

test('低重要度 + 语义命中 → 冷层，且理由写「语义相近」', () => {
  const selection = selectTiers([item({ importance: 0.2, sources: [{ name: 'vector', rank: 1 }] })]);
  assert.equal(selection.cold.length, 1, '低重要度不该占 hot 预算');
  assert.match(selection.cold[0].render, /语义相近/);
  assert.equal(selection.hot.length, 0);
});

test('中等重要度的语义命中仍进热层', () => {
  const selection = selectTiers([item({ importance: 0.55, sources: [{ name: 'vector', rank: 1 }] })]);
  assert.equal(selection.hot.length, 1);
  assert.equal(selection.cold.length, 0);
});

test('真实数据里没有 <0.4 时，仍按相对分位切出冷层', () => {
  // 线上 importance 全在 0.6–1.0：绝对阈值永远够不着，靠排名后 25% 兜底。
  const items = Array.from({ length: 8 }, (_, index) => item({
    id: `r${index}`,
    importance: 0.6,
    utility: 1 - index / 100,
    sources: [{ name: 'fts', rank: index }],
  }));
  const selection = selectTiers(items, { budgets: { perm: 0, hot: 2000, cold: 2000 } });
  assert.equal(selection.cold.length, 2, '8 条里后 25% = 2 条进冷层');
  assert.equal(selection.hot.length, 6);
  assert.match(selection.cold[0].render, /字面命中/);
});

test('候选太少时不做相对切分，避免把仅有的几条都塞进冷层', () => {
  const items = Array.from({ length: 3 }, (_, index) => item({ id: `s${index}`, importance: 0.6, utility: 1 - index / 10 }));
  const selection = selectTiers(items, { budgets: { perm: 0, hot: 2000, cold: 2000 } });
  assert.equal(selection.cold.length, 0);
  assert.equal(selection.hot.length, 3);
});

test('冷层条数按「后 25%」取整，不因 ceil 切少', () => {
  const cases = [[4, 1], [5, 2], [6, 2], [7, 2], [8, 2], [10, 3], [20, 5]];
  for (const [total, expected] of cases) {
    const items = Array.from({ length: total }, (_, index) => item({ id: `n${index}`, importance: 0.6, utility: 1 - index / 100 }));
    const selection = selectTiers(items, { budgets: { perm: 0, hot: 5000, cold: 5000 } });
    assert.equal(selection.cold.length, expected, `${total} 条应有 ${expected} 条进冷层`);
  }
});

test('utility 相同时按 importance、id 稳定排序', () => {
  const items = [
    item({ id: 'b', importance: 0.7, utility: 1 }),
    item({ id: 'a', importance: 0.7, utility: 1 }),
    item({ id: 'c', importance: 0.9, utility: 1 }),
  ];
  const first = selectTiers(items, { budgets: { perm: 500, hot: 5000, cold: 5000 } });
  const second = selectTiers([...items].reverse(), { budgets: { perm: 500, hot: 5000, cold: 5000 } });
  assert.deepEqual(first.selected, second.selected, '同一批候选两轮顺序应一致');
  assert.equal(first.selected[0], 'c', 'importance 高者在前');
});

test('永久层堆满时，冷层不会吃掉加强层', () => {
  // 包包的场景：8 条候选里 6 条 importance ≥0.8，若按全体 8 条算 25%，会把仅剩的 2 条 hot 全推去 cold。
  const items = [
    ...Array.from({ length: 6 }, (_, index) => item({ id: `p${index}`, importance: 0.9, utility: 1 - index / 1000 })),
    ...Array.from({ length: 2 }, (_, index) => item({ id: `h${index}`, importance: 0.6, utility: 0.5 - index / 1000 })),
  ];
  const selection = selectTiers(items, { budgets: { perm: 5000, hot: 5000, cold: 5000 } });
  assert.equal(selection.perm.length, 6);
  assert.equal(selection.cold.length, 0, '非 perm 只有 2 条，不做相对切分');
  assert.equal(selection.hot.length, 2);
});

test('非 perm 候选足够多时，冷层按非 perm 条数切分', () => {
  const items = [
    ...Array.from({ length: 2 }, (_, index) => item({ id: `p${index}`, importance: 0.9, utility: 1 - index / 1000 })),
    ...Array.from({ length: 6 }, (_, index) => item({ id: `h${index}`, importance: 0.6, utility: 0.5 - index / 1000 })),
  ];
  const selection = selectTiers(items, { budgets: { perm: 5000, hot: 5000, cold: 5000 } });
  assert.equal(selection.perm.length, 2);
  assert.equal(selection.cold.length, 2, '6 条非 perm 的 25% = 2');
  assert.equal(selection.hot.length, 4);
});

test('cold 层仍是索引行，不带正文', () => {
  const selection = selectTiers([item({ importance: 0.2 })]);
  assert.equal(selection.cold.length, 1);
  assert.match(selection.cold[0].render, /正文按需 cortex_get/);
  const rendered = renderTiers(selection);
  assert.match(rendered, /卸载层/);
});
