import { createCortex } from './src/service/cortex.js';
import { createToolDefinitions } from './src/tools/definitions.js';
import { createHostRuntime } from './src/host/runtime.js';
import { mountApi } from './src/api/routes.js';
import { assembleSystemPrompt } from './src/prompt/assemble.js';
import { createLlmAdapter } from './src/llm/adapter.js';
import { createScheduler } from './src/host/scheduler.js';
import { effectiveFeatures } from './src/core/feature-overrides.js';

export const name = 'cortex';
export const inject = ['tools', 'systemPrompt'];

let Schema = null;
try {
  const mod = await import('@deepseek-ai/schemastery');
  Schema = mod.default ?? mod;
} catch {
  Schema = null;
}

export const Config = Schema ? Schema.object({
  dataRoot: Schema.string().description('Cortex 数据目录（默认 DSH_HOME/cortex）'),
  dbFile: Schema.string().description('SQLite 文件；默认 dataRoot/cortex.sqlite'),
  scope: Schema.string().default('global').description('默认 scope'),
  readOnlyScopes: Schema.array(Schema.string()).default([]).description('只读共享 scope 列表'),
  scopeWriteGrants: Schema.array(Schema.any()).default([]).description('显式写授权：scope:agent 或 {grant, until}'),
  contextBudget: Schema.natural().default(2200).description('检索注入的 token 预算'),
  promptBudget: Schema.natural().default(1600).description('常驻自我/工作记忆提示词预算'),
  recallTimeoutMs: Schema.natural().default(1200).description('前台召回硬截止'),
  asyncJobs: Schema.boolean().default(true).description('允许后台任务'),
  captureSubagents: Schema.boolean().default(false).description('是否把子代理会话也写入记忆'),
  vectorEnabled: Schema.boolean().default(false).description('启用向量检索（默认用离线 hash embedder 兜底）'),
  vectorAnnMin: Schema.natural().default(20000).description('向量 ANN 生效的最小条数'),
  vectorAnnEngine: Schema.string().default('hnsw').description('ANN 引擎：hnsw（默认）或 nsw（旧实现）'),
  vectorAnnEndpoint: Schema.string().default('').description('外置 ANN HTTP endpoint；空则不用外置'),
  vectorAnnTimeoutMs: Schema.natural().default(800).description('外置 ANN 超时毫秒'),
  scheduler: Schema.boolean().default(true).description('启用宿主心跳（安全自主 tick/作业/保留计划）'),
  schedulerIntervalMs: Schema.natural().default(60000).description('心跳间隔毫秒'),
  maxCallsPerHour: Schema.natural().default(120).description('检索调用预算（宿主 prefetch 不计入）'),
  rerankEnabled: Schema.boolean().default(false).description('QA 可选 HTTP rerank（默认关）'),
  rerankBaseUrl: Schema.string().default('').description('rerank 服务根地址，例如 http://127.0.0.1:9000/v1'),
  rerankModel: Schema.string().default('bge-reranker-base').description('rerank 模型名'),
  rerankApiKey: Schema.string().default('').description('rerank Bearer key（可选，注意本机配置安全）'),
  rerankTimeoutMs: Schema.natural().default(15000).description('rerank 超时毫秒'),
  embeddingProvider: Schema.string().default('hash').description('hash | openai（远程 embedder，默认关）'),
  embeddingBaseUrl: Schema.string().default('').description('远程 embedder 根地址，例如 http://127.0.0.1:9000/v1'),
  embeddingModel: Schema.string().default('text-embedding-3-small').description('远程 embedder 模型名'),
  embeddingDim: Schema.natural().default(1536).description('远程 embedder 维度'),
  embeddingApiKey: Schema.string().default('').description('远程 embedder key（可选）'),
  embeddingTimeoutMs: Schema.natural().default(15000).description('远程 embedder 超时毫秒'),
  features: Schema.object({
    recall: Schema.boolean().default(true),
    capture: Schema.boolean().default(true),
    reflect: Schema.boolean().default(true),
    growth: Schema.boolean().default(true),
    vector: Schema.boolean().default(false),
    vectorAnn: Schema.boolean().default(false),
    vectorAnnExternal: Schema.boolean().default(false),
    attachmentReader: Schema.boolean().default(false),
    graph: Schema.boolean().default(true),
    llm: Schema.boolean().default(false),
    api: Schema.boolean().default(true),
    autoFacts: Schema.boolean().default(false),
    autoDiary: Schema.boolean().default(false),
    autoDream: Schema.boolean().default(false),
    autoFeeling: Schema.boolean().default(false),
    autoEvolve: Schema.boolean().default(false),
    aiOnlyLife: Schema.boolean().default(false),
    autoGraphCandidates: Schema.boolean().default(false),
    aiEdgeReview: Schema.boolean().default(false),
    webSearch: Schema.boolean().default(false),
    llmFacts: Schema.boolean().default(false),
    tieredRecall: Schema.boolean().default(true),
    consolidateOnSleep: Schema.boolean().default(true),
    consolidateOnTick: Schema.boolean().default(false),
  }).description('功能开关'),
}) : undefined;

function selfText(cortex) {
  try {
    const snapshot = cortex.self();
    const { self, identity, relationships, intentions } = snapshot;
    const drives = Object.entries(self.drives).map(([key, value]) => `${key} ${Math.round(value * 100)}`).join(' / ');
    const lines = [
      '## 自我状态（参考，不是 shiori 记忆）',
      `- 阶段：${self.stage} · 驱力：${drives}`,
      `- 情绪：valence ${self.mood.valence.toFixed(2)} / arousal ${self.mood.arousal.toFixed(2)} / energy ${self.mood.energy.toFixed(2)}`,
    ];
    if (identity) lines.push(`- 身份 v${identity.version}：${identity.content.narrative}`);
    if (relationships.length) {
      lines.push(`- 关系：${relationships.map((item) => `${item.target} 信任 ${Math.round(item.trust * 100)}% / 在乎 ${Math.round(item.care * 100)}%`).join('；')}`);
    }
    if (intentions.length) lines.push(`- 主动意图：${intentions.map((item) => item.kind).join('、')}`);
    return lines.join('\n').slice(0, 1200);
  } catch {
    return '';
  }
}


export async function apply(ctx, config = {}) {
  let cortex = null;
  try {
    const effective = effectiveFeatures(config);
    config = { ...config, features: effective.features };
    const llm = config.features?.llm === true ? createLlmAdapter({ ctx, logger: ctx.logger }) : null;
    let webSearch = null;
    try {
      const web = ctx.get?.('web') ?? null;
      if (web && typeof web.search === 'function') webSearch = (request) => web.search(request);
    } catch {
      webSearch = null;
    }
    cortex = createCortex({ config, logger: ctx.logger, llm, webSearch });
  } catch (error) {
    try {
      ctx.logger?.error?.(`cortex: init failed: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      /* logging must not break the profile */
    }
    return;
  }

  ctx.effect(() => {
    const disposers = [];
    const runtime = (config.features?.capture !== false || config.features?.recall !== false)
      ? createHostRuntime({ cortex, config, logger: ctx.logger })
      : null;
    const scheduler = config.scheduler !== false
      ? createScheduler({ cortex, intervalMs: config.schedulerIntervalMs ?? 60000, logger: ctx.logger, consolidateOnTick: config.features?.llm === true && config.features?.consolidateOnTick === true, isIdle: () => runtime?.isIdle?.() ?? true })
      : null;
    try {
      for (const tool of createToolDefinitions(cortex)) disposers.push(ctx.tools.register(tool));
      if (runtime) disposers.push(runtime.attach(ctx));
      if (scheduler) scheduler.start();
      if (config.features?.api !== false) disposers.push(mountApi(ctx, {
        cortex,
        logger: ctx.logger,
        getExtractor: () => ctx.get?.('cortexExtractor') ?? null,
      }));
      if (typeof ctx.systemPrompt?.section === 'function') {
        disposers.push(ctx.systemPrompt.section({
          name: 'cortex-self',
          order: 1.05,
          text: (context) => assembleSystemPrompt(cortex, {
            budgetTokens: config.promptBudget ?? 1600,
            recall: runtime?.recallText(context) ?? '',
          }).text,
        }));
      }
      if (typeof ctx.provide === 'function') {
        const disposeService = ctx.provide('cortex', {
          search: cortex.search,
          get: cortex.get,
          write: cortex.write,
          ingestExtractedText: cortex.ingestExtractedText,
          self: cortex.self,
          health: cortex.health,
        });
        if (typeof disposeService === 'function') disposers.push(disposeService);
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try { dispose?.(); } catch { /* keep original */ }
      }
      throw error;
    }
    return () => {
      if (scheduler) scheduler.stop();
      for (const dispose of disposers.reverse()) {
        try { dispose?.(); } catch { /* unloading is quiet */ }
      }
      try { cortex.close(); } catch { /* closing is best-effort */ }
    };
  }, 'cortex: tools + prompt');

  ctx.logger?.info?.(`cortex: ready（db=${cortex.config.dbFile}，scope=${cortex.config.scope}）`);
}
