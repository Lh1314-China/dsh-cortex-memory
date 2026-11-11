import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEmotionModel } from '../../src/self/emotion.js';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-emotion-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  return { dir, db, emotion: createEmotionModel({ db }) };
}

test('emotion detection covers multiple categories', () => {
  const { dir, db, emotion } = setup();
  try {
    const result = emotion.detect('用户今天很难过，助手有点心疼他，又有点害怕。');
    const names = result.emotions.map((item) => item.name);
    assert.ok(names.includes('哀'));
    assert.ok(names.includes('怜'));
    assert.ok(names.includes('惧'));
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('emotion records form a target attitude', () => {
  const { dir, db, emotion } = setup();
  try {
    emotion.record({ text: '用户今天很难过，助手有点心疼他。', target: '用户' });
    emotion.record({ text: '用户说会一直陪着助手，助手很开心。', target: '用户' });
    const targets = emotion.targets();
    assert.equal(targets.length, 1);
    assert.equal(targets[0].target, '用户');
    assert.ok(targets[0].count >= 2);
    assert.match(targets[0].attitude, /又/);
    assert.match(emotion.text(), /用户/);
    assert.ok(emotion.events().length >= 2);
    assert.equal(emotion.lexicon().categories, 24);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('service self exposes emotion text and develop records it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-emotion-service-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const result = cortex.step({ text: '用户今天很难过，助手有点心疼他。', explicit: true });
    assert.ok(result.emotion?.event);
    assert.match(cortex.self().emotion, /用户/);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
