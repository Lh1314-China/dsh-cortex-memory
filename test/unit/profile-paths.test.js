import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { profileDataRoot, legacyProfileDataRoot } from '../../src/core/profile.js';

const home = 'C:/tmp/cortex-profile-test';

test('desktop data root is cortex-memory', () => {
  const root = profileDataRoot({ argv: [], env: { DSH_HOME: home, DSH_PROFILE: 'desktop' } });
  assert.equal(root, path.join(home, 'cortex-memory'));
});

test('other profiles are isolated under cortex-memory/profiles', () => {
  const root = profileDataRoot({ argv: [], env: { DSH_HOME: home, DSH_PROFILE: 'work' } });
  assert.equal(root, path.join(home, 'cortex-memory', 'profiles', 'work'));
});

test('legacy data root remains readable for migration', () => {
  const root = legacyProfileDataRoot({ argv: [], env: { DSH_HOME: home, DSH_PROFILE: 'desktop' } });
  assert.equal(root, path.join(home, 'cortex'));
});
