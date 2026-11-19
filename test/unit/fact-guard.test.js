import test from 'node:test';
import assert from 'node:assert/strict';
import { guardFactCandidate } from '../../src/engines/fact-guard.js';
import { extractFactsWithLlm } from '../../src/engines/llm-facts.js';
import { createFactExtractor } from '../../src/engines/extract.js';

test('junk triples seen in the 0.4.22 store are rejected', () => {
  assert.equal(guardFactCandidate({ subject: '现', predicate: 'at', object: '：' }), null);
  assert.equal(guardFactCandidate({ subject: '只', predicate: 'is', object: '一些' }), null);
  assert.equal(guardFactCandidate({ subject: '还', predicate: 'is', object: '很好' }), null);
  assert.equal(guardFactCandidate({ subject: '用户', predicate: '现', object: '米饭' }), null);
  assert.equal(guardFactCandidate({ subject: '用户', predicate: 'likes', object: '：' }), null);
  assert.equal(guardFactCandidate({ subject: '用户', predicate: 'likes', object: '' }), null);
});

test('a plausible triple survives and is normalized', () => {
  const guarded = guardFactCandidate({ subject: ' 用户 ', predicate: ' Likes ', object: '米饭', confidence: 1.4 });
  assert.deepEqual(guarded, { subject: '用户', predicate: 'likes', object: '米饭', confidence: 1 });
});

test('LLM extractor drops junk and keeps the valid fact', async () => {
  const llm = {
    complete: async () => JSON.stringify({
      facts: [
        { subject: '现', predicate: 'at', object: '：', confidence: 0.9 },
        { subject: '只', predicate: 'is', object: '猫', confidence: 0.9 },
        { subject: '用户', predicate: 'likes', object: '米饭', confidence: 0.8 },
        { subject: '用户', predicate: 'likes', object: '海', confidence: 0.3 },
      ],
    }),
  };
  const result = await extractFactsWithLlm({ llm, text: '用户喜欢米饭。' });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].subject, '用户');
});

test('extractor resolves only guarded candidates', () => {
  const upserts = [];
  const resolved = [];
  const entities = { upsert: ({ name }) => { upserts.push(name); return { id: `ent_${name}` }; } };
  const facts = { resolve: (input) => { resolved.push(input); return { fact: { id: 'f' } }; } };
  const extractor = createFactExtractor({ entities, facts });
  const result = extractor.extract({
    text: '助手是本地记忆助手。现是在：。',
    persona: { selfName: '助手', userAddress: '用户' },
  });
  assert.ok(upserts.includes('助手'));
  assert.ok(!upserts.includes('现'));
  assert.ok(resolved.every((item) => /^[a-z_]+$/.test(item.predicate)));
  assert.ok(result.candidates.length >= 1);
});
