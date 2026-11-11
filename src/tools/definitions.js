const TEXT_OUTPUT = Object.freeze({
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }],
});

function line(label, value) {
  return `${label}：${value}`;
}

function formatSearch(result) {
  const lines = [
    `查询：${result.query || '（空）'} · 意图：${result.intent}`,
    `预算：${result.budget.used}/${result.budget.total} token · 候选 ${result.trace.candidates} · 选中 ${result.items.length}`,
  ];
  for (const item of result.items) {
    lines.push(`- [${item.layer}] ${item.id} · ${item.title} · score ${item.score}`);
    lines.push(`  ${item.snippet}`);
  }
  return lines.join('\n');
}

function formatSelf(snapshot) {
  const { self, identity, relationships, intentions, calibration } = snapshot;
  const drives = Object.entries(self.drives).map(([name, value]) => `${name} ${Math.round(value * 100)}`).join(' / ');
  const lines = [
    line('阶段', self.stage),
    line('驱力', drives),
    line('情绪', `valence ${self.mood.valence.toFixed(2)} / arousal ${self.mood.arousal.toFixed(2)} / energy ${self.mood.energy.toFixed(2)}`),
    line('身份', identity ? `v${identity.version} ${identity.content.narrative}` : '（未初始化）'),
  ];
  if (relationships.length) lines.push(`关系：${relationships.map((item) => `${item.target} 信任 ${Math.round(item.trust * 100)}% / 在乎 ${Math.round(item.care * 100)}%`).join('；')}`);
  if (intentions.length) lines.push(`主动意图：${intentions.map((item) => `${item.kind}(${item.priority.toFixed(2)})`).join('、')}`);
  if (calibration?.n) lines.push(`校准：n=${calibration.n} brier=${calibration.brier?.toFixed(3)} ece=${calibration.ece?.toFixed(3)}`);
  return lines.join('\n');
}

function formatHealth(report) {
  const lines = [`健康分：${report.score}/100`, `事件 ${report.counts.events} · 痕迹 ${report.counts.traces.total}（active ${report.counts.traces.active}）· 事实 ${report.counts.facts.active} · 技能 ${report.counts.skills}`];
  if (report.issues.length) {
    lines.push('问题：');
    for (const issue of report.issues) lines.push(`- [${issue.severity}] ${issue.message}`);
  } else {
    lines.push('没有发现问题。');
  }
  return lines.join('\n');
}

export function createToolDefinitions(service) {
  if (!service) throw new Error('tool definitions need a cortex service');
  return [
    {
      name: 'cortex_tick',
      description: 'Run one autonomy tick: execute safe local intentions (consolidate/recall) and return the rest as proposals that need host/approval. Never sends messages.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['run', 'status'] },
          max: { type: 'number' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'status') {
          const status = service.autonomy.status();
          return { text: `自主意图：${status.pending} 条 ${Object.entries(status.byKind).map(([k, v]) => `${k}:${v}`).join(' ')}` };
        }
        const result = service.autonomy.tick({ max: args.max ?? 2 });
        return { text: `执行 ${result.executed.length} 条，提案 ${result.proposals.length} 条。${result.proposals.map((item) => `\n- ${item.kind}：${item.reason}（需要 ${item.requires}）`).join('')}` };
      },
      presentCall: () => ({ card: 'generic', title: '自主 tick', kind: 'other' }),
    },
    {
      name: 'cortex_digest',
      description: 'Generate a daily memory digest (counts, important traces, emotions, feedback, goals) and persist it as a digest summary.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['daily'] },
          date: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        const result = service.digest.daily({ date: args.date });
        return { text: result.content };
      },
      presentCall: () => ({ card: 'generic', title: '每日摘要', kind: 'other' }),
    },
    {
      name: 'cortex_working',
      description: 'Manage working memory (focus, pins, TTL): add / list / pin / remove / purge. Working memory is the small L1 layer injected into the next prompt.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'pin', 'remove', 'purge'] },
          id: { type: 'string' },
          text: { type: 'string' },
          kind: { type: 'string' },
          priority: { type: 'number' },
          pinned: { type: 'boolean' },
          ttlMs: { type: 'number' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'add') {
          if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
          const item = service.working.add({ text: args.text, kind: args.kind, priority: args.priority, pinned: args.pinned === true, ttlMs: args.ttlMs });
          return { text: `已加入工作记忆 ${item.id}：${item.text}` };
        }
        if (args.action === 'pin') {
          if (args.id && !service.scopeWritableById('working', args.id)) return { text: '未执行：该工作项属于只读共享 scope。' };
          const item = service.working.update(args.id, { pinned: args.pinned !== false });
          return { text: item ? `已${item.pinned ? '置顶' : '取消置顶'} ${item.id}` : `没有 ${args.id}` };
        }
        if (args.action === 'remove') {
          if (args.id && !service.scopeWritableById('working', args.id)) return { text: '未执行：该工作项属于只读共享 scope。' };
          return { text: service.working.remove(args.id) ? `已删除 ${args.id}` : `没有 ${args.id}` };
        }
        if (args.action === 'purge') {
          if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
          return { text: `已清理 ${service.working.purgeExpired()} 条过期工作记忆` };
        }
        const items = service.working.list();
        return { text: items.length ? items.map((item) => `- ${item.pinned ? '[pin] ' : ''}${item.id} (${item.priority}) ${item.text}`).join('\n') : '（工作记忆为空）' };
      },
      presentCall: () => ({ card: 'generic', title: '工作记忆', kind: 'other' }),
    },
    {
      name: 'cortex_goal',
      description: 'Manage long-running goals (L1): add / list / update / complete. Goals feed the working-memory and self-state layers.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'update', 'complete'] },
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'number' },
          progress: { type: 'number' },
          status: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'add') {
          if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
          const goal = service.goals.add({ title: args.title, description: args.description, priority: args.priority });
          return { text: `目标已建 ${goal.id}：${goal.title}` };
        }
        if (args.action === 'complete') {
          if (args.id && !service.scopeWritableById('goal', args.id)) return { text: '未执行：该目标属于只读共享 scope。' };
          const done = service.goals.complete(args.id);
          return { text: done ? `目标已完成：${done.title}` : `没有这个目标：${args.id}` };
        }
        if (args.action === 'update') {
          if (args.id && !service.scopeWritableById('goal', args.id)) return { text: '未执行：该目标属于只读共享 scope。' };
          const goal = service.goals.update(args.id, { title: args.title, description: args.description, priority: args.priority, progress: args.progress, status: args.status });
          return { text: goal ? `已更新 ${goal.id}：${goal.status} ${Math.round(goal.progress * 100)}%` : `没有 ${args.id}` };
        }
        const list = service.goals.list({ status: args.status });
        return { text: list.length ? list.map((goal) => `- [${goal.status}] ${goal.id} ${goal.title} ${Math.round(goal.progress * 100)}%`).join('\n') : '（没有目标）' };
      },
      presentCall: () => ({ card: 'generic', title: '目标', kind: 'other' }),
    },
    {
      name: 'cortex_compress',
      description: 'Evaluate or apply compression: archive old, low-importance traces that are already covered by summaries/facts; revive one by id.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['evaluate', 'compress', 'revive'] },
          id: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'revive') {
          const result = service.compression.revive(args.id);
          return { text: result.revived ? `已复活 ${args.id}（下一次检索可命中）` : `没有这条记忆：${args.id}` };
        }
        if (args.action === 'compress') {
          if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
          const result = service.compression.compress({ limit: args.limit });
          return { text: `压缩归档 ${result.archived} 条。${result.items.map((item) => `\n- ${item.id} coverage ${item.coverage.toFixed(2)}`).join('')}` };
        }
        const rows = service.compression.evaluate();
        const eligible = rows.filter((row) => row.eligible);
        return { text: `可压缩 ${eligible.length} 条 / 活跃 ${rows.length} 条。${eligible.slice(0, 10).map((row) => `\n- ${row.trace.id} coverage ${row.coverage.toFixed(2)} R ${row.retrievability.toFixed(2)}`).join('')}` };
      },
      presentCall: () => ({ card: 'generic', title: '记忆压缩', kind: 'other' }),
    },
    {
      name: 'cortex_life',
      description: 'Life-side memory: diary entries, dream generation from recent memories, and a sleep/consolidation run (purge working, reflect, recompute development and affect).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['diary-write', 'diary-list', 'diary-forget', 'dream', 'sleep', 'sleep-runs'] },
          text: { type: 'string' },
          mood: { type: 'string' },
          id: { type: 'string' },
          windowDays: { type: 'number' },
          limit: { type: 'number' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'diary-write') {
          if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
          const item = service.life.diaryWrite({ text: args.text, mood: args.mood });
          return { text: `日记已写：${item.id}\n${item.text}` };
        }
        if (args.action === 'diary-list') {
          const list = service.life.diaryList({ limit: args.limit });
          return { text: list.length ? list.map((item) => `- ${item.at} ${item.mood ?? ''}：${item.text}`).join('\n') : '（还没有日记）' };
        }
        if (args.action === 'diary-forget') {
          return { text: service.life.diaryForget(args.id) ? `已删日记 ${args.id}` : `没有这条日记：${args.id}` };
        }
        if (args.action === 'dream') {
          if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
          const dream = await service.life.dreamGenerate();
          return { text: `梦 ${dream.id}（来源 ${dream.sourceCount} 条，${dream.model}）：\n${dream.text}` };
        }
        if (args.action === 'sleep-runs') {
          const list = service.life.sleepRuns({ limit: args.limit });
          return { text: list.length ? list.map((item) => `- ${item.id} · ${item.at}：${JSON.stringify(item.report)}`).join('\n') : '（还没有睡眠记录）' };
        }
        if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
        const report = await service.life.sleep({ windowDays: args.windowDays ?? 1 });
        return { text: `睡眠整理完成：清理工作记忆 ${report.purgedWorking} 条 · 反思 ${report.reflected} · 阶段 ${report.stage ?? '—'} · 情感对象 ${report.affectTargets}` };
      },
      presentCall: () => ({ card: 'generic', title: '生活侧记忆', kind: 'other' }),
    },
    {
      name: 'cortex_emotion',
      description: 'Detect emotions in text, record an emotion event for a target, show affect attitudes, or list the 24-category lexicon.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['detect', 'record', 'affect', 'events', 'lexicon'] },
          text: { type: 'string' },
          target: { type: 'string' },
          traceId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'detect') {
          const result = service.emotion.detect(args.text);
          return { text: result.emotions.length ? result.emotions.map((item) => `${item.name}:${item.score}`).join(' / ') : '没有命中情绪词。' };
        }
        if (args.action === 'record') {
          if (!service.scopeWritable(service.settings().scope)) return { text: '未执行：当前 scope 只读共享。' };
          const result = service.emotion.record({ text: args.text, target: args.target, traceId: args.traceId });
          return { text: result.event ? `已记情绪事件 ${result.event.id}：${result.emotions.map((item) => item.name).join('、')} → ${result.event.target}（${result.target.attitude}）` : '没有命中情绪词。' };
        }
        if (args.action === 'affect') return { text: service.emotion.text() };
        if (args.action === 'events') {
          const list = service.emotion.events({ limit: args.limit });
          return { text: list.length ? list.map((item) => `- ${item.at} ${item.emotions.map((e) => e.name).join('、')} → ${item.target ?? '—'}：${item.text.slice(0, 120)}`).join('\n') : '（没有情绪事件）' };
        }
        const lex = service.emotion.lexicon();
        return { text: `情绪词库：${lex.categories} 类 / ${lex.total} 词\n${Object.entries(lex.counts).map(([name, count]) => `${name}:${count}`).join(' ')}` };
      },
      presentCall: () => ({ card: 'generic', title: '情绪与态度', kind: 'other' }),
    },
    {
      name: 'cortex_evolve',
      description: 'Inspect or drive self-evolution: status, optimize (propose candidate policies), propose, approve, rollback. Nothing is applied until approve.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['status', 'optimize', 'propose', 'approve', 'rollback'] },
          id: { type: 'string' },
          kind: { type: 'string' },
          config: { type: 'object', additionalProperties: true },
          rationale: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'optimize') {
          const result = service.evolution.selfOptimize();
          return { text: result.count ? result.proposals.map((item) => `- ${item.kind} v${item.version}：${item.rationale}`).join('\n') : '没有需要提议的改动。' };
        }
        if (args.action === 'propose') {
          const item = service.evolution.propose({ kind: args.kind, config: args.config, rationale: args.rationale });
          return { text: `已提案 ${item.kind} v${item.version}（${item.id}），等待批准。` };
        }
        if (args.action === 'approve') {
          const item = service.evolution.approve(args.id);
          return { text: `已激活 ${item.kind} v${item.version}。` };
        }
        if (args.action === 'rollback') {
          if (!args.kind) return { text: '回滚策略必须给 kind（retrieval / maintain / repair / skill）。' };
          const item = service.evolution.rollback(args.kind, args.id);
          return { text: `已回滚 ${item.kind} 到 v${item.version}。` };
        }
        const status = service.evolution.status();
        const active = Object.entries(status.active).filter(([, value]) => value).map(([kind, value]) => `${kind} v${value.version}`);
        return { text: `活跃策略：${active.join('、') || '（无）'}\n候选：${status.candidates.length}\n身份：v${status.identity?.version ?? '—'}` };
      },
      presentCall: () => ({ card: 'generic', title: '自我进化', kind: 'other' }),
    },
    {
      name: 'cortex_guard',
      description: 'Self-check, back up, validate a backup, export a Markdown mirror, or repair the search index. Use check before/after risky operations; backup before bulk imports.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['check', 'backup', 'validate', 'restore', 'repair', 'export', 'sync'] },
          file: { type: 'string', description: 'Backup path for backup/validate/restore.' },
          target: { type: 'string', description: 'Offline target path for restore (never the live DB).' },
          dir: { type: 'string', description: 'Target directory for export, or source directory for sync.' },
          dryRun: { type: 'boolean', description: 'For sync: report changes without writing.' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'backup') {
          const result = service.guardian.backup(args.file);
          return { text: `备份完成：${result.path}（${result.bytes} B）` };
        }
        if (args.action === 'validate') {
          const result = service.guardian.validateBackup(args.file);
          return { text: result.ok ? `备份有效：${args.file}（${result.tables} 张表）` : `备份无效：${result.reason ?? result.missing?.join(',')}` };
        }
        if (args.action === 'restore') {
          const result = service.guardian.restore(args.file, args.target);
          return { text: result.restored ? `已恢复到离线库：${result.target}` : `恢复失败：${result.reason}${result.message ? `（${result.message}）` : ''}` };
        }
        if (args.action === 'sync') {
          const dir = args.dir;
          if (!dir) return { text: '同步 Markdown 需要 dir。' };
          if (args.dryRun !== true && !service.scopeWritable(args.scope ?? service.settings().scope)) return { text: '未执行：该 scope 只读共享。' };
          const result = service.syncMarkdown(dir, { dryRun: args.dryRun === true, scopeId: args.scope });
          return { text: `Markdown 同步${result.dryRun ? '（dry-run）' : ''}：更新 ${result.updated}，新建 ${result.created}，文件 ${result.files}` };
        }
        if (args.action === 'repair') {
          const result = service.guardian.repairFts();
          return { text: `FTS 重建完成：${result.before} → ${result.after}（${result.reindexed} 条）` };
        }
        if (args.action === 'export') {
          const result = service.exportMarkdown(args.dir ?? 'cortex-mirror');
          return { text: `Markdown 镜像已导出：${result.root}\n文件：${result.files.join('、')}\n记忆 ${result.traces} 条（跳过 secret ${result.skippedSecrets} 条）` };
        }
        const report = service.guardian.check();
        const lines = [
          `自检：${report.ok ? '通过' : '发现问题'} · integrity=${report.integrity} · db ${report.dbBytes} B`,
          ...report.issues.map((issue) => `- [${issue.code}] ${issue.message}`),
        ];
        return { text: lines.join('\n') };
      },
      presentCall: () => ({ card: 'generic', title: '守护自检', kind: 'other' }),
    },
    {
      name: 'cortex_search',
      description:
        'Search long-term memory across episodic traces, facts and reflections. Returns a compact index (id, layer, title, snippet, score, source trace), not full bodies. Use cortex_get for one full memory and cortex_timeline for order.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'What to recall; can be a question or keywords.' },
          scope: { type: 'string' },
          limit: { type: 'number', description: 'Max items, 1–20.' },
          budget: { type: 'number', description: 'Token budget for the returned index.' },
          includeArchived: { type: 'boolean' },
          tiered: { type: 'boolean', description: 'Return perm/hot/cold budgeted blocks; cold is index-only.' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        const asyncVector = service.vector?.status?.().async === true;
        if (args.tiered) {
          const tiered = asyncVector
            ? await service.recallTieredAsync({ query: args.query, scopeId: args.scope, limit: args.limit, includeArchived: args.includeArchived === true })
            : service.recallTiered({ query: args.query, scopeId: args.scope, limit: args.limit, includeArchived: args.includeArchived === true });
          return { text: tiered.text || '（没有可注入的分层记忆）' };
        }
        const result = asyncVector
          ? await service.searchAsync(args.query, { scopeId: args.scope, limit: args.limit, budget: args.budget, includeArchived: args.includeArchived === true })
          : service.search(args.query, {
          scopeId: args.scope,
          limit: args.limit,
          budget: args.budget,
          includeArchived: args.includeArchived === true,
        });
        return { text: formatSearch(result) };
      },
      presentCall: () => ({ card: 'generic', title: '记忆检索', kind: 'other' }),
    },
    {
      name: 'cortex_timeline',
      description: 'Show a small timeline around one trace: the anchor and its neighbours, ordered by recorded time. Use it after cortex_search when order or causality matters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['aroundId'],
        properties: {
          aroundId: { type: 'string' },
          before: { type: 'number' },
          after: { type: 'number' },
          scope: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        const result = service.timeline({ aroundId: args.aroundId, before: args.before, after: args.after, scopeId: args.scope });
        const lines = result.anchor ? [`锚点：${result.anchor.title || result.anchor.id}`] : ['（没有找到锚点）'];
        for (const item of result.items) lines.push(`${item.isAnchor ? '→' : ' '} ${item.recordedAt} [${item.kind}] ${item.title || item.id} — ${item.snippet}`);
        return { text: lines.join('\n') };
      },
      presentCall: () => ({ card: 'generic', title: '记忆时间线', kind: 'other' }),
    },
    {
      name: 'cortex_as_of',
      description: 'Read semantic facts as of a point in time. Modes: strict (current truth), historical (true at a past time), belief (what the system had recorded then), associative (all versions, no time filter). Use for “what did I believe then / what was true then”.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['subject'],
        properties: {
          subject: { type: 'string' },
          predicate: { type: 'string' },
          at: { type: 'string', description: 'ISO time or epoch milliseconds; default now' },
          mode: { type: 'string', enum: ['strict', 'historical', 'belief', 'associative'] },
          includeDisputed: { type: 'boolean' },
          scope: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        const result = service.asOf({
          subject: args.subject,
          predicate: args.predicate,
          at: args.at ?? null,
          mode: args.mode ?? 'historical',
          includeDisputed: args.includeDisputed !== false,
          scopeId: args.scope,
        });
        if (!result.facts.length) return { text: `在 ${result.at} 没有「${args.subject}」的${result.mode}事实${result.reason ? `（${result.reason}）` : ''}。` };
        const lines = [`主体：${result.subject} · 口径：${result.mode} · 时间：${result.at}`];
        for (const fact of result.facts) {
          lines.push(`- [${fact.status}] ${fact.predicate} → ${fact.object ?? '—'} · 有效 ${fact.validFrom ?? '?'} → ${fact.validTo ?? '现在'} · 置信 ${fact.confidence}`);
        }
        return { text: lines.join('\n') };
      },
      presentCall: () => ({ card: 'generic', title: '时点事实', kind: 'other' }),
    },
    {
      name: 'cortex_playbook',
      description: 'Manage L1.5 work rules: add a short rule, list active rules, vote helpful/harmful, retire one, or render the budgeted playbook. Rules are not identity; they expire via validTo.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'vote', 'retire', 'render', 'suggest', 'approve'] },
          id: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          validTo: { type: 'string' },
          signal: { type: 'string', enum: ['helpful', 'harmful'] },
          status: { type: 'string', enum: ['active', 'retired'] },
          includeExpired: { type: 'boolean' },
          scope: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'add') {
          if (!args.title) return { text: '准则需要 title。' };
          if (!args.body) return { text: '准则需要 body。' };
          if (!service.scopeWritable(args.scope ?? service.settings().scope)) return { text: '未执行：该 scope 只读共享。' };
          const rule = service.playbook.add({ title: args.title, body: args.body, tags: args.tags, validTo: args.validTo ?? null, scopeId: args.scope });
          return { text: `已加准则 ${rule.id}：${rule.title}${rule.validTo ? `（到期 ${rule.validTo}）` : ''}` };
        }
        if (args.action === 'list') {
          const rules = service.playbook.list({ status: args.status ?? null, includeExpired: args.includeExpired === true, scopeId: args.scope });
          return { text: rules.length ? rules.map((rule) => `- [${rule.status}] ${rule.id} · ${rule.title}：${rule.body}（+${rule.helpful}/-${rule.harmful}${rule.validTo ? ` · ${rule.validTo}` : ''}）`).join('\n') : '（还没有准则）' };
        }
        if (args.action === 'vote') {
          if (!args.id) return { text: '投票需要 id。' };
          if (!service.scopeWritableById('playbook', args.id)) return { text: '未执行：该准则属于只读共享 scope。' };
          const rule = service.playbook.vote({ id: args.id, signal: args.signal ?? 'helpful' });
          return { text: rule ? `已记 ${rule.id}：helpful=${rule.helpful} harmful=${rule.harmful}` : `没有准则 ${args.id}` };
        }
        if (args.action === 'retire') {
          if (!args.id) return { text: '停用需要 id。' };
          if (!service.scopeWritableById('playbook', args.id)) return { text: '未执行：该准则属于只读共享 scope。' };
          const rule = service.playbook.retire(args.id);
          return { text: rule ? `已停用 ${rule.id}` : `没有准则 ${args.id}` };
        }
        if (args.action === 'suggest') {
          if (!service.scopeWritable(args.scope ?? service.settings().scope)) return { text: '未执行：该 scope 只读共享。' };
          const result = service.playbook.suggest({ scopeId: args.scope, limit: args.limit ?? 5 });
          return { text: result.count ? result.candidates.map((rule) => `- [candidate] ${rule.id} · ${rule.title}：${rule.body}`).join('\n') : '（没有新的准则候选）' };
        }
        if (args.action === 'approve') {
          if (!args.id) return { text: '确认需要 id。' };
          if (!service.scopeWritableById('playbook', args.id)) return { text: '未执行：该准则属于只读共享 scope。' };
          const rule = service.playbook.approve(args.id);
          return { text: rule ? `已确认 ${rule.id}，下一轮生效` : `没有准则 ${args.id}` };
        }
        const rendered = service.playbook.render({ scopeId: args.scope });
        if (!rendered.text) return { text: '（准则本为空或全部过期）' };
        return { text: `${rendered.text}${rendered.omitted ? `\n（另有 ${rendered.omitted} 条因预算省略）` : ''}` };
      },
      presentCall: () => ({ card: 'generic', title: '工作准则本', kind: 'other' }),
    },
    {
      name: 'cortex_consolidate',
      description: 'Run LLM memory consolidation (keep/merge/archive/update/conflict) with validation and a replayable dream_runs record. Without an LLM it records a skipped run and changes nothing. Use list to inspect past runs.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['run', 'list'] },
          limit: { type: 'number' },
          dryRun: { type: 'boolean' },
          scope: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (args.action === 'list') {
          const runs = service.consolidation.list({ scopeId: args.scope, limit: args.limit });
          return { text: runs.length ? runs.map((run) => `- ${run.id} · ${run.at} · ${run.status} · applied ${run.applied.length} · ${run.inputDigest.slice(0, 12)}`).join('\n') : '（还没有巩固记录）' };
        }
        const result = await service.consolidation.run({ scopeId: args.scope, limit: args.limit ?? 30, dryRun: args.dryRun === true });
        return { text: `巩固 ${result.run.status}：${result.run.id} · 决策 ${result.decisions.length} · 应用 ${result.applied.length}${result.run.error ? ` · ${result.run.error}` : ''}` };
      },
      presentCall: () => ({ card: 'generic', title: '记忆巩固', kind: 'other' }),
    },
    {
      name: 'cortex_get',
      description: 'Read one memory trace in full: content, summary, provenance, confidence, DSR state and timestamps. Use after cortex_search.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        if (!args.id || !String(args.id).trim()) return { text: `没有这条记忆：${args.id}` };
        const trace = service.get(args.id);
        if (!trace) return { text: `没有这条记忆：${args.id}` };
        return {
          text: [
            `[${trace.kind}] ${trace.title || trace.id}`,
            `时间：${trace.validAt || trace.recordedAt} · 来源：${trace.source || trace.actor || '—'} · 置信：${trace.confidence}`,
            `状态：${trace.state}/${trace.compression} · 稳定性 ${trace.stability.toFixed(2)} · 难度 ${trace.difficulty.toFixed(2)}`,
            trace.summary ? `摘要：${trace.summary}` : '',
            trace.content,
            trace.tags?.length ? `标签：${trace.tags.join('、')}` : '',
          ].filter(Boolean).join('\n'),
        };
      },
      presentCall: () => ({ card: 'generic', title: '记忆详情', kind: 'other' }),
    },
    {
      name: 'cortex_write',
      description:
        'Write one memory trace (and optional explicit facts) into long-term memory. Use this for explicit user requests ("remember this"), decisions, promises and important observations. Automatic capture also uses the same pipeline.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', description: 'observation / utterance / decision / promise / preference / reflection' },
          importance: { type: 'number' },
          confidence: { type: 'number' },
          explicit: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          operationId: { type: 'string' },
          scope: { type: 'string' },
          facts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                subject: { type: 'string' },
                predicate: { type: 'string' },
                object: { type: 'string' },
                objectLiteral: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: ['subject', 'predicate'],
            },
          },
          attachments: {
            type: 'array',
            description: 'Reference-only attachment metadata; no bytes are fetched or stored.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['image', 'audio', 'video', 'file'] },
                uri: { type: 'string' },
                name: { type: 'string' },
                mime: { type: 'string' },
                bytes: { type: 'number' },
                sha256: { type: 'string' },
              },
              required: ['kind', 'uri'],
            },
          },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        const result = service.write({
          text: args.text,
          kind: args.kind,
          importance: args.importance,
          confidence: args.confidence,
          explicit: args.explicit === true,
          tags: args.tags,
          operationId: args.operationId,
          scopeId: args.scope,
          facts: args.facts,
          attachments: args.attachments,
        });
        if (result.skipped) {
          const hint = {
            'low-compression': '内容信息密度太低。若确实是用户要求记住的，请传 explicit: true，或提高 importance 后再试。',
            'too-short': '内容太短。请写成一条完整、可检索的记忆。',
            'stop-phrase': '这是停用短语。若确实要记，请换一条有具体内容的表达。',
            duplicate: '已有相同内容。可以继续使用已有 trace，不必重复写。',
            idempotent: '同一个 operationId 已处理过。可以继续使用已有 trace。',
            'scope-read-only': '这个 scope 是只读共享的；请换到可写 scope，或让宿主解除只读。',
          }[result.reason];
          const factsNote = result.facts?.length ? `\n已应用 ${result.facts.length} 条事实。` : '';
          const edgeNote = result.edgeCandidates?.length ? `\n候选边：${result.edgeCandidates.length} 条（待审核）。` : '';
          return {
            text: `未写入：${result.reason}${result.trace ? `（已有 ${result.trace.id}）` : ''}${factsNote}${edgeNote}${hint ? `\n提示：${hint}` : ''}`,
          };
        }
        return {
          text: `已写入 ${result.trace.id}（${result.trace.kind}）\n事件：${result.event.id}\n压缩值：${result.compression.toFixed(3)}${result.facts?.length ? `\n事实：${result.facts.length} 条` : ''}${result.edgeCandidates?.length ? `\n候选边：${result.edgeCandidates.length} 条（待审核）` : ''}${result.trace.metadata?.attachments?.length ? `\n附件：${result.trace.metadata.attachments.length} 个（仅元数据）` : ''}`,
        };
      },
      presentCall: () => ({ card: 'generic', title: '写入记忆', kind: 'other' }),
    },
    {
      name: 'cortex_feedback',
      description:
        'Tell the memory system whether a recalled trace was useful or wrong. Updates DSR state, confidence, self-state and calibration.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'signal'],
        properties: {
          id: { type: 'string', description: 'Trace id.' },
          signal: { type: 'string', enum: ['used', 'helpful', 'ignored', 'incorrect', 'corrected', 'again', 'good', 'easy', 'hard'] },
          predicted: { type: 'number', description: 'Optional predicted usefulness 0–1.' },
          scope: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        const result = service.feedback({ traceId: args.id, signal: args.signal, predicted: args.predicted, scopeId: args.scope });
        return { text: `反馈已记：${args.signal} → ${result.trace.id}\n稳定性 ${result.trace.stability.toFixed(2)} · 置信 ${result.trace.confidence.toFixed(2)} · 复习 ${result.trace.reviewCount}` };
      },
      presentCall: () => ({ card: 'generic', title: '记忆反馈', kind: 'other' }),
    },
    {
      name: 'cortex_forget',
      description:
        'Archive (soft, wakeable) or delete (privacy cascade) one memory trace. Delete also removes derived facts, summaries, feedback and appraisals; the event ledger keeps only a content hash.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'mode'],
        properties: {
          id: { type: 'string' },
          mode: { type: 'string', enum: ['archive', 'delete'] },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        if (!args.id || !String(args.id).trim()) throw new Error('traceId is required');
        if (!service.scopeWritableById('trace', args.id)) return { text: '未执行：该记忆属于只读共享 scope。' };
        const result = service.forget({ traceId: args.id, mode: args.mode });
        if (!result.removed) {
          return { text: result.reason === 'scope-read-only' ? '未执行：该记忆属于只读共享 scope。' : `没有这条记忆：${args.id}` };
        }
        return { text: args.mode === 'delete' ? `已删除 ${args.id}，并级联清理派生数据。` : `已归档 ${args.id}，可用关键词唤醒。` };
      },
      presentCall: () => ({ card: 'generic', title: '遗忘/删除记忆', kind: 'other' }),
    },
    {
      name: 'cortex_reflect',
      description: 'Consolidate recent traces into an extractive reflection and summary. Produces a reflective trace with source pointers and coverage; does not delete raw memories.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          windowDays: { type: 'number' },
          force: { type: 'boolean' },
          scope: { type: 'string' },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      async execute(args = {}) {
        const result = service.reflect({ windowDays: args.windowDays, force: args.force === true, scopeId: args.scope });
        if (result.skipped) return { text: `未整理：${result.reason}` };
        return { text: `${result.summary.content}\n来源 ${result.sources.length} 条 · 覆盖率 ${Math.round(result.coverage * 100)}% · 反思痕迹 ${result.trace?.id ?? '—'}` };
      },
      presentCall: () => ({ card: 'generic', title: '记忆巩固', kind: 'other' }),
    },
    {
      name: 'cortex_self',
      description: 'Show the current self-state: drives, mood, identity, relationships, pending intentions and calibration. Read-only.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute() {
        return { text: formatSelf(service.self()) };
      },
      presentCall: () => ({ card: 'generic', title: '自我状态', kind: 'other' }),
    },
    {
      name: 'cortex_health',
      description: 'Audit memory health: event chain, SQLite integrity, FTS alignment, duplicates, disputed/stale facts, job backlog, identity/self state and size.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute() {
        return { text: formatHealth(service.health()) };
      },
      presentCall: () => ({ card: 'generic', title: '记忆体检', kind: 'other' }),
    },
  ];
}
