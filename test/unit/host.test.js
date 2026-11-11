import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../../index.js';

test('host plugin registers tools, a prompt section and cleans up', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-host-'));
  const registered = [];
  const handlers = [];
  let section = null;
  let dispose = null;
  const provided = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: {
      register(tool) {
        registered.push(tool);
        return () => {};
      },
    },
    on(name, handler) {
      handlers.push({ name, handler });
      return () => {};
    },
    systemPrompt: {
      section(value) {
        section = value;
        return () => {};
      },
    },
    effect(fn) {
      dispose = fn();
      return dispose;
    },
    provide(name, value) {
      provided.push({ name, value });
      return () => {};
    },
  };
  try {
    await apply(ctx, { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite'), scope: 'global' });
    assert.equal(registered.length, 21);
    assert.ok(registered.some((tool) => tool.name === 'cortex_search'));
    assert.ok(handlers.some((entry) => entry.name === 'session/event'));
    assert.ok(section);
    assert.equal(section.name, 'cortex-self');
    const text = section.text();
    assert.match(text, /自我状态/);
    assert.equal(provided[0].name, 'cortex');
    assert.equal(typeof provided[0].value.search, 'function');
    assert.equal(typeof dispose, 'function');
    dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
