import fs from 'node:fs';
import path from 'node:path';

const FILE = 'model-config.json';

export const DEFAULT_MODEL_CONFIG = Object.freeze({
  embedding: Object.freeze({
    mode: 'hash',
    baseUrl: '',
    model: '',
    dim: 0,
    apiKey: '',
  }),
  rerank: Object.freeze({
    enabled: false,
    baseUrl: '',
    model: '',
    apiKey: '',
  }),
});

export const LOCAL_PRESET = Object.freeze({
  mode: 'local',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'bge-m3',
  dim: 1024,
});

export const REMOTE_PRESET = Object.freeze({
  mode: 'remote',
  baseUrl: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dim: 1536,
});

export function modelConfigPath(dataRoot) {
  return path.join(path.resolve(String(dataRoot ?? '.')), FILE);
}

function clean(value) {
  return String(value ?? '').trim();
}

export function readModelConfig(dataRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(modelConfigPath(dataRoot), 'utf8'));
    return normalizeModelConfig(parsed);
  } catch {
    return normalizeModelConfig({});
  }
}

export function normalizeModelConfig(input = {}) {
  const embedding = input.embedding ?? {};
  const rerank = input.rerank ?? {};
  const mode = ['off', 'hash', 'local', 'remote'].includes(embedding.mode) ? embedding.mode : 'hash';
  return {
    embedding: {
      mode,
      baseUrl: clean(embedding.baseUrl),
      model: clean(embedding.model),
      dim: Math.max(0, Math.min(8192, Number(embedding.dim) || 0)),
      apiKey: clean(embedding.apiKey),
    },
    rerank: {
      enabled: rerank.enabled === true,
      baseUrl: clean(rerank.baseUrl),
      model: clean(rerank.model),
      apiKey: clean(rerank.apiKey),
    },
  };
}

export function effectiveModelConfig(dataRoot) {
  return readModelConfig(dataRoot);
}

export function redactedModelConfig(config = {}) {
  const value = normalizeModelConfig(config);
  return {
    embedding: {
      mode: value.embedding.mode,
      baseUrl: value.embedding.baseUrl,
      model: value.embedding.model,
      dim: value.embedding.dim,
      apiKeySet: Boolean(value.embedding.apiKey),
    },
    rerank: {
      enabled: value.rerank.enabled,
      baseUrl: value.rerank.baseUrl,
      model: value.rerank.model,
      apiKeySet: Boolean(value.rerank.apiKey),
    },
  };
}

export function saveModelConfig(dataRoot, input = {}, { confirm = false } = {}) {
  if (confirm !== true) throw new Error('model config change requires confirm:true');
  const current = readModelConfig(dataRoot);
  const embedding = { ...current.embedding, ...(input.embedding ?? {}) };
  const rerank = { ...current.rerank, ...(input.rerank ?? {}) };
  if (embedding.mode === 'local') {
    if (!embedding.baseUrl) embedding.baseUrl = LOCAL_PRESET.baseUrl;
    if (!embedding.model) embedding.model = LOCAL_PRESET.model;
    if (!embedding.dim) embedding.dim = LOCAL_PRESET.dim;
  }
  if (embedding.mode === 'remote') {
    if (!embedding.baseUrl) embedding.baseUrl = REMOTE_PRESET.baseUrl;
    if (!embedding.model) embedding.model = REMOTE_PRESET.model;
    if (!embedding.dim) embedding.dim = REMOTE_PRESET.dim;
  }
  if ((embedding.mode === 'local' || embedding.mode === 'remote') && (!embedding.baseUrl || !embedding.model)) {
    throw new Error('embedding mode needs baseUrl and model');
  }
  if (embedding.mode === 'remote' && !embedding.apiKey) {
    throw new Error('remote embedding needs apiKey (use local mode for a keyless local service)');
  }
  if (rerank.enabled && (!rerank.baseUrl || !rerank.model)) throw new Error('rerank needs baseUrl and model');
  const next = normalizeModelConfig({ embedding, rerank });
  const file = modelConfigPath(dataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  return { path: file, config: redactedModelConfig(next) };
}
