import { openDatabase, migrate, transaction, closeDatabase } from '../store/database.js';
import { createEventRepository } from '../store/repositories/events.js';
import { createTraceRepository } from '../store/repositories/traces.js';
import { createEntityRepository } from '../store/repositories/entities.js';
import { createFactRepository } from '../store/repositories/facts.js';
import { createEdgeRepository } from '../store/repositories/edges.js';
import { createFeedbackRepository } from '../store/repositories/feedback.js';
import { createSummaryRepository } from '../store/repositories/summaries.js';
import { createJobRepository } from '../store/repositories/jobs.js';
import { createSkillRepository } from '../store/repositories/skills.js';
import { createPlaybookRepository } from '../store/repositories/playbook.js';
import { selectTiers, renderTiers } from '../prompt/tiers.js';
import { readOverrides, writeOverride, rollbackOverride } from '../core/feature-overrides.js';
import { effectiveModelConfig, saveModelConfig, redactedModelConfig } from '../core/model-config.js';
import { estimateTokens, truncate } from '../memory/tokenizer.js';
import { createAuditRepository } from '../store/repositories/audit.js';
import { createSelfStore } from '../self/state.js';
import { createAppraisalStore } from '../self/appraisals.js';
import { createInitiativeStore } from '../self/initiative.js';
import { createIdentityStore } from '../self/identity.js';
import { createRelationshipStore } from '../self/relationship.js';
import { createEncodeEngine } from '../engines/encode.js';
import { createRetrievalEngine } from '../engines/retrieve.js';
import { createGrowthEngine } from '../engines/growth.js';
import { createReflectEngine } from '../engines/reflect.js';
import { createSkillEngine } from '../engines/skills.js';
import { createJobRunner } from '../engines/jobs.js';
import { createHealthEngine } from '../engines/health.js';
import { createPrivacyEngine } from '../engines/privacy.js';
import { createDevelopEngine } from '../engines/develop.js';
import { createGraphEngine } from '../engines/graph.js';
import { createNarrativeEngine } from '../engines/narrative.js';
import { createDevelopmentStore, createDevelopmentEngine } from '../self/development.js';
import { createHashEmbedder } from '../vector/embedder.js';
import { createOpenAIEmbedder } from '../vector/providers.js';
import { createVectorIndex } from '../vector/index.js';
import { createHttpReranker } from '../vector/providers.js';
import { createGuardian } from '../guardian/guardian.js';
import { createCircuitBreaker, createBudgetGuard } from '../guardian/circuit.js';
import { createPolicyRepository } from '../self/policies.js';
import { createEvolutionEngine } from '../self/evolution.js';
import { createWorkingStore, createGoalStore, renderWorkingMemory } from '../self/working.js';
import { createEmotionModel } from '../self/emotion.js';
import { exportMarkdown } from '../adapters/markdown.js';
import { importMarkdown, syncMarkdown } from '../adapters/markdown-import.js';
import { createLifeEngine } from '../engines/life.js';
import { createCompressionEngine } from '../engines/compression.js';
import { createFactExtractor } from '../engines/extract.js';
import { extractFactsWithLlm } from '../engines/llm-facts.js';
import { createDigestEngine } from '../engines/digest.js';
import { createAutonomyEngine } from '../engines/autonomy.js';
import { createConsolidationEngine } from '../engines/consolidate.js';
import { createRetentionEngine } from '../engines/retention.js';
import { createQaEngine } from '../engines/qa.js';
import { summarizeGraph } from '../engines/graph-analytics.js';
import { createMetrics } from '../observability/metrics.js';
import { parseQuery } from '../memory/query.js';
import { normalizeAttachments } from '../core/attachments.js';
import { createScopeGrantStore } from '../security/scope-grants.js';
import { inspectLocalAttachment } from '../core/attachment-reader.js';

/**
 * Facade that wires the repositories and engines together. The host plugin and
 * tests both use this; the DB is opened only here, never at import time.
 */
export function createCortex({ config: rawConfig = {}, logger = null, llm: llmAdapter = null } = {}) {
  const { db, config } = openDatabase(rawConfig);
  migrate(db);

  const events = createEventRepository(db);
  const traces = createTraceRepository(db);
  const entities = createEntityRepository(db);
  const facts = createFactRepository(db);
  const edges = createEdgeRepository(db);
  const feedback = createFeedbackRepository(db);
  const summaries = createSummaryRepository(db);
  const jobs = createJobRepository(db);
  const skillsRepo = createSkillRepository(db);
  const playbookRepo = createPlaybookRepository(db);
  const audit = createAuditRepository(db);
  const selfStore = createSelfStore(db);
  const appraisalStore = createAppraisalStore(db);
  const initiativeStore = createInitiativeStore(db);
  const identityStore = createIdentityStore(db);
  const relationshipStore = createRelationshipStore(db);
  const metrics = createMetrics();
  const workingStore = createWorkingStore(db);
  const goalStore = createGoalStore(db);
  const emotion = createEmotionModel({ db, scopeId: config.scope });
  identityStore.ensure(config.scope);
  selfStore.get(config.scope);

  const vectorEnabled = config.features?.vector === true || config.vectorEnabled === true;
  const modelConfig = effectiveModelConfig(config.dataRoot);
  const remoteEmbedding = modelConfig.embedding.mode === 'local' || modelConfig.embedding.mode === 'remote';
  const vectorEmbedder = config.embedder ?? (remoteEmbedding
    ? createOpenAIEmbedder({
      baseUrl: modelConfig.embedding.baseUrl,
      apiKey: modelConfig.embedding.apiKey,
      model: modelConfig.embedding.model,
      dim: modelConfig.embedding.dim,
      timeoutMs: config.embeddingTimeoutMs ?? 15000,
    })
    : createHashEmbedder());
  const vector = vectorEnabled
    ? createVectorIndex({
      db,
      embedder: vectorEmbedder,
      model: config.vectorModel ?? (remoteEmbedding ? modelConfig.embedding.model : undefined),
      dim: config.vectorDim ?? (remoteEmbedding ? modelConfig.embedding.dim : undefined),
      annEnabled: config.features?.vectorAnn === true,
      annMin: config.vectorAnnMin ?? 20000,
      annEngine: config.vectorAnnEngine === 'nsw' ? 'nsw' : 'hnsw',
      annOptions: { M: 24, efConstruction: 200, efSearch: 800 },
      externalAnnEnabled: config.features?.vectorAnnExternal === true,
      externalAnnOptions: { endpoint: config.vectorAnnEndpoint, timeoutMs: config.vectorAnnTimeoutMs },
    })
    : null;

  const encode = createEncodeEngine({ events, traces, entities, facts, edges, audit, vector, config });
  const graph = createGraphEngine({ entities, facts, edges, traces });
  const policies = createPolicyRepository(db);
  const policyConfig = (kind) => {
    try { return policies.active(kind)?.config ?? null; } catch { return null; }
  };
  const retrieve = createRetrievalEngine({ traces, facts, graph, vector, policy: policyConfig, config });
  const compression = createCompressionEngine({ traces, summaries, facts, config });
  const extractor = createFactExtractor({ entities, facts });
  const digest = createDigestEngine({ traces, summaries, emotion, goals: goalStore, feedback, scopeId: config.scope });
  const retention = createRetentionEngine({ traces });
  const growth = createGrowthEngine({ traces, feedback, selfStore, relationshipStore, audit, config });
  const reflect = createReflectEngine({ traces, summaries, encode, config });
  const autonomy = createAutonomyEngine({ initiativeStore, reflect, retrieve, working: workingStore, selfStore, scopeId: config.scope });
  const reranker = (modelConfig.rerank.enabled || config.rerankEnabled === true || config.features?.rerank === true)
    && (modelConfig.rerank.baseUrl || config.rerankBaseUrl)
    ? createHttpReranker({
      baseUrl: modelConfig.rerank.baseUrl || config.rerankBaseUrl,
      apiKey: modelConfig.rerank.apiKey || config.rerankApiKey || '',
      model: modelConfig.rerank.model || config.rerankModel || 'bge-reranker-base',
      timeoutMs: config.rerankTimeoutMs ?? 15000,
    })
    : null;
  const qa = createQaEngine({ cortex: { search: (query, options) => search(query, options), searchAsync: (query, options) => searchAsync(query, options) }, llm: llmAdapter, reranker, limit: config.qa?.limit ?? 8, budget: config.qa?.budget ?? 3000 });
  const narrative = createNarrativeEngine({ traces, summaries });
  const consolidation = createConsolidationEngine({ db, traces, summaries, audit, llm: llmAdapter });
  const skills = createSkillEngine({ skills: skillsRepo, traces });
  const health = createHealthEngine({
    db, events, traces, facts, entities, summaries, feedback, skills: skillsRepo, jobs,
    identityStore, selfStore, config,
  });
  const privacy = createPrivacyEngine({ db, traces, events, audit });
  const evolution = createEvolutionEngine({ policies, identityStore, skills: skillsRepo, health, growth, audit });
  const guardian = createGuardian({ db, config, events, traces, selfStore, identityStore, logger });
  const circuit = createCircuitBreaker({ threshold: config.circuitThreshold ?? 5, cooldownMs: config.circuitCooldownMs ?? 60_000 });
  const budget = createBudgetGuard({ maxCallsPerHour: config.maxCallsPerHour ?? 120, maxTokensPerHour: config.maxTokensPerHour ?? 120_000 });
  const developmentStore = createDevelopmentStore(db);
  const development = createDevelopmentEngine({
    traces, feedback, summaries, skills: skillsRepo, relationships: relationshipStore,
    growth, selfStore, audit, store: developmentStore,
  });
  const life = createLifeEngine({
    db, traces, reflect, development, working: workingStore, emotion, scopeId: config.scope,
    consolidation, features: config.features ?? {},
    llm: llmAdapter ? (args) => llmAdapter.dream(args) : null,
  });
  const develop = createDevelopEngine({
    events, traces, facts, entities, encode, retrieve, selfStore, appraisalStore,
    initiativeStore, identityStore, relationshipStore, emotion, config,
    initiativePolicy: () => policies.active('initiative')?.config ?? null,
  });

  const runner = createJobRunner({
    queue: jobs,
    logger,
    handlers: {
      reflect: (payload) => reflect.reflect({
        scopeId: payload.scopeId ?? config.scope,
        windowDays: payload.windowDays ?? 1,
        maxSources: payload.maxSources ?? 8,
        force: payload.force === true,
      }),
    },
  });

  const llmFactTasks = new Set();
  const readOnlyScopes = new Set(Array.isArray(config.readOnlyScopes) ? config.readOnlyScopes : []);
  const scopeGrantStore = createScopeGrantStore(config.dataRoot);
  let scopeWriteGrants = new Map();

  function rebuildScopeGrants() {
    const persisted = scopeGrantStore.all();
    const revoked = new Set(persisted.revoked);
    const next = new Map();
    const entries = [...(Array.isArray(config.scopeWriteGrants) ? config.scopeWriteGrants : []), ...persisted.grants];
    for (const entry of entries) {
      const grant = typeof entry === 'string' ? entry : entry?.grant;
      const until = typeof entry === 'string' ? null : entry?.until ?? null;
      if (typeof grant !== 'string' || !grant.includes(':') || revoked.has(grant)) continue;
      next.set(grant, until ? Date.parse(until) : null);
    }
    scopeWriteGrants = next;
  }

  rebuildScopeGrants();

  function scopeWritable(scopeId, agentId = null, at = Date.now()) {
    const scope = String(scopeId ?? config.scope);
    if (!readOnlyScopes.has(scope)) return true;
    if (!agentId) return false;
    const key = `${scope}:${agentId}`;
    if (!scopeWriteGrants.has(key)) return false;
    const until = scopeWriteGrants.get(key);
    return until == null || until > at;
  }

  function scopeWritableById(kind, id, agentId = null) {
    const record = kind === 'working'
      ? workingStore.get(id)
      : kind === 'goal'
        ? goalStore.get(id)
        : kind === 'playbook'
          ? playbookRepo.get(id)
          : kind === 'trace'
            ? traces.get(id)
            : null;
    // Missing ids are left to the store's normal null/no-op behavior.
    if (!record) return true;
    return scopeWritable(record.scopeId, agentId);
  }

  function writeInternal(input = {}) {
    const scopeId = input.scopeId ?? config.scope;
    if (!scopeWritable(scopeId)) return { skipped: true, reason: 'scope-read-only', scopeId };
    const attachments = normalizeAttachments(input.attachments);
    const metadata = {
      ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    const result = encode.encode({ ...input, scopeId, metadata });
    if (!result.skipped && config.features?.autoFacts === true && !Array.isArray(input.facts)) {
      try {
        result.autoFacts = extractor.extract({
          scopeId: input.scopeId ?? config.scope,
          text: input.text,
          traceId: result.trace?.id ?? null,
          eventId: result.event?.id ?? null,
          recordedAt: result.trace?.recordedAt ?? null,
        });
        if (config.features?.graphCandidateAutoFacts === true) {
          const queued = [];
          for (const resolution of result.autoFacts.resolved ?? []) {
            const fact = resolution?.fact;
            if (!fact?.subjectId || !fact?.objectId || fact.status !== 'active') continue;
            try {
              const edge = edges.addCandidate({
                scopeId: input.scopeId ?? config.scope,
                fromId: fact.subjectId,
                toId: fact.objectId,
                rel: fact.predicate,
                weight: fact.confidence ?? 0.5,
                confidence: fact.confidence ?? 0.5,
                sourceEventId: result.event?.id ?? null,
                sourceTraceId: result.trace?.id ?? null,
                evidence: { autoFact: true, factId: fact.id ?? null },
              });
              queued.push(edge);
              audit.record?.({ actor: 'system', action: 'edge.candidate.auto', targetType: 'edge', targetId: edge.id, detail: { fromId: edge.fromId, toId: edge.toId, rel: edge.rel } });
            } catch {
              /* fail open per candidate */
            }
          }
          if (queued.length) result.edgeCandidates = [...(result.edgeCandidates ?? []), ...queued];
        }
      } catch {
        result.autoFacts = { candidates: [], resolved: [] };
      }
    }
    if (!result.skipped && config.features?.llmFacts === true && llmAdapter?.available?.() && !Array.isArray(input.facts)) {
      scheduleLlmFacts(result, input);
    }
    return result;
  }

  function scheduleLlmFacts(result, input) {
    const task = new Promise((resolve) => setImmediate(resolve)).then(async () => {
      const scopeId = input.scopeId ?? config.scope;
      const extracted = await extractFactsWithLlm({ llm: llmAdapter, text: input.text });
      if (!extracted.candidates.length) return;
      const seenPredicate = new Set();
      for (const candidate of extracted.candidates) {
        const key = `${candidate.subject}|${candidate.predicate}`;
        if (seenPredicate.has(key)) continue;
        seenPredicate.add(key);
        try {
          const subject = entities.upsert({ scopeId, name: candidate.subject });
          const object = entities.upsert({ scopeId, name: candidate.object });
          facts.resolve({
            scopeId,
            subjectId: subject.id,
            predicate: candidate.predicate,
            objectId: object.id,
            validFrom: result.trace?.recordedAt,
            recordedAt: result.trace?.recordedAt,
            confidence: candidate.confidence,
            sourceEventId: result.event?.id ?? null,
            evidence: [{ eventId: result.event?.id ?? null, traceId: result.trace?.id ?? null, weight: candidate.confidence, text: candidate.object }],
          });
        } catch {
          /* one bad candidate must not poison the rest */
        }
      }
      audit.record?.({ actor: 'llm', action: 'fact.llm_extract', targetType: 'trace', targetId: result.trace?.id ?? null, detail: { candidates: extracted.candidates.length } });
    }).catch(() => null);
    llmFactTasks.add(task);
    task.finally(() => llmFactTasks.delete(task));
  }

  async function flushLlmFacts() {
    await Promise.allSettled([...llmFactTasks]);
  }

  function write(input = {}) {
    const started = Date.now();
    const result = writeInternal(input);
    metrics.inc(result.skipped ? 'writes.skipped' : 'writes.created');
    metrics.observe('write.ms', Date.now() - started);
    return result;
  }

  function writeMany(inputs = [], { chunkSize = 200 } = {}) {
    const items = Array.isArray(inputs) ? inputs : [];
    const results = [];
    const size = Math.max(1, Math.min(1000, Number(chunkSize) || 200));
    for (let index = 0; index < items.length; index += size) {
      const chunk = items.slice(index, index + size);
      const chunkResults = [];
      const started = Date.now();
      transaction(db, () => {
        for (const item of chunk) chunkResults.push(writeInternal(item));
      });
      for (const result of chunkResults) metrics.inc(result.skipped ? 'writes.skipped' : 'writes.created');
      metrics.observe('write.ms', Date.now() - started);
      results.push(...chunkResults);
    }
    return results;
  }

  async function searchAsync(query, options = {}) {
    const started = Date.now();
    if (!options.noBudget && !budget.allow(1)) {
      return { query, intent: 'fact', scopeId: options.scopeId ?? config.scope, items: [], budget: { used: 0, total: 0 }, trace: { elapsedMs: 0, candidates: 0, selected: 0, dropped: 0, sources: [], blocked: 'budget' }, at: new Date().toISOString() };
    }
    if (!circuit.allow()) {
      return { query, intent: 'fact', scopeId: options.scopeId ?? config.scope, items: [], budget: { used: 0, total: 0 }, trace: { elapsedMs: 0, candidates: 0, selected: 0, dropped: 0, sources: [], blocked: 'circuit' }, at: new Date().toISOString() };
    }
    try {
      const parsed = parseQuery(query);
      const result = await retrieve.searchAsync(parsed.text || String(query ?? ''), {
        ...options,
        filters: options.filters ?? parsed.filters,
        scopeId: options.scopeId ?? config.scope,
      });
      if (!options.noBudget) budget.spend(1);
      circuit.success();
      metrics.inc('search.calls');
      metrics.inc('search.hits', result.items.length);
      metrics.observe('search.ms', Date.now() - started);
      return result;
    } catch (error) {
      circuit.failure();
      metrics.inc('search.errors');
      throw error;
    }
  }
  function search(query, options = {}) {
    const started = Date.now();
    const blocked = (reason) => {
      metrics.inc(`search.blocked.${reason}`);
      return {
        query, intent: 'fact', scopeId: options.scopeId ?? config.scope, items: [],
        budget: { used: 0, total: 0 },
        trace: { elapsedMs: 0, candidates: 0, selected: 0, dropped: 0, sources: [], blocked: reason },
        at: new Date().toISOString(),
      };
    };
    if (!options.noBudget && !budget.allow(1)) return blocked('budget');
    if (!circuit.allow()) return blocked('circuit');
    try {
      const parsed = parseQuery(query);
      const result = retrieve.search(parsed.text || String(query ?? ''), {
        ...options,
        filters: options.filters ?? parsed.filters,
        scopeId: options.scopeId ?? config.scope,
      });
      if (!options.noBudget) budget.spend(1);
      circuit.success();
      metrics.inc('search.calls');
      metrics.inc('search.hits', result.items.length);
      metrics.observe('search.ms', Date.now() - started);
      return result;
    } catch (error) {
      circuit.failure();
      metrics.inc('search.errors');
      throw error;
    }
  }

  function get(id) {
    return traces.get(id);
  }

  function timeline(options = {}) {
    return retrieve.timeline({ ...options, scopeId: options.scopeId ?? config.scope });
  }

  function self(scopeId = config.scope) {
    return {
      self: selfStore.get(scopeId),
      identity: identityStore.active(scopeId),
      relationships: relationshipStore.list(scopeId),
      intentions: initiativeStore.pending(scopeId),
      working: workingStore.list({ scopeId, limit: 20 }),
      goals: goalStore.list({ scopeId, status: 'active', limit: 20 }),
      emotion: emotion.text(),
      calibration: growth.calibration({ scopeId }),
    };
  }

  return {
    db,
    config,
    repos: { events, traces, entities, facts, edges, feedback, summaries, jobs, skills: skillsRepo, audit, playbook: playbookRepo },
    stores: { selfStore, appraisalStore, initiativeStore, identityStore, relationshipStore },
    engines: { encode, graph, retrieve, growth, reflect, narrative, skills, health, privacy, develop, development, vector, compression, extractor, runner },
    development,
    narrative,
    vector,
    life,
    llm: llmAdapter,
    consolidation,
    digest,
    autonomy,
    retention,
    qa,
    compression,
    extractor,
    guardian,
    circuit,
    budget,
    policies,
    evolution,
    write,
    writeMany,
    scopeWritable,
    scopeWritableById,
    scopeReadable: () => true,
    metrics: () => metrics.snapshot(),
    models: {
      get: () => redactedModelConfig(effectiveModelConfig(config.dataRoot)),
      save: (input = {}) => {
        const result = saveModelConfig(config.dataRoot, input, { confirm: input.confirm === true });
        audit.record?.({ actor: 'user', action: 'model.config.update', targetType: 'model', targetId: result.path, detail: result.config });
        return { ...result, restartRequired: true };
      },
    },
    attachments: {
      inspect: ({ uri } = {}) => {
        if (config.features?.attachmentReader !== true) throw new Error('attachment reader is disabled');
        const result = inspectLocalAttachment(uri);
        audit.record?.({ actor: 'user', action: 'attachment.inspect', targetType: 'attachment', targetId: result.uri, detail: { bytes: result.bytes, sha256: result.sha256 } });
        return result;
      },
      attach: ({ traceId, attachments } = {}) => {
        const trace = traces.get(traceId);
        if (!trace) throw new Error('trace not found');
        if (!scopeWritableById('trace', traceId)) throw new Error('scope-read-only');
        const next = normalizeAttachments(attachments);
        const merged = [...(Array.isArray(trace.metadata?.attachments) ? trace.metadata.attachments : []), ...next];
        if (merged.length > 8) throw new Error('at most 8 attachments');
        const updated = traces.update(traceId, { metadata: { ...(trace.metadata ?? {}), attachments: merged } });
        audit.record?.({ actor: 'user', action: 'attachment.attach', targetType: 'trace', targetId: traceId, detail: { added: next.length, total: merged.length } });
        return { trace: updated, added: next.length };
      },
    },
    security: {
      grants: () => ({
        grants: [...scopeWriteGrants.entries()].map(([grant, until]) => ({ grant, until: until == null ? null : new Date(until).toISOString() })),
        revoked: scopeGrantStore.all().revoked,
      }),
      addGrant: ({ grant, until = null } = {}) => {
        const entry = scopeGrantStore.add({ grant, until });
        rebuildScopeGrants();
        audit.record?.({ actor: 'user', action: 'scope.grant.add', targetType: 'scope-grant', targetId: entry.grant, detail: { until: entry.until } });
        return entry;
      },
      revokeGrant: ({ grant } = {}) => {
        const value = scopeGrantStore.revoke(grant);
        rebuildScopeGrants();
        audit.record?.({ actor: 'user', action: 'scope.grant.revoke', targetType: 'scope-grant', targetId: value, detail: {} });
        return { grant: value, revoked: true };
      },
    },
    permissions: {
      status: () => readOverrides(config.dataRoot),
      update: ({ key, value, confirm = false } = {}) => {
        if (confirm !== true) throw new Error('permission change requires confirm:true');
        const result = writeOverride(config.dataRoot, key, value);
        audit.record?.({ actor: 'user', action: 'permission.update', targetType: 'feature', targetId: key, detail: { from: result.from, to: result.to } });
        return { ...result, restartRequired: true };
      },
      rollback: () => {
        const result = rollbackOverride(config.dataRoot);
        if (!result.rolledBack) return result;
        audit.record?.({ actor: 'user', action: 'permission.rollback', targetType: 'feature', targetId: result.key, detail: { value: result.value } });
        return { ...result, restartRequired: true };
      },
    },
    settings: () => ({
      scope: config.scope,
      dataRoot: config.dataRoot,
      dbFile: config.dbFile,
      contextBudget: config.contextBudget,
      promptBudget: config.promptBudget,
      features: config.features ?? {},
      readOnlyScopes: [...readOnlyScopes],
      overrides: readOverrides(config.dataRoot).current,
      model: redactedModelConfig(modelConfig),
      permissions: {
        network: {
          llm: config.features?.llm === true,
          remoteEmbedding,
          rerank: modelConfig.rerank.enabled || config.rerankEnabled === true || config.features?.rerank === true,
        },
        localApi: config.features?.api !== false,
        vector: config.features?.vector === true || config.vectorEnabled === true || readOverrides(config.dataRoot).vector === true,
      },
      vector: vector?.status?.() ?? null,
    }),
    report: (scopeId = config.scope) => ({
      at: new Date().toISOString(),
      scopeId,
      health: health.audit({ scopeId }),
      self: self(scopeId),
      guardian: guardian.check(),
      retention: retention.plan({ scopeId, limit: 20 }),
      evolution: evolution.status({ scopeId }),
      metrics: metrics.snapshot(),
    }),
    playbook: {
      add: ({ title, body, tags = [], validTo = null, sourceTraceId = null, scopeId = config.scope } = {}) => playbookRepo.add({ scopeId, title, body, tags, validTo, sourceTraceId }),
      list: ({ status = null, includeExpired = false, scopeId = config.scope, limit = 200 } = {}) => playbookRepo.list({ scopeId, status, includeExpired, limit }),
      get: (id) => playbookRepo.get(id),
      vote: ({ id, signal = 'helpful' } = {}) => playbookRepo.vote(id, signal),
      retire: (id) => playbookRepo.retire(id),
      approve: (id) => playbookRepo.approve(id),
      setValidTo: (id, validTo) => playbookRepo.setValidTo(id, validTo),
      suggest: ({ scopeId = config.scope, limit = 5, now = Date.now() } = {}) => {
        const existing = new Set(playbookRepo.list({ scopeId, includeExpired: true, limit: 500 }).map((rule) => `${rule.title}\u0000${rule.body}`));
        const recentTraces = traces.list({ scopeId, state: 'active', limit: 200 })
          .filter((trace) => trace.kind === 'reflection' || /应该|必须|不要|先|再|每次|以后|记得|避免|优先|禁止|务必/.test(trace.content))
          .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
        const candidates = [];
        const addCandidate = (title, body, sourceTraceId = null) => {
          const cleanTitle = String(title ?? '').trim();
          const cleanBody = String(body ?? '').trim();
          if (!cleanBody || cleanBody.length < 8 || cleanBody.length > 120) return;
          if (!/应该|必须|不要|先|再|每次|以后|记得|避免|优先|禁止|务必/.test(cleanBody)) return;
          const key = `${cleanTitle}\u0000${cleanBody}`;
          if (existing.has(key)) return;
          existing.add(key);
          candidates.push({ title: cleanTitle || cleanBody.slice(0, 28), body: cleanBody, sourceTraceId });
        };
        for (const trace of recentTraces) {
          for (const raw of String(trace.content).split(/[。！？\n；;]+/)) {
            const body = raw.replace(/^[\s\-*#>]+/, '').trim();
            addCandidate(body.length > 28 ? `${body.slice(0, 28)}…` : body, body, trace.id);
            if (candidates.length >= limit) break;
          }
          if (candidates.length >= limit) break;
        }
        // Consolidation decisions are another source of durable rules. Only
        // update/merge carry reusable content; archive/keep/conflict do not.
        if (candidates.length < limit && consolidation?.list) {
          for (const run of consolidation.list({ scopeId, limit: 10 })) {
            for (const decision of run.decisions ?? []) {
              if (decision.action === 'update') addCandidate(String(decision.content ?? '').slice(0, 28), decision.content, decision.ids?.[0] ?? null);
              else if (decision.action === 'merge' && decision.targetId) {
                const target = traces.get(decision.targetId);
                if (target) addCandidate(target.title ?? target.content?.slice(0, 28) ?? '合并准则', target.content, target.id);
              }
              if (candidates.length >= limit) break;
            }
            if (candidates.length >= limit) break;
          }
        }
        const created = candidates.map((candidate) => playbookRepo.add({ ...candidate, scopeId, status: 'candidate' }));
        return { candidates: created, count: created.length, at: new Date(now).toISOString() };
      },
      render: ({ scopeId = config.scope, budget = 260, at = new Date().toISOString() } = {}) => {
        const rules = playbookRepo.active(scopeId, { at, limit: 80 });
        if (!rules.length) return { text: '', count: 0, omitted: 0, budget };
        const lines = [];
        let used = 0;
        let omitted = 0;
        for (const rule of rules) {
          const line = `- [${rule.id}] ${rule.title}：${rule.body}（helpful=${rule.helpful} harmful=${rule.harmful}${rule.validTo ? ` · 到期 ${rule.validTo}` : ''}）`;
          const cost = estimateTokens(line);
          if (used + cost > budget) { omitted += 1; continue; }
          lines.push(line); used += cost;
        }
        return { text: lines.length ? lines.join('\n') : '', count: lines.length, omitted, budget };
      },
    },
    asOf: ({ subject, predicate = null, at = null, mode = 'historical', includeDisputed = true, scopeId = config.scope } = {}) => {      const entity = entities.findByName(scopeId, subject);
      if (!entity) return { subject, mode, at: at ?? new Date().toISOString(), facts: [], reason: 'unknown-subject' };
      const atIso = at == null ? new Date().toISOString() : new Date(at).toISOString();
      if (Number.isNaN(Date.parse(atIso))) throw new Error('at must be a valid date');
      let rows;
      if (mode === 'strict') rows = facts.queryAt({ scopeId, subjectId: entity.id, predicate, at: new Date().toISOString(), includeDisputed: false }).filter((fact) => fact.status === 'active');
      else if (mode === 'belief') rows = facts.queryBeliefAt({ scopeId, subjectId: entity.id, predicate, at: atIso, includeDisputed });
      else if (mode === 'associative') rows = facts.list({ scopeId, subjectId: entity.id, limit: 500 }).filter((fact) => !predicate || fact.predicate === predicate);
      else rows = facts.queryAt({ scopeId, subjectId: entity.id, predicate, at: atIso, includeDisputed });
      const names = new Map();
      const view = rows.map((fact) => {
        if (fact.objectId && !names.has(fact.objectId)) names.set(fact.objectId, entities.get(fact.objectId)?.name ?? fact.objectId);
        return {
          id: fact.id, predicate: fact.predicate,
          object: fact.objectLiteral ?? names.get(fact.objectId) ?? fact.objectId,
          status: fact.status, confidence: fact.confidence,
          validFrom: fact.validFrom, validTo: fact.validTo,
          recordedAt: fact.recordedAt, invalidatedBy: fact.invalidatedBy, supersededAt: fact.supersededAt,
          sourceEventId: fact.sourceEventId,
        };
      });
      return { subject: entity.name, subjectId: entity.id, mode, at: atIso, facts: view };
    },
    graphSummary: ({ scopeId = config.scope, limit = 2000 } = {}) => summarizeGraph(edges.list({ scopeId, limit })),
    graphData: ({ scopeId = config.scope, limit = 2000 } = {}) => {
      const edgeRows = edges.list({ scopeId, limit });
      const entityRows = entities.list({ scopeId, limit: 5000 });
      const names = new Map(entityRows.map((entity) => [entity.id, entity.name]));
      return {
        nodes: entityRows.map((entity) => ({ id: entity.id, name: entity.name, type: entity.type })),
        edges: edgeRows.map((edge) => ({ id: edge.id, from: edge.fromId, to: edge.toId, type: edge.rel, rel: edge.rel, weight: edge.weight, label: `${names.get(edge.fromId) ?? edge.fromId} → ${names.get(edge.toId) ?? edge.toId}` })),
        summary: summarizeGraph(edgeRows),
      };
    },
    graphCandidates: ({ scopeId = config.scope, limit = 200 } = {}) => edges.listCandidates({ scopeId, limit }),
    graphCandidateAction: ({ action, id, scopeId = config.scope, fromId, toId, rel, weight, confidence, sourceEventId, sourceTraceId, evidence, metadata } = {}) => {
      if (!scopeWritable(scopeId)) throw new Error('scope-read-only');
      let result = null;
      if (action === 'add') {
        result = edges.addCandidate({ scopeId, fromId, toId, rel, weight, confidence, sourceEventId, sourceTraceId, evidence, metadata });
      } else if (action === 'approve') {
        result = edges.approveCandidate(id);
      } else if (action === 'reject') {
        result = edges.rejectCandidate(id);
      } else {
        throw new Error('graph candidate action must be add, approve or reject');
      }
      if (result) {
        audit.record?.({
          actor: 'user',
          action: `edge.candidate.${action}`,
          targetType: 'edge',
          targetId: result.id,
          detail: {
            fromId: result.fromId,
            toId: result.toId,
            rel: result.rel,
            confidence: result.metadata?.confidence ?? null,
            sourceTraceId: result.metadata?.sourceTraceId ?? null,
          },
        });
      }
      return result;
    },
    search,
    searchAsync,
    ingestExtractedText: ({ targetTraceId, text, uri, mode, engine } = {}) => {
      const target = traces.get(targetTraceId);
      if (!target) throw new Error('target trace not found');
      if (!scopeWritableById('trace', targetTraceId)) throw new Error('scope-read-only');
      const content = String(text ?? '').trim().slice(0, 20000);
      if (!content) throw new Error('extracted text is empty');
      const result = writeInternal({
        text: content,
        scopeId: target.scopeId,
        kind: 'observation',
        explicit: true,
        source: 'extractor',
        metadata: {
          derivedFrom: targetTraceId,
          extractor: { uri: uri ?? null, mode: mode ?? null, engine: engine ?? null },
        },
        tags: ['extractor', mode].filter(Boolean),
      });
      const extractedId = result?.trace?.id ?? null;
      audit.record?.({
        actor: 'system',
        action: 'attachment.extract.ingest',
        targetType: 'trace',
        targetId: targetTraceId,
        detail: { extractedTraceId: extractedId, uri: uri ?? null, mode: mode ?? null, chars: content.length },
      });
      return { targetTraceId, extractedTraceId: extractedId, chars: content.length };
    },
    flushLlmFacts,
    recallTiered: ({ query, limit = 20, permBudget = 700, hotBudget = 900, coldBudget = 400, scopeId = config.scope, includeArchived = false } = {}) => {
      const result = search(query, { limit, budget: permBudget + hotBudget + coldBudget, scopeId, includeArchived, noBudget: true });
      const selection = selectTiers(result.items, { budgets: { perm: permBudget, hot: hotBudget, cold: coldBudget } });
      return { query, result, selection, text: renderTiers(selection) };
    },
    recallTieredAsync: async ({ query, limit = 20, permBudget = 700, hotBudget = 900, coldBudget = 400, scopeId = config.scope, includeArchived = false } = {}) => {
      const result = await searchAsync(query, { limit, budget: permBudget + hotBudget + coldBudget, scopeId, includeArchived, noBudget: true });
      const selection = selectTiers(result.items, { budgets: { perm: permBudget, hot: hotBudget, cold: coldBudget } });
      return { query, result, selection, text: renderTiers(selection) };
    },
    get,
    timeline,
    step: develop.step,
    feedback: (input) => growth.applyFeedback({ ...input, scopeId: input.scopeId ?? config.scope }),
    forget: (input) => {
      const trace = traces.get(input?.traceId);
      if (trace && !scopeWritable(trace.scopeId)) return { removed: false, reason: 'scope-read-only', traceId: input.traceId };
      return privacy.forget(input);
    },
    privacy,
    reflect: (options = {}) => reflect.reflect({ ...options, scopeId: options.scopeId ?? config.scope }),
    evaluateDevelopment: (options = {}) => development.evaluate({ ...options, scopeId: options.scopeId ?? config.scope }),
    rebuildVector: (options = {}) => vector?.rebuild({ ...options, scopeId: options.scopeId ?? config.scope }) ?? { rebuilt: 0 },
    rebuildVectorAsync: (options = {}) => vector?.rebuildAsync({ ...options, scopeId: options.scopeId ?? config.scope }) ?? Promise.resolve({ rebuilt: 0 }),
    indexVectorAsync: async (traceId, options = {}) => {
      if (!vector || !traceId) return null;
      const trace = traces.get(traceId);
      if (!trace) throw new Error(`trace not found: ${traceId}`);
      return vector.upsertAsync(traceId, `${trace.title ?? ''} ${trace.content ?? ''} ${trace.summary ?? ''}`, options);
    },
    exportMarkdown: (dir, options = {}) => exportMarkdown({
      repos: { traces, facts, entities },
      engines: { skills },
      self,
    }, dir, { ...options, scopeId: options.scopeId ?? config.scope }),
    importMarkdown: (root, options = {}) => importMarkdown({ write }, root, { ...options, scopeId: options.scopeId ?? config.scope }),
    syncMarkdown: (root, options = {}) => syncMarkdown({ repos: { traces, audit }, write }, root, { ...options, scopeId: options.scopeId ?? config.scope }),
    health: (options = {}) => health.audit({ ...options, scopeId: options.scopeId ?? config.scope }),
    self,
    working: workingStore,
    goals: goalStore,
    emotion,
    renderWorking: (options = {}) => renderWorkingMemory(workingStore.list({ scopeId: options.scopeId ?? config.scope }), options),
    enqueueReflect(options = {}) {
      return jobs.enqueue({
        kind: 'reflect',
        scopeId: options.scopeId ?? config.scope,
        payload: { ...options, scopeId: options.scopeId ?? config.scope },
        operationId: options.operationId ?? null,
      });
    },
    runner,
    close() {
      closeDatabase(db);
    },
  };
}
