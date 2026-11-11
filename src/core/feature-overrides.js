import fs from 'node:fs';
import path from 'node:path';

export const OVERRIDE_KEYS = Object.freeze(['llm', 'rerank', 'capture', 'recall', 'reflect', 'growth', 'graph', 'vector', 'autoFacts', 'llmFacts', 'consolidateOnSleep', 'consolidateOnTick', 'tieredRecall']);
const FILE = 'feature-overrides.json';
const MAX_HISTORY = 20;

export function overridesPath(dataRoot) {
  return path.join(path.resolve(String(dataRoot ?? '.')), FILE);
}

export function readOverrides(dataRoot) {
  const file = overridesPath(dataRoot);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { version: 1, current: {}, history: [] };
    return {
      version: 1,
      current: parsed.current && typeof parsed.current === 'object' ? parsed.current : {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { version: 1, current: {}, history: [] };
  }
}

export function loadFeatureOverrides(config = {}) {
  const dataRoot = config.dataRoot ?? path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'), 'cortex');
  return readOverrides(dataRoot).current;
}

export function effectiveFeatures(config = {}) {
  const overrides = loadFeatureOverrides(config);
  const features = { ...(config.features ?? {}) };
  for (const key of ['llm', 'capture', 'recall', 'reflect', 'growth', 'graph', 'vector', 'autoFacts', 'llmFacts', 'consolidateOnSleep', 'consolidateOnTick', 'tieredRecall']) {
    if (typeof overrides[key] === 'boolean') features[key] = overrides[key];
  }
  if (typeof overrides.rerank === 'boolean') features.rerank = overrides.rerank;
  return { features, overrides };
}

export function writeOverride(dataRoot, key, value) {
  if (!OVERRIDE_KEYS.includes(key)) throw new Error(`override key not allowed: ${key}`);
  if (typeof value !== 'boolean') throw new Error('override value must be boolean');
  const file = overridesPath(dataRoot);
  const state = readOverrides(dataRoot);
  const from = state.current[key] ?? null;
  state.current = { ...state.current, [key]: value };
  state.history = [...state.history, { at: new Date().toISOString(), key, from, to: value }].slice(-MAX_HISTORY);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return { file, key, from, to: value, current: state.current };
}

export function rollbackOverride(dataRoot) {
  const file = overridesPath(dataRoot);
  const state = readOverrides(dataRoot);
  const last = state.history.at(-1);
  if (!last || !OVERRIDE_KEYS.includes(last.key)) return { rolledBack: false, reason: 'no-history' };
  state.current = { ...state.current };
  if (last.from === null) delete state.current[last.key];
  else state.current[last.key] = last.from;
  state.history = state.history.slice(0, -1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return { rolledBack: true, key: last.key, value: state.current[last.key] ?? null, current: state.current };
}
