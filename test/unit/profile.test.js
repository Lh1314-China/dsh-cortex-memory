import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { detectProfileName, profileDataRoot } from '../../src/core/profile.js';

test('detectProfileName reads --profile, --profile= and profile paths', () => {
  assert.equal(detectProfileName({ argv: ['node', 'dsh', '--profile', 'cortex-clean'], env: {} }), 'cortex-clean');
  assert.equal(detectProfileName({ argv: ['node', 'dsh', '--profile=cortex-bge'], env: {} }), 'cortex-bge');
  assert.equal(detectProfileName({ argv: ['node', 'host', 'C:\\Users\\x\\.dsh\\profiles\\desktop'], env: {} }), 'desktop');
  assert.equal(detectProfileName({ argv: [], env: { DSH_PROFILE: 'from-env' } }), 'from-env');
  assert.equal(detectProfileName({ argv: ['dsh', '--profile', 'cli-profile'], env: { DSH_PROFILE: 'desktop' } }), 'cli-profile');
  assert.equal(detectProfileName({ argv: [], env: {} }), null);
});

test('profileDataRoot isolates non-desktop profiles but keeps desktop historical path', () => {
  const env = { DSH_HOME: 'C:\\dsh-home' };
  assert.equal(profileDataRoot({ argv: ['dsh', '--profile', 'agent-a'], env }), path.join('C:\\dsh-home', 'cortex', 'profiles', 'agent-a'));
  assert.equal(profileDataRoot({ argv: ['dsh', '--profile', 'desktop'], env }), path.join('C:\\dsh-home', 'cortex'));
  assert.equal(profileDataRoot({ argv: [], env }), path.join('C:\\dsh-home', 'cortex'));
});
