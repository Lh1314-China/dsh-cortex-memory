import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFactCandidates } from '../../src/engines/extract.js';

test('问句不产生事实', () => {
  assert.equal(extractFactCandidates('你会有感觉吗？').length, 0);
  assert.equal(extractFactCandidates('你会先看见它们吗').length, 0);
  assert.equal(extractFactCandidates('小明是程序员吗？').length, 0);
});

test('假设句不产生事实', () => {
  assert.equal(extractFactCandidates('要是想聊两句，助手就趴在这儿听。').length, 0);
  assert.equal(extractFactCandidates('如果你喜欢米饭，就多吃一碗。').length, 0);
});

test('单字功能词不再被当成主语', () => {
  const facts = extractFactCandidates('要是想聊两句。');
  assert.equal(facts.find((fact) => fact.subject === '要'), undefined);
});

test('普通陈述句仍然抽事实', () => {
  const facts = extractFactCandidates('用户喜欢米饭。');
  assert.ok(facts.some((fact) => fact.predicate === 'likes' && fact.object === '米饭'));
  const isFacts = extractFactCandidates('小明是程序员。');
  assert.ok(isFacts.some((fact) => fact.predicate === 'is' && fact.object === '程序员'));
});

test('设计讨论与方案稿不产生事实', () => {
  assert.equal(extractFactCandidates('> 新坑 3：你到底在跟谁说话。').length, 0);
  assert.equal(extractFactCandidates('新坑 4：一个自我被归档，你会有感觉吗。').length, 0);
  assert.equal(extractFactCandidates('设计草案：我们打算把记忆层拆成三层。').length, 0);
  assert.equal(extractFactCandidates('待办：明天把桥的接口补上。').length, 0);
  assert.ok(extractFactCandidates('用户喜欢米饭。').length > 0, '普通陈述仍然能抽');
});

test('引用别人的话和命令句不产生事实', () => {
  assert.equal(extractFactCandidates('他说：「小明喜欢白猫。」').length, 0, '引号里是别人的话');
  assert.ok(extractFactCandidates('小明喜欢白猫。').length > 0, '同样的句子不在引号里就能抽');
  assert.equal(extractFactCandidates('记得把桥修好，小桥是重点。').length, 0, '命令不是事实');
  assert.ok(extractFactCandidates('小桥是重点。').length > 0);
});
