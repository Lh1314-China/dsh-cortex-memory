import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client.js');
const source = readFileSync(file, 'utf8');

test('client registers the expected panel tabs and playbook actions', () => {
  assert.match(source, /__ModuleLoader__\.load/);
  assert.match(source, /id: 'dsh-cortex'/);
  for (const tab of ['self', 'search', 'timeline', 'working', 'emotion', 'life', 'graph', 'playbook', 'audit', 'retention', 'health', 'evolution', 'settings']) {
    assert.match(source, new RegExp(`\\['${tab}', t\\('`), `tab ${tab}`);
  }
  assert.match(source, /api\('\/playbook\?status=candidate'\)/);
  assert.match(source, /act\('approve'/);
  assert.match(source, /api\('\/permissions'/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /vectorDisabled/);
  assert.match(source, /autoFacts/);
});

test('client keeps keyboard and aria wiring for the panel', () => {
  assert.match(source, /role: 'tablist'/);
  assert.match(source, /aria-selected/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /role: 'tabpanel'/);
});
