import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFactsWithLlm } from '../../src/engines/llm-facts.js';

test('LLM facts parse strict JSON and drop low-confidence/unsupported items', async () => {
  const llm = { complete: async () => '```json\n{"facts":[{"subject":"助手","predicate":"likes","object":"白饭","confidence":0.9},{"subject":"x","predicate":"y","object":"z","confidence":0.2}]}\n```' };
  const result = await extractFactsWithLlm({ llm, text: '助手喜欢白饭。' });
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0], { subject: '助手', predicate: 'likes', object: '白饭', confidence: 0.9 });
});

test('LLM facts fail closed on malformed output or missing model', async () => {
  const malformed = { complete: async () => 'not json at all' };
  assert.equal((await extractFactsWithLlm({ llm: malformed, text: 'x' })).candidates.length, 0);
  assert.equal((await extractFactsWithLlm({ llm: null, text: 'x' })).error, 'llm-unavailable');
});
