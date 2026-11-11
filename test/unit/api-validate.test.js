import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWrite, validateFeedback, validateForget, validateSearch } from '../../src/api/validate.js';

test('write validation accepts and normalizes a body', () => {
  const value = validateWrite({ text: ' 用户喜欢米食。 ', tags: [' 米食 ', ''], importance: 0.8, explicit: false });
  assert.equal(value.text, '用户喜欢米食。');
  assert.deepEqual(value.tags, ['米食']);
  assert.equal(value.importance, 0.8);
  assert.equal(value.explicit, false);
});

test('invalid bodies are rejected', () => {
  assert.throws(() => validateWrite({ text: '' }), /text/);
  assert.throws(() => validateWrite({ text: 'x', importance: 2 }), /importance/);
  assert.throws(() => validateSearch({ query: 'x', limit: 99 }), /limit/);
  assert.throws(() => validateFeedback({ id: 't', signal: '' }), /signal/);
  assert.throws(() => validateForget({ id: 't', mode: 'nuke' }), /mode/);
});
