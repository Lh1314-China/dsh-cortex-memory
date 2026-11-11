import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readModelConfig, saveModelConfig, redactedModelConfig } from '../../src/core/model-config.js';

test('model config applies local preset and redacts keys', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-model-config-'));
  try {
    const saved = saveModelConfig(dir, {
      embedding: { mode: 'local', apiKey: 'secret' },
      rerank: { enabled: true, baseUrl: 'http://127.0.0.1:9000/v1', model: 'r', apiKey: 'rerank-secret' },
    }, { confirm: true });
    assert.equal(saved.config.embedding.mode, 'local');
    assert.equal(saved.config.embedding.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(saved.config.embedding.model, 'bge-m3');
    assert.equal(saved.config.embedding.dim, 1024);
    assert.equal(saved.config.embedding.apiKeySet, true);
    assert.equal(saved.config.rerank.apiKeySet, true);
    assert.equal(readModelConfig(dir).embedding.apiKey, 'secret');
    assert.doesNotMatch(JSON.stringify(saved.config), /secret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model config rejects missing remote fields and no confirmation', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-model-config-bad-'));
  try {
    assert.throws(() => saveModelConfig(dir, { rerank: { enabled: true, baseUrl: '', model: '' } }, { confirm: true }), /rerank needs/);
    assert.throws(() => saveModelConfig(dir, { embedding: { mode: 'remote', baseUrl: 'https://api.example/v1', model: 'm' } }, { confirm: true }), /needs apiKey/);
    assert.throws(() => saveModelConfig(dir, { embedding: { mode: 'hash' } }, {}), /confirm/);
    writeFileSync(path.join(dir, 'model-config.json'), '{broken', 'utf8');
    assert.equal(readModelConfig(dir).embedding.mode, 'hash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
