import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmAdapter } from '../../src/llm/adapter.js';

function mockCtx(text = '梦里，助手坐在米食旁边。') {
  return {
    get(name) {
      if (name === 'llm') {
        return {
          async *stream() { yield { type: 'text-delta', text }; },
        };
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test-model' }) };
      if (name === 'agents') return { currentInitiator: () => ({ session: { id: 's1' } }) };
      return null;
    },
  };
}

test('llm adapter completes, dreams and summarizes through the host service', async () => {
  const adapter = createLlmAdapter({ ctx: mockCtx() });
  assert.equal(adapter.available(), true);
  const text = await adapter.complete({ system: 's', prompt: 'p' });
  assert.match(text, /米食/);
  const dream = await adapter.dream({ pieces: ['米食'], emotions: '暖' });
  assert.match(dream, /米食/);
  const summary = await adapter.summarize({ text: '一段很长的记忆' });
  assert.match(summary, /米食/);
});

test('llm adapter fails open when the service is missing or errors', async () => {
  const missing = createLlmAdapter({ ctx: { get: () => null } });
  assert.equal(missing.available(), false);
  assert.equal(await missing.complete({ prompt: 'x' }), null);
  const broken = createLlmAdapter({
    ctx: {
      get(name) {
        if (name === 'llm') return { async *stream() { throw new Error('boom'); } };
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) };
        return null;
      },
    },
  });
  assert.equal(await broken.complete({ prompt: 'x' }), null);
});
