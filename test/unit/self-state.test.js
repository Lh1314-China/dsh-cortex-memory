import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import {
  DEFAULT_DRIVES,
  driftDrives,
  applyDriveDeltas,
  driftMood,
  applyMood,
  defaultSelfState,
  createSelfStore,
} from '../../src/self/state.js';

test('drives drift toward baseline and never leave their bounds', () => {
  const low = { ...DEFAULT_DRIVES, care: 0.1 };
  const after = driftDrives(low, { elapsedHours: 24 });
  assert.ok(after.care > 0.1 && after.care <= 1);
  const near = driftDrives({ ...DEFAULT_DRIVES, care: 0.61 }, { elapsedHours: 1 });
  assert.ok(Math.abs(near.care - 0.6) < 0.1);
  const clamped = applyDriveDeltas(DEFAULT_DRIVES, { care: 5, curiosity: -5 });
  assert.equal(clamped.care, 1);
  assert.equal(clamped.curiosity, 0);
});

test('mood drifts to baseline and appraisal moves it', () => {
  const sad = { valence: -1, arousal: 0.9, energy: 0.2 };
  const rested = driftMood(sad, { elapsedHours: 6 });
  assert.ok(rested.valence > -1);
  assert.ok(rested.energy > 0.2);
  const moved = applyMood({ valence: 0, arousal: 0.2, energy: 0.6 }, { valence: 0.8, arousal: 0.4, salience: 0.9 });
  assert.ok(moved.valence > 0);
  assert.ok(moved.arousal > 0.2);
});

test('self store persists drives, mood and attention', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-self-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  try {
    const store = createSelfStore(db);
    const initial = store.get('global');
    assert.equal(initial.stage, 'infancy');
    assert.equal(initial.drives.care, DEFAULT_DRIVES.care);
    const updated = store.update('global', {
      drives: { care: 0.95 },
      mood: { valence: 0.5 },
      attention: { focus: '主人' },
    });
    assert.equal(updated.drives.care, 0.95);
    assert.equal(updated.mood.valence, 0.5);
    assert.equal(updated.attention.focus, '主人');
    const reloaded = store.get('global');
    assert.equal(reloaded.drives.care, 0.95);
    assert.equal(reloaded.attention.focus, '主人');
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appraisal moves drives in the expected direction', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-self-appraisal-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  try {
    const store = createSelfStore(db);
    const before = store.get('global');
    const after = store.applyAppraisal('global', {
      novelty: 0.9,
      care: 0.8,
      valence: 0.7,
      arousal: 0.6,
      salience: 0.9,
      driveDeltas: { curiosity: 0.15, care: 0.1, coherence: -0.05 },
    });
    assert.ok(after.drives.curiosity > before.drives.curiosity);
    assert.ok(after.drives.care > before.drives.care);
    assert.ok(after.mood.valence > before.mood.valence);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('default self state is a complete snapshot', () => {
  const state = defaultSelfState('global');
  assert.equal(state.scopeId, 'global');
  assert.ok(state.drives.coherence >= 0);
  assert.ok(state.mood.energy > 0);
  assert.equal(state.attention.budget, 1);
});
