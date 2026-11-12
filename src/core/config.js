import os from 'node:os';
import path from 'node:path';
import { clamp } from './time.js';
import { profileDataRoot } from './profile.js';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const DEFAULT_ROOT = process.env.CORTEX_HOME || path.join(DSH_HOME, 'cortex');

export const DEFAULT_CONFIG = Object.freeze({
  dataRoot: DEFAULT_ROOT,
  dbFile: path.join(DEFAULT_ROOT, 'cortex.sqlite'),
  scope: 'global',
  contextBudget: 2200,
  readOnlyScopes: Object.freeze([]),
  scopeWriteGrants: Object.freeze([]),
  identityBudget: 360,
  workingBudget: 800,
  recallTimeoutMs: 1200,
  ftsLimit: 40,
  vectorEnabled: false,
  vectorAnnMin: 20000,
  vectorAnnEngine: 'hnsw',
  vectorAnnEndpoint: '',
  vectorAnnTimeoutMs: 800,
  llmEnabled: false,
  asyncJobs: true,
  dsr: Object.freeze({
    decay: -0.5,
    requestRetention: 0.9,
    maximumStability: 3650,
    archiveRetrievability: 0.35,
    archiveImportance: 0.35,
    minAgeDays: 14,
    reviewCap: 60,
  }),
  compression: Object.freeze({
    coverageThreshold: 0.8,
    minAgeDays: 7,
    keepEvidencePointers: true,
  }),
  features: Object.freeze({
    recall: true,
    capture: true,
    reflect: true,
    growth: true,
    vector: false,
    vectorAnn: false,
    vectorAnnExternal: false,
    attachmentReader: false,
    graph: true,
    llm: false,
    autoDiary: false,
    autoDream: false,
    autoFeeling: false,
    autoEvolve: false,
    aiOnlyLife: false,
    autoGraphCandidates: false,
    aiEdgeReview: false,
    webSearch: false,
  }),
});

function numeric(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

function textPath(value, fallback, base = null) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const trimmed = value.trim();
  if (trimmed === ':memory:' || path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(base || process.cwd(), trimmed);
}

export function normalizeConfig(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const dataRoot = textPath(input.dataRoot, process.env.CORTEX_HOME || profileDataRoot());
  const dbFile = textPath(input.dbFile, path.join(dataRoot, 'cortex.sqlite'), dataRoot);
  const dsrInput = input.dsr && typeof input.dsr === 'object' ? input.dsr : {};
  const compressionInput = input.compression && typeof input.compression === 'object' ? input.compression : {};
  const featuresInput = input.features && typeof input.features === 'object' ? input.features : {};
  const scope = typeof input.scope === 'string' && input.scope.trim() ? input.scope.trim() : DEFAULT_CONFIG.scope;

  return Object.freeze({
    ...DEFAULT_CONFIG,
    ...input,
    dataRoot,
    dbFile,
    scope,
    readOnlyScopes: Object.freeze(Array.isArray(input.readOnlyScopes)
      ? [...new Set(input.readOnlyScopes.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()).slice(0, 100))]
      : []),
    scopeWriteGrants: Object.freeze((() => {
      if (!Array.isArray(input.scopeWriteGrants)) return [];
      const out = [];
      const seen = new Set();
      for (const raw of input.scopeWriteGrants) {
        if (typeof raw === 'string' && /^[^:\s]+:\S+$/.test(raw.trim())) {
          const grant = raw.trim();
          const key = `${grant}\u0000`;
          if (!seen.has(key)) { seen.add(key); out.push(Object.freeze({ grant, until: null })); }
          continue;
        }
        if (raw && typeof raw === 'object' && typeof raw.grant === 'string' && /^[^:\s]+:\S+$/.test(raw.grant.trim())) {
          const grant = raw.grant.trim();
          const until = raw.until == null ? null : String(raw.until).trim();
          if (until && !Number.isFinite(Date.parse(until))) continue;
          const key = `${grant}\u0000${until ?? ''}`;
          if (!seen.has(key)) { seen.add(key); out.push(Object.freeze({ grant, until: until || null })); }
        }
        if (out.length >= 200) break;
      }
      return out;
    })()),
    contextBudget: numeric(input.contextBudget, DEFAULT_CONFIG.contextBudget, 256, 20000),
    identityBudget: numeric(input.identityBudget, DEFAULT_CONFIG.identityBudget, 64, 4000),
    workingBudget: numeric(input.workingBudget, DEFAULT_CONFIG.workingBudget, 128, 8000),
    recallTimeoutMs: numeric(input.recallTimeoutMs, DEFAULT_CONFIG.recallTimeoutMs, 100, 5000),
    ftsLimit: numeric(input.ftsLimit, DEFAULT_CONFIG.ftsLimit, 1, 200),
    vectorEnabled: input.vectorEnabled === true,
    llmEnabled: input.llmEnabled === true,
    asyncJobs: input.asyncJobs !== false,
    dsr: Object.freeze({
      decay: numeric(dsrInput.decay, DEFAULT_CONFIG.dsr.decay, -1, -0.1),
      requestRetention: numeric(dsrInput.requestRetention, DEFAULT_CONFIG.dsr.requestRetention, 0.5, 0.99),
      maximumStability: numeric(dsrInput.maximumStability, DEFAULT_CONFIG.dsr.maximumStability, 30, 36500),
      archiveRetrievability: numeric(dsrInput.archiveRetrievability, DEFAULT_CONFIG.dsr.archiveRetrievability, 0.01, 0.9),
      archiveImportance: numeric(dsrInput.archiveImportance, DEFAULT_CONFIG.dsr.archiveImportance, 0, 1),
      minAgeDays: numeric(dsrInput.minAgeDays, DEFAULT_CONFIG.dsr.minAgeDays, 0, 3650),
      reviewCap: numeric(dsrInput.reviewCap, DEFAULT_CONFIG.dsr.reviewCap, 1, 3650),
    }),
    compression: Object.freeze({
      coverageThreshold: numeric(compressionInput.coverageThreshold, DEFAULT_CONFIG.compression.coverageThreshold, 0.1, 1),
      minAgeDays: numeric(compressionInput.minAgeDays, DEFAULT_CONFIG.compression.minAgeDays, 0, 3650),
      keepEvidencePointers: compressionInput.keepEvidencePointers !== false,
    }),
    features: Object.freeze({
      ...DEFAULT_CONFIG.features,
      ...featuresInput,
      recall: featuresInput.recall !== false,
      capture: featuresInput.capture !== false,
      reflect: featuresInput.reflect !== false,
      growth: featuresInput.growth !== false,
      vector: featuresInput.vector === true,
      graph: featuresInput.graph !== false,
      llm: featuresInput.llm === true,
    }),
  });
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('config must be an object');
  if (!config.dbFile) throw new Error('dbFile is required');
  return config;
}
