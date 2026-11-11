import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, closeDatabase } from '../../src/store/database.js';
import { createEventRepository } from '../../src/store/repositories/events.js';
import { createTraceRepository } from '../../src/store/repositories/traces.js';
import { createSkillRepository } from '../../src/store/repositories/skills.js';
import { createSkillEngine, suggestSkillsFromTraces, renderSkill } from '../../src/engines/skills.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-skills-'));
  const { db } = openDatabase({ dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') });
  migrate(db);
  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const skills = createSkillRepository(db);
  return { dir, db, events, traces, skills };
}

test('skill state moves candidate -> trial -> active with successes', () => {
  const { dir, db, skills } = setup();
  try {
    const skill = skills.create({
      name: '修 DSH 插件',
      intent: '插件报错时按固定顺序排查',
      preconditions: ['用户报告插件异常'],
      steps: ['看日志', '复现', '改一处', '跑测试'],
      contraindications: ['未备份时不要批量改'],
    });
    assert.equal(skill.state, 'candidate');
    assert.equal(skill.automaticity, 0);
    skills.recordOutcome(skill.id, true);
    skills.recordOutcome(skill.id, true);
    const trial = skills.recordOutcome(skill.id, true);
    assert.equal(trial.state, 'trial');
    skills.recordOutcome(skill.id, true);
    const active = skills.recordOutcome(skill.id, true);
    assert.equal(active.state, 'active');
    assert.equal(active.successRate, 1);
    assert.ok(active.automaticity > 0.4);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repeated failures deprecate an active skill', () => {
  const { dir, db, skills } = setup();
  try {
    const skill = skills.create({ name: '失败的技能', steps: ['a', 'b'], state: 'active' });
    skills.recordOutcome(skill.id, false);
    skills.recordOutcome(skill.id, false);
    const stillActive = skills.recordOutcome(skill.id, false);
    assert.equal(stillActive.state, 'active');
    const result = skills.recordOutcome(skill.id, false);
    assert.equal(result.state, 'deprecated');
    assert.ok(result.successRate < 0.5);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate names reuse the existing skill and render includes contraindications', () => {
  const { dir, db, skills } = setup();
  try {
    const a = skills.create({ name: '同一技能', steps: ['a'], contraindications: ['危险时'] });
    const b = skills.create({ name: '同一技能', steps: ['b'] });
    assert.equal(a.id, b.id);
    assert.match(renderSkill(a), /不要用于：危险时/);
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('suggestSkillsFromTraces returns candidates only for repeated tags', () => {
  const traces = [
    { id: 't1', title: '修插件 A', tags: ['插件', '修复'] },
    { id: 't2', title: '修插件 B', tags: ['插件'] },
    { id: 't3', title: '修插件 C', tags: ['插件'] },
    { id: 't4', title: '随便', tags: ['其他'] },
  ];
  const suggestions = suggestSkillsFromTraces(traces, { minSupport: 3 });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].support, 3);
  assert.match(suggestions[0].name, /插件/);
});

test('skill engine lists and promotes', () => {
  const { dir, db, traces, skills } = setup();
  try {
    const engine = createSkillEngine({ skills, traces });
    const skill = engine.create({ name: '引擎技能', steps: ['x'] });
    const promoted = engine.promote(skill.id);
    assert.equal(promoted.state, 'active');
    assert.ok(engine.list({ state: 'active' }).some((item) => item.id === skill.id));
  } finally {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
