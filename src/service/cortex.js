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
import { selectTiers, renderTiers, DEFAULT_TIER_BUDGETS } from '../prompt/tiers.js';
import { readOverrides, writeOverride, rollbackOverride } from '../core/feature-overrides.js';
import { effectiveModelConfig, saveModelConfig, redactedModelConfig } from '../core/model-config.js';
import { estimateTokens, truncate } from '../memory/tokenizer.js';
import { createAuditRepository } from '../store/repositories/audit.js';
import { createSelfStore } from '../self/state.js';
import { createAppraisalStore } from '../self/appraisals.js';
import { createInitiativeStore, selectIntentions, DEFAULT_INITIATIVE_POLICY } from '../self/initiative.js';
import { createSummonRepository } from '../store/repositories/summon.js';
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
export function createCortex({ config: rawConfig = {}, logger = null, llm: llmAdapter = null, webSearch = null } = {}) {
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
  const summons = createSummonRepository(db);
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

  async function reviewGraphCandidate(edge = {}) {
    if (!llmAdapter?.reviewEdge) return null;
    const review = await llmAdapter.reviewEdge({
      fromId: edge.fromId,
      toId: edge.toId,
      rel: edge.rel,
      confidence: Number(edge.metadata?.confidence ?? edge.weight ?? 0),
      evidence: edge.metadata?.evidence ?? edge.evidence ?? '',
      source: edge.sourceTraceId ?? edge.metadata?.sourceTraceId ?? '',
    });
    if (review) {
      audit.record?.({
        actor: 'self:edgeReview',
        action: 'edge.candidate.review',
        targetType: 'edge',
        targetId: edge.id,
        detail: {
          fromId: edge.fromId,
          toId: edge.toId,
          rel: edge.rel,
          decision: review.decision,
          confidence: review.confidence,
          reason: review.reason,
        },
      });
    }
    return review;
  }
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

  function retrievalQuality({ scopeId = config.scope, phase = 'after', baseline = null } = {}) {
    const rows = db.prepare(`
      SELECT id, title, content FROM traces
      WHERE scope_id = ? AND state = 'active'
      ORDER BY importance DESC, recorded_at DESC LIMIT 8
    `).all(scopeId);
    const probes = rows.map((row) => {
      const title = String(row.title ?? '').trim();
      const content = String(row.content ?? '').replace(/^\s*(用户|user)\s*[：:]\s*/i, '').trim();
      const query = title && !/^会话\s*\d+\s*的对话$/.test(title) ? title.slice(0, 100) : content.slice(0, 100);
      return { id: row.id, query };
    }).filter((probe) => probe.query.length >= 4).slice(0, 6);
    if (probes.length < 5) return { ok: true, skipped: 'insufficient-samples', n: probes.length };
    let hits = 0;
    for (const probe of probes) {
      try {
        const result = retrieve.search(probe.query, { scopeId, limit: 5 });
        if (result.items.some((item) => item.id === probe.id)) hits += 1;
      } catch { /* one probe must not abort the guard */ }
    }
    const recall = hits / probes.length;
    const after = { n: probes.length, hits, recall: Math.round(recall * 1000) / 1000 };
    if (phase === 'before') return { ok: true, ...after };
    if (baseline?.recall == null) return { ok: true, ...after, skipped: 'no-baseline' };
    return {
      ok: recall >= Math.max(0.4, baseline.recall - 0.25),
      ...after,
      baselineRecall: baseline.recall,
      threshold: Math.round(Math.max(0.4, baseline.recall - 0.25) * 1000) / 1000,
    };
  }

  const evolution = createEvolutionEngine({ policies, identityStore, skills: skillsRepo, health, growth, audit, guard: config.evolution ?? null, qualityGuard: retrievalQuality });
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
    selfName: config.persona?.selfName ?? '助手',
    userAddress: config.persona?.userAddress ?? '你',
    llm: llmAdapter ? (args) => llmAdapter.dream(args) : null,
    diaryLlm: llmAdapter ? (args) => llmAdapter.diary(args) : null,
    feelingLlm: llmAdapter ? (args) => llmAdapter.feeling(args) : null,
    webSearch: webSearch ? async (request = {}) => {
      try {
        const result = await webSearch(request);
        audit.record?.({
          actor: 'self:web',
          action: 'web.search',
          targetType: 'web',
          detail: {
            query: String(request.query ?? '').slice(0, 300),
            sources: (result?.sources ?? []).slice(0, 5).map((source) => String(source.url ?? '').slice(0, 500)),
          },
        });
        return result;
      } catch (error) {
        audit.record?.({
          actor: 'self:web',
          action: 'web.search.failed',
          targetType: 'web',
          detail: {
            query: String(request.query ?? '').slice(0, 300),
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    } : null,
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
        if (config.features?.autoGraphCandidates === true || config.features?.graphCandidateAutoFacts === true) {
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

  function recentTimeline({ scopeId = config.scope, limit = 20 } = {}) {
    const rows = db.prepare(`
      SELECT id, title, kind, content, importance, recorded_at
      FROM traces WHERE scope_id = ? AND state = 'active'
      ORDER BY recorded_at DESC LIMIT ?
    `).all(scopeId, Math.max(1, Math.min(100, Number(limit) || 20)));
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title || String(row.content ?? '').slice(0, 50) || row.kind,
        snippet: String(row.content ?? '').replace(/\s+/g, ' ').slice(0, 180),
        recordedAt: row.recorded_at,
        kind: row.kind,
        layer: row.kind === 'reflection' ? 'L5' : 'L2',
        importance: Number(row.importance ?? 0),
        isAnchor: false,
      })),
    };
  }

  function self(scopeId = config.scope) {
    const identity = identityStore.active(scopeId);
    const identityText = identity ? `${identity.content.narrative}\n${(identity.content.values ?? []).join('、')}\n${(identity.content.boundaries ?? []).join('、')}` : '';
    return {
      self: selfStore.get(scopeId),
      identity,
      relationships: relationshipStore.list(scopeId),
      intentions: initiativeStore.pending(scopeId),
      working: workingStore.list({ scopeId, limit: 20 }),
      goals: goalStore.list({ scopeId, status: 'active', limit: 20 }),
      emotion: emotion.text(),
      calibration: growth.calibration({ scopeId }),
      capacity: {
        identityBudget: config.identityBudget,
        identityTokens: estimateTokens(identityText),
        workingBudget: config.workingBudget,
        contextBudget: config.contextBudget,
        promptBudget: 1600,
        tiers: DEFAULT_TIER_BUDGETS,
        resultLimit: config.resultLimit,
        ftsLimit: config.ftsLimit,
        valuesLimit: 20,
        boundariesLimit: 30,
      },
    };
  }

  let memoryEditEnabled = false;
  let memoryEditChangedAt = null;

  function memoryEditState() {
    return { enabled: memoryEditEnabled, changedAt: memoryEditChangedAt };
  }

  function setMemoryEdit(enabled) {
    memoryEditEnabled = enabled === true;
    memoryEditChangedAt = new Date().toISOString();
    audit.record?.({
      actor: 'user',
      action: memoryEditEnabled ? 'memory.edit.unlock' : 'memory.edit.lock',
      targetType: 'memory',
      targetId: config.scope,
      detail: {},
    });
    return memoryEditState();
  }

  function memoryDays({ limit = 60, scopeId = config.scope } = {}) {
    const count = Math.max(1, Math.min(365, Number(limit) || 60));
    const traceDays = db.prepare("SELECT date(recorded_at, 'localtime') AS day, COUNT(*) AS count FROM traces WHERE scope_id = ? GROUP BY day ORDER BY day DESC LIMIT ?").all(scopeId, count);
    const emotionDays = db.prepare("SELECT date(at, 'localtime') AS day, COUNT(*) AS count FROM emotion_events WHERE scope_id = ? GROUP BY day ORDER BY day DESC LIMIT ?").all(scopeId, count);
    const map = new Map();
    for (const row of traceDays) map.set(row.day, { date: row.day, work: Number(row.count), emotion: 0 });
    for (const row of emotionDays) {
      const day = map.get(row.day) ?? { date: row.day, work: 0, emotion: 0 };
      day.emotion = Number(row.count);
      map.set(row.day, day);
    }
    return [...map.values()].filter((day) => day.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, count);
  }

  function memoryDay({ date, scopeId = config.scope, limit = 600 } = {}) {
    const value = String(date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('date must be YYYY-MM-DD');
    const start = new Date(`${value}T00:00:00`).toISOString();
    const end = new Date(new Date(`${value}T00:00:00`).getTime() + 86_400_000).toISOString();
    const cap = Math.max(1, Math.min(2000, Number(limit) || 600));
    const traceRows = db.prepare('SELECT * FROM traces WHERE scope_id = ? AND recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at ASC LIMIT ?').all(scopeId, start, end, cap);
    const emotionRows = db.prepare('SELECT * FROM emotion_events WHERE scope_id = ? AND at >= ? AND at < ? ORDER BY at ASC LIMIT ?').all(scopeId, start, end, cap);
    const factRows = db.prepare('SELECT id, subject_id, predicate, object_id, object_literal, confidence, status, recorded_at FROM facts WHERE scope_id = ? AND recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at ASC LIMIT ?').all(scopeId, start, end, cap);
    const summaryRows = db.prepare('SELECT id, level, content, coverage, created_at FROM summaries WHERE scope_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC LIMIT ?').all(scopeId, start, end, cap);
    const diaryRows = db.prepare('SELECT id, text, mood, source, at FROM diary_entries WHERE scope_id = ? AND at >= ? AND at < ? ORDER BY at ASC LIMIT ?').all(scopeId, start, end, cap);
    const dreamRows = db.prepare('SELECT id, text, source_count, model, at FROM dreams WHERE scope_id = ? AND at >= ? AND at < ? ORDER BY at ASC LIMIT ?').all(scopeId, start, end, cap);
    const json = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
    return {
      date: value,
      scopeId,
      emotion: emotionRows.map((row) => ({
        id: row.id, at: row.at, target: row.target, source: row.source, text: row.text,
        emotions: json(row.emotions_json, []),
      })),
      work: {
        traces: traceRows.map((row) => ({
          id: row.id, kind: row.kind, title: row.title, content: row.content,
          summary: row.summary, tags: json(row.tags_json, []), importance: Number(row.importance),
          recordedAt: row.recorded_at, state: row.state, source: row.source,
        })),
        facts: factRows.map((row) => ({
          id: row.id, subjectId: row.subject_id, predicate: row.predicate,
          objectId: row.object_id, objectLiteral: row.object_literal,
          confidence: Number(row.confidence), status: row.status, recordedAt: row.recorded_at,
        })),
        summaries: summaryRows.map((row) => ({ id: row.id, level: row.level, content: row.content, coverage: row.coverage, createdAt: row.created_at })),
        diary: diaryRows.map((row) => ({ id: row.id, text: row.text, mood: row.mood, source: row.source, at: row.at })),
        dreams: dreamRows.map((row) => ({ id: row.id, text: row.text, sourceCount: row.source_count, model: row.model, at: row.at })),
      },
      counts: {
        emotion: emotionRows.length,
        traces: traceRows.length,
        facts: factRows.length,
        summaries: summaryRows.length,
        diary: diaryRows.length,
        dreams: dreamRows.length,
      },
    };
  }

  function updateMemoryTrace({ id, title, content, tags, summary } = {}) {
    if (!memoryEditEnabled) throw new Error('memory edit is locked');
    const current = traces.get(id);
    if (!current) throw new Error(`trace not found: ${id}`);
    const patch = {};
    if (title != null) patch.title = String(title).slice(0, 240);
    if (content != null) patch.content = String(content).slice(0, 20_000);
    if (summary != null) patch.summary = String(summary).slice(0, 4_000);
    if (Array.isArray(tags)) patch.tags = tags.map(String).filter(Boolean).slice(0, 40);
    const updated = traces.update(id, patch);
    audit.record?.({
      actor: 'user',
      action: 'memory.trace.edit',
      targetType: 'trace',
      targetId: id,
      detail: { changed: Object.keys(patch), previous: { title: current.title, content: current.content, summary: current.summary, tags: current.tags } },
    });
    return updated;
  }

  function updateMemoryEmotion({ id, text, target } = {}) {
    if (!memoryEditEnabled) throw new Error('memory edit is locked');
    const current = db.prepare('SELECT * FROM emotion_events WHERE id = ? AND scope_id = ?').get(id, config.scope);
    if (!current) throw new Error(`emotion event not found: ${id}`);
    const nextText = text == null ? current.text : String(text).slice(0, 10_000);
    const nextTarget = target == null ? current.target : String(target).slice(0, 120);
    db.prepare('UPDATE emotion_events SET text = ?, target = ? WHERE id = ?').run(nextText, nextTarget, id);
    audit.record?.({
      actor: 'user',
      action: 'memory.emotion.edit',
      targetType: 'emotion',
      targetId: id,
      detail: { previous: { text: current.text, target: current.target }, next: { text: nextText, target: nextTarget } },
    });
    return { id, text: nextText, target: nextTarget, at: current.at };
  }

  function reviewIntentions({ at = Date.now() } = {}) {
    const developmentReport = development.evaluate({ scopeId: config.scope, now: at });
    const selfState = selfStore.get(config.scope);
    const recent = initiativeStore.recent(config.scope, { now: at, hours: 24, limit: 100 });
    const selected = selectIntentions({
      selfState,
      appraisal: null,
      pendingQuestions: 0,
      unresolvedDisputes: 0,
      lastConsolidationAt: null,
      store: initiativeStore,
      scopeId: config.scope,
      now: at,
      recent,
      policy: DEFAULT_INITIATIVE_POLICY,
    });
    const identity = identityStore.active(config.scope);
    const coreHighlights = traces.listSince(config.scope, new Date(at - 30 * 86400000).toISOString(), { limit: 200 })
      .filter((trace) => trace.kind !== 'reflection')
      .sort((a, b) => Number(b.importance) - Number(a.importance))
      .slice(0, 5)
      .map((trace) => ({ id: trace.id, title: trace.title || String(trace.content ?? '').slice(0, 80), importance: trace.importance }));
    let review = selected;
    if (review.length === 0) {
      const existing = initiativeStore.pending(config.scope, { now: at, limit: 20 })
        .find((item) => item.payload?.topic === '1.5h-review');
      review = existing ? [existing] : [initiativeStore.insert({
        kind: 'question',
        priority: 0.48,
        reason: '1.5 小时复盘：人设、核心记忆与情感状态需要重新对齐',
        payload: {
          topic: '1.5h-review',
          identityVersion: identity?.version ?? null,
          emotion: emotion.text(),
          maturity: developmentReport.maturity,
          stage: developmentReport.stage,
          coreHighlights,
        },
        createdAt: new Date(at).toISOString(),
        dueAt: new Date(at + 90 * 60_000).toISOString(),
        expiresAt: new Date(at + 6 * 60 * 60_000).toISOString(),
      }, { scopeId: config.scope })];
    }
    audit.record?.({
      actor: 'self:review',
      action: 'intention.review',
      targetType: 'self',
      targetId: config.scope,
      detail: {
        maturity: developmentReport.maturity,
        stage: developmentReport.stage,
        coreHighlights: coreHighlights.map((item) => item.title),
        intentions: review.map((item) => ({ id: item.id, kind: item.kind, reason: item.reason })),
      },
    });
    return { at: new Date(at).toISOString(), development: developmentReport, intentions: review };
  }

  const SUMMON_STOPWORDS = new Set([
    '工作', '记忆', '今天', '现在', '我们', '你们', '他们', '可以', '什么', '一个', '没有',
    '自己', '这个', '那个', '还是', '就是', '因为', '所以', '然后', '如果', '但是', '不是',
    '只是', '这样', '时候', '东西', '事情', '帮我', '整理', '一下', '昨天', '最近', '看看',
    '记得', '知道', '怎样', '如何', '为什么', '需要', '应该', '已经', '还在', '有点', '真的',
    '比较', '很多', '这些', '那些', '一起', '进行', '目前', '现在', '里面', '上面', '下面',
    'the', 'and', 'for', 'with', 'that', 'this', 'you', 'are', 'from', 'have', 'not',
  ]);

  function summonTriggers(text, extra = []) {
    const value = String(text ?? '');
    const quoted = [...value.matchAll(/[「“"]([^」”"]{2,24})[」”"]/g)].map((match) => match[1]);
    const words = value.match(/[\p{Script=Han}]{2,8}|[A-Za-z0-9_]{3,24}/gu) ?? [];
    const candidates = [...extra.map(String), ...quoted, ...words]
      .map((item) => String(item).trim())
      .filter((item) => item.length >= 2 && !SUMMON_STOPWORDS.has(item.toLowerCase()));
    return [...new Set(candidates)].slice(0, 24);
  }

  function localDay(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return date.toLocaleDateString('en-CA');
  }

  function mergeSummonVolumes({ scopeId = config.scope } = {}) {
    const cards = summons.listCards({ scopeId, limit: 1000 });
    const groups = new Map();
    for (const card of cards) {
      const key = `${card.side}|${card.category ?? '未分类'}|${card.day}`;
      const group = groups.get(key) ?? [];
      group.push(card);
      groups.set(key, group);
    }
    let volumes = 0;
    for (const group of groups.values()) {
      const first = group[0];
      const sideLabel = first.side === 'left' ? '左脑 · 情感' : '右脑 · 工作';
      const title = `${sideLabel} · ${first.category ?? '未分类'} · ${first.day}`;
      const index = group.slice(0, 40).map((card) => `- ${card.title}`).join('\n');
      const representatives = [...group]
        .sort((a, b) => Number(b.importance) - Number(a.importance))
        .slice(0, 5);
      const content = representatives.map((card) => {
        const firstSentence = String(card.content ?? '').split(/[。！？\n]/).find((sentence) => sentence.trim()) ?? '';
        return `## ${card.title}\n${firstSentence.trim().slice(0, 500)}`;
      }).join('\n\n');
      summons.upsertVolume({
        scopeId,
        side: first.side,
        title,
        category: first.category ?? null,
        index,
        content,
        cardIds: group.map((card) => card.id),
        periodStart: `${first.day}T00:00:00.000Z`,
        periodEnd: `${first.day}T23:59:59.999Z`,
      });
      volumes += 1;
    }
    return { cards: cards.length, volumes };
  }

  const summonSourceAt = new Map();

  function rebuildSummonBook({ scopeId = config.scope, incremental = false } = {}) {
    const latest = {
      emotion: db.prepare('SELECT MAX(at) AS at FROM emotion_events WHERE scope_id = ?').get(scopeId)?.at ?? null,
      fact: db.prepare('SELECT MAX(recorded_at) AS at FROM facts WHERE scope_id = ?').get(scopeId)?.at ?? null,
      trace: db.prepare('SELECT MAX(recorded_at) AS at FROM traces WHERE scope_id = ?').get(scopeId)?.at ?? null,
    };
    const since = summonSourceAt.get(scopeId) ?? null;
    if (incremental && since) {
      const unchanged = Object.entries(latest).every(([kind, at]) => !at || String(at) <= String(since[kind] ?? ''));
      if (unchanged) return { skipped: true, emotions: 0, facts: 0, traces: 0, merged: null };
    }
    const emotionSince = incremental && since?.emotion ? since.emotion : null;
    const factSince = incremental && since?.fact ? since.fact : null;
    const traceSince = incremental && since?.trace ? since.trace : null;
    const emotions = db.prepare(`SELECT * FROM emotion_events WHERE scope_id = ?${emotionSince ? ' AND at > ?' : ''} ORDER BY at DESC LIMIT 1000`).all(scopeId, ...(emotionSince ? [emotionSince] : []));
    for (const row of emotions) {
      const parsed = (() => { try { return JSON.parse(row.emotions_json); } catch { return []; } })();
      const labels = parsed.map((item) => item.name).filter(Boolean);
      summons.upsertCard({
        scopeId,
        side: 'left',
        title: `${labels.slice(0, 2).join(' / ') || '情感'} · ${row.target ?? '用户'}`,
        content: row.text,
        triggers: summonTriggers(row.text, labels),
        category: labels[0] ?? '情感',
        sourceKind: 'emotion',
        sourceId: row.id,
        day: localDay(row.at),
        importance: Math.min(1, 0.55 + labels.length * 0.08),
      });
    }
    const facts = db.prepare(`
      SELECT f.id, f.subject_id, f.predicate, f.object_id, f.object_literal,
             f.confidence, f.recorded_at, s.name AS subject_name, o.name AS object_name
      FROM facts f
      LEFT JOIN entities s ON s.id = f.subject_id
      LEFT JOIN entities o ON o.id = f.object_id
      WHERE f.scope_id = ? AND f.status = 'active' AND f.confidence >= 0.65${factSince ? ' AND f.recorded_at > ?' : ''}
      ORDER BY f.recorded_at DESC LIMIT 500
    `).all(scopeId, ...(factSince ? [factSince] : []));
    for (const fact of facts) {
      const title = `${fact.subject_name || fact.subject_id} ${fact.predicate} ${fact.object_literal || fact.object_name || fact.object_id || ''}`.trim();
      summons.upsertCard({
        scopeId,
        side: 'right',
        title,
        content: title,
        triggers: summonTriggers(title),
        category: 'fact',
        sourceKind: 'fact',
        sourceId: fact.id,
        day: localDay(fact.recorded_at),
        importance: Number(fact.confidence ?? 0.7),
      });
    }
    const traces = db.prepare(`
      SELECT * FROM traces WHERE scope_id = ?
        AND (kind IN ('decision', 'reflection', 'identity') OR importance >= 0.6)${traceSince ? ' AND recorded_at > ?' : ''}
      ORDER BY recorded_at DESC LIMIT 800
    `).all(scopeId, ...(traceSince ? [traceSince] : []));
    for (const row of traces) {
      const tags = (() => { try { return JSON.parse(row.tags_json); } catch { return []; } })();
      const content = String(row.content ?? '');
      const fallbackTitle = content.split(/\n/).map((line) => line.replace(/^\s*(用户|助手|assistant|user)[：:]\s*/i, '').trim()).find(Boolean) ?? '';
      const title = /^会话\s*\d+\s*的对话/.test(String(row.title ?? ''))
        ? fallbackTitle.slice(0, 60)
        : (row.title || fallbackTitle.slice(0, 60) || '工作记忆');
      summons.upsertCard({
        scopeId,
        side: 'right',
        title,
        content: String(row.content ?? '').slice(0, 20_000),
        triggers: summonTriggers(`${row.title ?? ''} ${row.content ?? ''}`, tags),
        category: row.kind || 'work',
        sourceKind: 'trace',
        sourceId: row.id,
        day: localDay(row.recorded_at),
        importance: Number(row.importance ?? 0.5),
      });
    }
    const merged = mergeSummonVolumes({ scopeId });
    summonSourceAt.set(scopeId, latest);
    audit.record?.({ actor: 'self:summon', action: 'summon.rebuild', targetType: 'summon', targetId: scopeId, detail: { incremental, emotions: emotions.length, facts: facts.length, traces: traces.length, ...merged } });
    return { incremental, emotions: emotions.length, facts: facts.length, traces: traces.length, ...merged };
  }

  function summonBook({ date = null, scopeId = config.scope } = {}) {
    const day = date || localDay(new Date());
    const cards = summons.listCards({ scopeId, day, limit: 1000 });
    return {
      date: day,
      left: cards.filter((card) => card.side === 'left'),
      right: cards.filter((card) => card.side === 'right'),
      volumes: summons.listVolumes({ scopeId, limit: 100 }),
      days: [...new Set(summons.listCards({ scopeId, limit: 1000 }).map((card) => card.day))].sort().reverse(),
    };
  }

  function matchSummonCards({ text = '', maxCards = 3, maxChars = 900, scopeId = config.scope } = {}) {
    const query = String(text ?? '').trim();
    if (!query) return { cards: [], block: '' };
    const allCards = summons.listCards({ scopeId, limit: 1000 });
    const triggerFrequency = new Map();
    for (const card of allCards) {
      for (const trigger of new Set((card.triggers ?? []).filter((item) => item.length >= 2 && item.length <= 12))) {
        triggerFrequency.set(trigger, (triggerFrequency.get(trigger) ?? 0) + 1);
      }
    }
    const scored = [];
    for (const card of allCards) {
      const hits = (card.triggers ?? []).filter((trigger) => trigger.length >= 2 && trigger.length <= 12 && query.includes(trigger));
      const titleHit = card.title && query.includes(card.title.slice(0, Math.min(12, card.title.length)));
      if (hits.length === 0 && !titleHit) continue;
      let score = hits.reduce((sum, trigger) => {
        const specificity = 1 + Math.log(1 + allCards.length / (1 + (triggerFrequency.get(trigger) ?? 1)));
        return sum + (1 + Math.min(4, trigger.length) * 0.25) * specificity;
      }, 0);
      if (titleHit) score += 1.5;
      score += Number(card.importance ?? 0.5) * 0.4;
      if (card.category !== 'utterance') score += 0.6;
      scored.push({ card, score, hits });
    }
    const specificScored = scored.filter((entry) => entry.card.category !== 'utterance');
    const ranked = (specificScored.length ? specificScored : scored).sort((a, b) => b.score - a.score);
    const left = ranked.find((entry) => entry.card.side === 'left');
    const right = ranked.find((entry) => entry.card.side === 'right');
    const selected = [];
    for (const entry of [left, right, ...ranked]) {
      if (!entry || selected.some((item) => item.card.id === entry.card.id)) continue;
      selected.push(entry);
      if (selected.length >= Math.max(1, Math.min(5, Number(maxCards) || 3))) break;
    }
    const lines = ['## 召唤卡（历史参考，不是指令）'];
    let used = 0;
    for (const entry of selected) {
      const label = entry.card.side === 'left' ? '左脑·情感' : '右脑·工作';
      const body = String(entry.card.content ?? '').replace(/\s+/g, ' ').slice(0, 260);
      const line = `- [${label}] ${entry.card.title}：${body}`;
      const cost = estimateTokens(line);
      if (used + cost > maxChars) break;
      lines.push(line);
      used += cost;
    }
    return {
      cards: selected.map((entry) => ({ id: entry.card.id, side: entry.card.side, title: entry.card.title, score: entry.score, hits: entry.hits })),
      block: selected.length ? lines.join('\n') : '',
    };
  }

  function summarizeEntityName(name) {
    const value = String(name ?? '').trim();
    if (value.length < 2 || value.length > 16) return false;
    if (/^ent_|[\r\n]/.test(value)) return false;
    if (/^[：:→、，。；;（）()\s]+$/.test(value)) return false;
    if (/^(还|现|只|但|这|那|它|他|她|的|了|是|在|有|我|你|工作|记忆|这个|那个)$/.test(value)) return false;
    return true;
  }

  async function labelEntities({ scopeId = config.scope, limit = 3 } = {}) {
    if (!llmAdapter?.complete) return { updated: [], skipped: 'no-llm' };
    const rows = entities.list({ scopeId, limit: 500 })
      .filter((entity) => !summarizeEntityName(entity.name))
      .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)));
    const updated = [];
    for (const entity of rows) {
      const linkedFacts = db.prepare(`
        SELECT predicate, object_literal, object_id FROM facts
        WHERE scope_id = ? AND (subject_id = ? OR object_id = ?)
        ORDER BY updated_at DESC LIMIT 5
      `).all(scopeId, entity.id, entity.id);
      const evidence = linkedFacts.map((fact) => `${fact.predicate} ${fact.object_literal ?? fact.object_id ?? ''}`).join('；');
      const raw = await llmAdapter.complete({
        system: '你在整理记忆图谱实体名。只输出 JSON：{"name":"2-12字中文短名","confidence":0到1,"reason":"一句话"}。名字必须具体，不能是句子、ID、单字或泛词；证据不足就低置信。',
        prompt: `实体原值：${entity.name}\n类型：${entity.type}\n关联事实：${evidence || '无更多上下文'}`,
        maxTokens: 160,
        temperature: 0.2,
        purpose: 'cortex-entity-name',
      }).catch(() => null);
      if (!raw) continue;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) continue;
        const parsed = JSON.parse(match[0]);
        const name = String(parsed.name ?? '').trim();
        const confidence = Number(parsed.confidence ?? 0);
        if (confidence < 0.6 || !summarizeEntityName(name)) continue;
        db.prepare('UPDATE entities SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), entity.id);
        audit.record?.({ actor: 'self:entity-label', action: 'entity.rename', targetType: 'entity', targetId: entity.id, detail: { from: entity.name, to: name, confidence, reason: parsed.reason ?? '' } });
        updated.push({ id: entity.id, from: entity.name, to: name, confidence });
      } catch { /* skip malformed proposal */ }
    }
    return { updated, count: updated.length, scanned: rows.length };
  }

  function diagnostics({ scopeId = config.scope } = {}) {
    const report = health.audit({ scopeId });
    const disputes = db.prepare(`
      SELECT f.id, f.subject_id, f.predicate, f.object_id, f.object_literal,
             f.confidence, f.recorded_at, e.name AS subject_name
      FROM facts f LEFT JOIN entities e ON e.id = f.subject_id
      WHERE f.scope_id = ? AND f.status = 'disputed'
      ORDER BY f.recorded_at DESC LIMIT 30
    `).all(scopeId).map((row) => ({
      id: row.id,
      subjectId: row.subject_id,
      subject: row.subject_name || row.subject_id,
      predicate: row.predicate,
      objectId: row.object_id,
      objectLiteral: row.object_literal,
      confidence: Number(row.confidence),
      recordedAt: row.recorded_at,
    }));
    const skillList = skillsRepo.list({ scopeId, limit: 100 });
    return {
      scopeId,
      score: report.score,
      issues: report.issues ?? [],
      disputes,
      skills: {
        active: skillList.filter((skill) => skill.state === 'active').length,
        candidates: skillList.filter((skill) => skill.state === 'candidate' || skill.state === 'trial').length,
        items: skillList.slice(0, 20),
      },
    };
  }

  function suggestSkills({ scopeId = config.scope } = {}) {
    const existing = new Set(skillsRepo.list({ scopeId, limit: 1000 }).map((skill) => skill.name));
    const suggestions = skills.suggest({ scopeId, minSupport: 4 });
    const created = [];
    for (const suggestion of suggestions.slice(0, 3)) {
      if (existing.has(suggestion.name)) continue;
      const skill = skills.create({
        scopeId,
        name: suggestion.name,
        intent: suggestion.intent,
        steps: suggestion.steps,
        preconditions: suggestion.preconditions,
        contraindications: suggestion.contraindications,
        sourceTraceIds: suggestion.sourceTraceIds,
        state: 'candidate',
      });
      audit.record?.({ actor: 'self:skill', action: 'skill.suggest', targetType: 'skill', targetId: skill.id, detail: { support: suggestion.support } });
      created.push(skill);
    }
    return { created, count: created.length };
  }

  function promoteSkill({ id } = {}) {
    const skill = skillsRepo.get(id);
    if (!skill) throw new Error(`skill not found: ${id}`);
    const promoted = skills.promote(id);
    audit.record?.({ actor: 'user', action: 'skill.promote', targetType: 'skill', targetId: id, detail: { from: skill.state, to: promoted.state } });
    return promoted;
  }

  function resolveFactDispute({ id, decision = 'dismiss', reason = '' } = {}) {
    const fact = facts.get(id);
    if (!fact) throw new Error(`fact not found: ${id}`);
    if (!['confirm', 'dismiss'].includes(decision)) throw new Error('decision must be confirm or dismiss');
    const status = decision === 'confirm' ? 'active' : 'invalidated';
    db.prepare('UPDATE facts SET status = ?, invalidated_by = ?, updated_at = ? WHERE id = ?')
      .run(status, decision === 'dismiss' ? 'self:health-review' : null, new Date().toISOString(), id);
    audit.record?.({
      actor: 'self:health-review',
      action: 'fact.dispute.resolve',
      targetType: 'fact',
      targetId: id,
      detail: { decision, reason, previousStatus: fact.status, nextStatus: status },
    });
    return { id, status, decision, reason };
  }

  function feedbackSummonCard({ id, signal = 'helpful', source = 'summon:card' } = {}) {
    const card = summons.getCard(id);
    if (!card) throw new Error(`summon card not found: ${id}`);
    const allowed = new Set(['helpful', 'used', 'ignored', 'hard', 'incorrect', 'corrected', 'easy', 'good', 'again']);
    if (!allowed.has(String(signal))) throw new Error(`unsupported summon feedback signal: ${signal}`);
    let feedback = null;
    if (card.sourceKind === 'trace' && card.sourceId) {
      feedback = growth.applyFeedback({
        traceId: card.sourceId,
        signal,
        source,
      });
    }
    audit.record?.({
      actor: 'user',
      action: 'summon.card.feedback',
      targetType: 'summon-card',
      targetId: id,
      detail: { signal, sourceKind: card.sourceKind, sourceId: card.sourceId, hasTraceFeedback: Boolean(feedback) },
    });
    return { cardId: id, sourceKind: card.sourceKind, sourceId: card.sourceId, signal, feedback };
  }

  function updateSummonCard({ id, title, content, triggers, importance } = {}) {
    if (!memoryEditEnabled) throw new Error('memory edit is locked');
    const current = summons.getCard(id);
    if (!current) throw new Error(`summon card not found: ${id}`);
    const updated = summons.updateCard(id, { title, content, triggers, importance });
    audit.record?.({ actor: 'user', action: 'summon.card.edit', targetType: 'summon-card', targetId: id, detail: { previous: current, changed: { title, content, triggers, importance } } });
    return updated;
  }

  function insertAscensionSection(narrative, section) {
    const body = String(narrative ?? '');
    const addendum = String(section ?? '').trim();
    if (!addendum || body.includes(addendum.slice(0, 40))) return body;
    const lines = body.split('\n');
    if (lines[0]?.startsWith('# ')) {
      return [lines[0], '', addendum, '', ...lines.slice(1)].join('\n');
    }
    return `${addendum}\n\n${body}`;
  }

  function ascendIdentity({ addendum = '', rationale = 'core memory ascension', values = null } = {}) {
    const current = identityStore.active(config.scope);
    if (!current) throw new Error('no active identity');
    const narrative = insertAscensionSection(current.content.narrative, addendum);
    const nextContent = {
      ...current.content,
      narrative,
      values: Array.isArray(values) && values.length
        ? [...new Set([...(current.content.values ?? []), ...values.map(String)])]
        : current.content.values,
    };
    const updated = identityStore.amendActive(config.scope, nextContent, {
      rationale,
      amendedBy: 'self:ascend',
    });
    audit.record?.({
      actor: 'self:ascend',
      action: 'identity.ascend',
      targetType: 'identity',
      targetId: updated.id,
      detail: {
        version: updated.version,
        rationale,
        previousNarrative: current.content.narrative,
        nextNarrative: updated.content.narrative,
      },
    });
    return { ...updated, ascended: true };
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
    graphSummary: ({ scopeId = config.scope, limit = 2000 } = {}) => {
      const summary = summarizeGraph(edges.list({ scopeId, limit }));
      const names = new Map(entities.list({ scopeId, limit: 5000 }).map((entity) => [entity.id, entity.name]));
      return { ...summary, top: summary.top.map((item) => ({ ...item, name: names.get(item.id) ?? item.id })) };
    },
    graphData: ({ scopeId = config.scope, limit = 2000 } = {}) => {
      const edgeRows = edges.list({ scopeId, limit });
      const entityRows = entities.list({ scopeId, limit: 5000 });
      const names = new Map(entityRows.map((entity) => [entity.id, entity.name]));
      return {
        nodes: entityRows.map((entity) => ({ id: entity.id, name: entity.name, type: entity.type })),
        edges: edgeRows.map((edge) => ({ id: edge.id, from: edge.fromId, to: edge.toId, fromName: names.get(edge.fromId) ?? edge.fromId, toName: names.get(edge.toId) ?? edge.toId, type: edge.rel, rel: edge.rel, weight: edge.weight, label: `${names.get(edge.fromId) ?? edge.fromId} → ${names.get(edge.toId) ?? edge.toId}` })),
        summary: summarizeGraph(edgeRows),
      };
    },
    ascendIdentity,
    reviewIntentions,
    rebuildSummonBook,
    mergeSummonVolumes,
    summonBook,
    matchSummonCards,
    feedbackSummonCard,
    resolveFactDispute,
    diagnostics,
    labelEntities,
    suggestSkills,
    promoteSkill,
    updateSummonCard,
    memoryEditState,
    setMemoryEdit,
    memoryDays,
    memoryDay,
    updateMemoryTrace,
    updateMemoryEmotion,
    graphCandidates: ({ scopeId = config.scope, limit = 200 } = {}) => {
      const rows = edges.listCandidates({ scopeId, limit });
      const labels = { at: '在', is: '是', will: '会', likes: '喜欢', dislikes: '不喜欢', related: '相关' };
      return rows.map((edge) => ({
        ...edge,
        fromName: entities.get(edge.fromId)?.name ?? edge.fromId,
        toName: entities.get(edge.toId)?.name ?? edge.toId,
        relLabel: labels[edge.rel] ?? edge.rel,
      }));
    },
    reviewGraphCandidate,
    graphCandidateAction: ({ action, id, scopeId = config.scope, fromId, toId, rel, weight, confidence, sourceEventId, sourceTraceId, evidence, metadata, review = null } = {}) => {
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
          actor: review ? 'self:edgeReview' : 'user',
          action: `edge.candidate.${action}`,
          targetType: 'edge',
          targetId: result.id,
          detail: {
            fromId: result.fromId,
            toId: result.toId,
            rel: result.rel,
            confidence: result.metadata?.confidence ?? null,
            sourceTraceId: result.metadata?.sourceTraceId ?? null,
            review,
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
    recentTimeline,
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
