import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDataRoot } from '../../bin/cortex.mjs';

const home = 'C:/tmp/cortex-cli-home';

test('CLI defaults to the cortex-memory root, not legacy cortex', () => {
  const root = resolveDataRoot({}, { DSH_HOME: home, DSH_PROFILE: 'desktop' });
  assert.equal(root, path.resolve(path.join(home, 'cortex-memory')));
});

test('CLI --data overrides the profile root', () => {
  const root = resolveDataRoot({ data: 'C:/tmp/explicit-cortex' }, { DSH_HOME: home, DSH_PROFILE: 'desktop' });
  assert.equal(root, path.resolve('C:/tmp/explicit-cortex'));
});

test('CLI CORTEX_HOME overrides the profile root', () => {
  const root = resolveDataRoot({}, { DSH_HOME: home, CORTEX_HOME: 'C:/tmp/cortex-env' });
  assert.equal(root, path.resolve('C:/tmp/cortex-env'));
});
