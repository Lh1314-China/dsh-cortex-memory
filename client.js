window.__ModuleLoader__.load({
  id: 'dsh-cortex',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const NS = 'cortex';
    const API = '/api/cortex';

    const DICT = {
      zh: {
        navLabel: 'Cortex 记忆',
        title: 'Cortex 记忆',
        subtitle: '本鲸的分层记忆 · 自我状态 · 守护 · 进化',
        refresh: '刷新',
        loading: '读取中…',
        retry: '重试',
        error: '出错了',
        tabSelf: '自我',
        tabSearch: '检索',
        tabHealth: '守护',
        tabEvolution: '进化',
        tabPlaybook: '准则',
        tabTimeline: '时间线',
        tabAudit: '审计',
        tabRetention: '留存',
        tabWorking: '工作/目标',
        tabEmotion: '情绪',
        tabLife: '生活',
        tabGraph: '图',
        tabSettings: '设置',
        playbookHint: '候选准则不会注入；人工确认后才进入每轮上下文。',
        playbookCandidates: '候选准则',
        playbookActive: '生效准则',
        playbookApprove: '确认',
        playbookReject: '停用',
        playbookEmpty: '（没有候选准则）',
        playbookSuggest: '生成候选',
        drives: '驱力',
        mood: '情绪',
        identity: '身份',
        relationships: '关系',
        intentions: '主动意图',
        calibration: '校准',
        searchPlaceholder: '搜记忆、事实、经历…',
        search: '搜索',
        results: '结果',
        noResults: '没有命中。',
        detail: '详情',
        close: '收起',
        score: '健康分',
        issues: '问题',
        ok: '正常',
        counts: '计数',
        backup: '备份',
        repair: '修 FTS',
        guardCheck: '自检',
        activePolicies: '活跃策略',
        candidates: '候选',
        optimize: '生成优化提案',
        approve: '批准',
        rollback: '回滚',
        noPolicies: '还没有策略。',
        timelineHint: '输入 trace id 读取前后相邻记忆；从检索结果或详情点「时间线」会自动带入。',
        empty: '（空）',
        errorPrefix: '请求失败',
        stage: '阶段',
        traced: '记忆',
        searchText: '关键词',
        searchTextHint: '自由文本；筛选条件也会拼进同一个 q。',
        filters: '筛选',
        filterKind: 'kind',
        filterTag: 'tag',
        filterAfter: 'after',
        filterBefore: 'before',
        filterImportance: 'importance',
        filterTagsHint: '多个 tag 用逗号或空格分隔',
        filterImportanceHint: '0–1，生成 importance:>值',
        queryPreview: '实际查询',
        resultLimit: '条数',
        clearFilters: '清空筛选',
        importanceRange: 'importance 必须在 0 到 1 之间。',
        searchNeedsQuery: '请输入关键词，或至少填一个筛选条件。',
        searchHint: '输入关键词或筛选条件后开始检索；结果会显示命中原因和预算。',
        searchLoading: '正在检索…',
        intent: '意图',
        elapsed: '耗时',
        candidateCount: '候选',
        selectedCount: '选中',
        budgetUsed: '预算',
        openDetail: '打开详情',
        detailTitle: '记忆详情',
        detailLoading: '正在读取记忆…',
        detailMeta: '元数据',
        detailContent: '正文',
        detailSummary: '摘要',
        detailTags: '标签',
        detailAttachments: '附件（仅元数据）',
        attachmentAddTitle: '关联本地附件',
        attachmentAddHint: '填 file:// 路径；“检查”走本地读取器（默认关），“关联”只写引用元数据。',
        attachmentCheck: '检查',
        attachmentSave: '关联',
        attachmentSaved: '已关联',
        extractTitle: '从本地提取到记忆',
        extractHint: 'OCR/ASR 结果会写成一条派生记忆，不改原 trace。',
        extractTarget: '目标记忆',
        extractLayout: '版面',
        layoutAuto: '自动',
        layoutSingle: '单栏',
        layoutTwoColumn: '双栏',
        layoutHandwriting: '手写',
        extractRun: '提取并写入',
        extractSaved: '已写入派生记忆',
        extractSuggested: '建议：当前这条',
        extractChanged: '已改选目标',
        detailKeywords: '关键词',
        detailFeedback: '这条记忆有用吗',
        feedbackUsed: '用到了',
        feedbackHelpful: '有帮助',
        feedbackIncorrect: '不准确',
        feedbackCorrected: '已修正',
        feedbackSaved: '反馈已记录',
        feedbackFailed: '反馈失败',
        feedbackHint: '反馈会更新 DSR 复习状态、置信度与关系；不会删除记忆。',
        openTimeline: '查看时间线',
        closeDetail: '关闭详情',
        traceMissing: '没有找到这条记忆（可能已归档，或 id 有误）。',
        timelineAnchorId: '锚点 trace id',
        timelineBeforeCount: '前',
        timelineAfterCount: '后',
        timelineLoad: '读取时间线',
        timelineAnchor: '锚点',
        timelineBefore: '之前',
        timelineAfter: '之后',
        timelineEmpty: '输入一条 trace id，读取它前后相邻的记忆。',
        timelineMissing: '没有找到锚点：id 可能不存在，或已在归档里。',
        timelineNoItems: '锚点存在，但没有可展示的相邻记忆。',
        timelineCount: '条',
        auditTitle: '审计记录',
        auditHint: '最近的操作记录，按时间倒序；只读。',
        auditTime: '时间',
        auditActor: '操作者',
        auditAction: '动作',
        auditTarget: '对象',
        auditDetail: '详情',
        auditLimit: '每页条数',
        auditEmpty: '还没有审计记录。',
        auditCount: '共',
        retentionTitle: '留存计划',
        retentionHint: '这里只读计划，不会改动任何记忆。',
        activeTraces: '活跃记忆',
        candidateTraces: '归档候选',
        planOnly: '只看计划',
        applyRetention: '应用归档',
        retentionGap: '应用只会归档当前计划里的候选，不删除正文；重要记忆不会被自动归档。',
        retentionRules: '候选条件：超过年龄/数量上限，且 importance 低于阈值、confidence 低于 0.75；reflection 永不自动归档。',
        retentionEmpty: '当前没有归档候选。',
        retentionAge: '年龄',
        retentionImportance: '重要度',
        retentionConfidence: '置信度',
        retentionReason: '原因',
        retentionAt: '计划时间',
        retentionClick: '点击查看候选详情',
        graphTitle: '记忆图',
        graphHint: '仅展示 PageRank 前 N 个节点；接口不返回边列表，所以不画伪边。',
        graphNodes: '节点',
        graphEdges: '边',
        graphComponents: '连通组件',
        graphCommunities: '社群',
        graphTop: '中心节点',
        graphEmpty: '图里还没有可展示的节点。',
        graphAria: 'Cortex 记忆图：中心节点按 PageRank 排在中心与轨道上。',
        graphRank: 'PageRank',
        graphScaleNote: '节点越大，PageRank 越高；轨道只是布局参考，不是边。',
        graphTopCount: '展示',
        graphCandidatesTitle: '候选边（待审核）',
        graphCandidatesHint: '候选边不会进入图谱，批准后才生效。',
        graphCandidatesEmpty: '没有待审核的候选边。',
        graphApprove: '批准',
        graphReject: '拒绝',
        graphCandidateConfidence: '置信',
        settingsTitle: '运行设置',
        settingsHint: '设置与指标均为只读快照。',
        runtime: '运行时',
        features: '功能开关',
        permissions: '权限 / 网络',
        permissionLocal: '本机接口',
        permissionNetwork: '出网能力',
        permissionOn: '开',
        permissionOff: '关',
        permissionConfirm: '修改权限会写入本机 cortex 数据目录，重启后生效。继续吗？',
        permissionSaved: '已保存；重启 DSH 后生效。',
        permissionRestart: '重启后生效',
        scopeGrants: '共享写授权',
        scopeGrantsHint: '只对带 x-cortex-agent 的 API 生效；撤销立即生效并持久化。工具路径不带 agent。',
        scopeGrantName: '授权（scope:agent）',
        scopeGrantUntil: '到期（ISO，可空）',
        scopeGrantAdd: '添加授权',
        scopeGrantRevoke: '撤销',
        scopeGrantEmpty: '没有共享写授权。',
        scopeGrantForever: '永久',
        scopeGrantRevoked: '已撤销',
        scopeGrantSaved: '已保存',
        vectorEnable: '启用向量',
        vectorDisabled: '向量默认关闭。启用后使用内置 hash-256（不需要下载模型），重启后生效。',
        modelTitle: '嵌入 / 重排模型',
        modelHint: '本地模式连接本机 OpenAI 兼容服务（默认 Ollama bge-m3）；远程模式连接 OpenAI 兼容 /embeddings。两种只能选一种。',
        modelGuide: '模型选择指引（点开）',
        modelGuideRemote: '远程服务：必须填 API key，不填保存会拒绝；key 只进密码框，不要发聊天。适合 OpenAI、硅基流动、百炼等 OpenAI 兼容 /embeddings。',
        modelGuideLocal: '本地服务：key 可以留空。推荐 bge-m3（中文/多语，1024 维，约 1.2GB）；机器小可用 nomic-embed-text（768 维，约 274MB，中文弱一些）。',
        modelGuideDefault: '没装本地模型时保持 hash 默认，不会因为服务没开而丢记忆；切模型后要重建向量。',
        modelDownloadBge: '打开 bge-m3 说明',
        modelMode: '模式',
        modelHash: 'hash（词法兜底）',
        modelLocal: '本地服务',
        modelRemote: '远程服务',
        modelBase: 'baseUrl',
        modelName: '模型名',
        modelDim: '维度',
        modelKey: 'API key（留空则保留原值）',
        modelSave: '保存模型配置',
        modelSaved: '已保存；重启 DSH 后生效。',
        rerankTitle: 'rerank（可选）',
        rerankEnable: '启用 rerank',
        rerankHint: '不配置就回退原融合顺序；失败也回退。',
        permissionClick: '点击切换',
        permissionApiLocked: '本机接口不能从自身关闭',
        vector: '向量',
        scope: 'scope',
        dataRoot: 'dataRoot',
        readOnlyScopes: '只读 scope',
        dbFile: 'dbFile',
        contextBudget: 'contextBudget',
        promptBudget: 'promptBudget',
        metricsTitle: '进程指标',
        counters: '计数器',
        histograms: '直方图',
        metricName: '名称',
        metricValue: '值',
        count: '次数',
        p50: 'p50',
        p95: 'p95',
        max: 'max',
        metricsEmpty: '还没有指标样本。',
        readOnlyNote: '只读：此页不会写入设置或记忆。',
        refreshAll: '全部刷新',
        metricAt: '采样时间',
        notAvailable: '不可用',
        noData: '暂无数据',
        clickToInspect: '点击查看',
        requestFailed: '请求失败',
        detailConfidence: '置信度',
        detailImportance: '重要度',
        detailSalience: '显著度',
        detailStability: '稳定度',
        detailRetrievability: '可提取度',
        detailAccess: '访问次数',
        detailReview: '复习次数',
        detailLapse: '遗忘次数',
        detailRecorded: '记录时间',
        detailValid: '有效时间',
        detailLastAccess: '最后访问',
        detailCompression: '压缩方式',
        detailEvent: 'event id',
        detailSession: 'session id',
        detailTurn: 'turn id',
        detailHash: 'hash',
        detailState: '状态',
        detailKind: '类型',
        detailActor: 'actor',
        detailSource: 'source',
        detailScope: 'scope',
      },
      en: {
        navLabel: 'Cortex memory',
        title: 'Cortex memory',
        subtitle: 'Layered memory · self-state · guardian · evolution',
        refresh: 'Refresh',
        loading: 'Loading…',
        retry: 'Retry',
        error: 'Error',
        tabSelf: 'Self',
        tabSearch: 'Search',
        tabHealth: 'Guardian',
        tabEvolution: 'Evolution',
        tabPlaybook: 'Playbook',
        tabTimeline: 'Timeline',
        tabAudit: 'Audit',
        tabRetention: 'Retention',
        tabWorking: 'Work/Goals',
        tabEmotion: 'Emotion',
        tabLife: 'Life',
        tabGraph: 'Graph',
        tabSettings: 'Settings',
        playbookHint: 'Candidates are not injected; approve one before it enters the per-turn context.',
        playbookCandidates: 'Candidate rules',
        playbookActive: 'Active rules',
        playbookApprove: 'Approve',
        playbookReject: 'Retire',
        playbookEmpty: '(no candidate rules)',
        playbookSuggest: 'Suggest',
        drives: 'Drives',
        mood: 'Mood',
        identity: 'Identity',
        relationships: 'Relationships',
        intentions: 'Intentions',
        calibration: 'Calibration',
        searchPlaceholder: 'Search memories, facts, episodes…',
        search: 'Search',
        results: 'Results',
        noResults: 'No hits.',
        detail: 'Detail',
        close: 'Close',
        score: 'Health',
        issues: 'Issues',
        ok: 'OK',
        counts: 'Counts',
        backup: 'Backup',
        repair: 'Repair FTS',
        guardCheck: 'Self-check',
        activePolicies: 'Active policies',
        candidates: 'Candidates',
        optimize: 'Propose optimizations',
        approve: 'Approve',
        rollback: 'Roll back',
        noPolicies: 'No policies yet.',
        timelineHint: 'Enter a trace id to load neighbouring memories; opening Timeline from a search result or detail fills it in.',
        empty: '(empty)',
        errorPrefix: 'Request failed',
        stage: 'Stage',
        traced: 'Memories',
        searchText: 'Query text',
        searchTextHint: 'Free text; filters are folded into the same q parameter.',
        filters: 'Filters',
        filterKind: 'kind',
        filterTag: 'tag',
        filterAfter: 'after',
        filterBefore: 'before',
        filterImportance: 'importance',
        filterTagsHint: 'Separate multiple tags with commas or spaces',
        filterImportanceHint: '0–1, becomes importance:>value',
        queryPreview: 'Effective query',
        resultLimit: 'Limit',
        clearFilters: 'Clear filters',
        importanceRange: 'importance must be between 0 and 1.',
        searchNeedsQuery: 'Enter a query or at least one filter.',
        searchHint: 'Enter a query or filters to search; results include ranking reasons and budget.',
        searchLoading: 'Searching…',
        intent: 'Intent',
        elapsed: 'Elapsed',
        candidateCount: 'Candidates',
        selectedCount: 'Selected',
        budgetUsed: 'Budget',
        openDetail: 'Open detail',
        detailTitle: 'Memory detail',
        detailLoading: 'Loading memory…',
        detailMeta: 'Metadata',
        detailContent: 'Content',
        detailSummary: 'Summary',
        detailTags: 'Tags',
        detailAttachments: 'Attachments (metadata only)',
        attachmentAddTitle: 'Attach a local file',
        attachmentAddHint: 'Enter a file:// path. Check uses the local reader (off by default); Attach only stores reference metadata.',
        attachmentCheck: 'Check',
        attachmentSave: 'Attach',
        attachmentSaved: 'Attached',
        extractTitle: 'Extract into memory',
        extractHint: 'OCR/ASR output is stored as a derived trace; the original trace is unchanged.',
        extractTarget: 'Target trace',
        extractLayout: 'Layout',
        layoutAuto: 'Auto',
        layoutSingle: 'Single column',
        layoutTwoColumn: 'Two columns',
        layoutHandwriting: 'Handwriting',
        extractRun: 'Extract and write',
        extractSaved: 'Derived trace written',
        extractSuggested: 'Suggested: current trace',
        extractChanged: 'Target changed',
        detailKeywords: 'Keywords',
        detailFeedback: 'Was this memory useful?',
        feedbackUsed: 'Used',
        feedbackHelpful: 'Helpful',
        feedbackIncorrect: 'Incorrect',
        feedbackCorrected: 'Corrected',
        feedbackSaved: 'Feedback recorded',
        feedbackFailed: 'Feedback failed',
        feedbackHint: 'Feedback updates DSR review state, confidence and relationships; it does not delete the memory.',
        openTimeline: 'Open timeline',
        closeDetail: 'Close detail',
        traceMissing: 'Trace not found (archived, or the id is wrong).',
        timelineAnchorId: 'Anchor trace id',
        timelineBeforeCount: 'Before',
        timelineAfterCount: 'After',
        timelineLoad: 'Load timeline',
        timelineAnchor: 'Anchor',
        timelineBefore: 'Before',
        timelineAfter: 'After',
        timelineEmpty: 'Enter a trace id to load its neighbouring memories.',
        timelineMissing: 'Anchor not found: the id may not exist or may be archived.',
        timelineNoItems: 'The anchor exists, but there are no neighbours to show.',
        timelineCount: 'items',
        auditTitle: 'Audit records',
        auditHint: 'Recent operations, newest first; read-only.',
        auditTime: 'Time',
        auditActor: 'Actor',
        auditAction: 'Action',
        auditTarget: 'Target',
        auditDetail: 'Detail',
        auditLimit: 'Page size',
        auditEmpty: 'No audit records yet.',
        auditCount: 'Total',
        retentionTitle: 'Retention plan',
        retentionHint: 'Read-only plan; nothing is changed here.',
        activeTraces: 'Active traces',
        candidateTraces: 'Archive candidates',
        planOnly: 'Plan only',
        applyRetention: 'Apply retention',
        retentionGap: 'Apply archives only the candidates in the current plan; it never deletes content, and important memories are never auto-archived.',
        retentionRules: 'Candidates are over the age/count limit and below the importance/confidence thresholds; reflections are never auto-archived.',
        retentionEmpty: 'No archive candidates right now.',
        retentionAge: 'Age',
        retentionImportance: 'Importance',
        retentionConfidence: 'Confidence',
        retentionReason: 'Reason',
        retentionAt: 'Planned at',
        retentionClick: 'Open candidate detail',
        graphTitle: 'Memory graph',
        graphHint: 'Only the top PageRank nodes are shown; the API does not return edges, so no fake edges are drawn.',
        graphNodes: 'Nodes',
        graphEdges: 'Edges',
        graphComponents: 'Components',
        graphCommunities: 'Communities',
        graphTop: 'Top nodes',
        graphEmpty: 'No graph nodes to show yet.',
        graphAria: 'Cortex memory graph: top PageRank nodes on centre and orbit positions.',
        graphRank: 'PageRank',
        graphScaleNote: 'Bigger nodes have higher PageRank; the orbits are layout guides, not edges.',
        graphTopCount: 'Showing',
        graphCandidatesTitle: 'Candidate edges (pending)',
        graphCandidatesHint: 'Candidate edges never enter the graph until approved.',
        graphCandidatesEmpty: 'No pending candidate edges.',
        graphApprove: 'Approve',
        graphReject: 'Reject',
        graphCandidateConfidence: 'Confidence',
        settingsTitle: 'Runtime settings',
        settingsHint: 'Settings and metrics are read-only snapshots.',
        runtime: 'Runtime',
        features: 'Feature flags',
        permissions: 'Permissions / network',
        permissionLocal: 'Local API',
        permissionNetwork: 'Outbound network',
        permissionOn: 'on',
        permissionOff: 'off',
        permissionConfirm: 'Permission changes write a local override and take effect after restarting DSH. Continue?',
        permissionSaved: 'Saved; restart DSH to apply.',
        permissionRestart: 'restart required',
        scopeGrants: 'Shared write grants',
        scopeGrantsHint: 'Only applies to API calls with x-cortex-agent; revoke is immediate and persisted. Tool calls do not send an agent header.',
        scopeGrantName: 'Grant (scope:agent)',
        scopeGrantUntil: 'Until (ISO, optional)',
        scopeGrantAdd: 'Add grant',
        scopeGrantRevoke: 'Revoke',
        scopeGrantEmpty: 'No shared write grants.',
        scopeGrantForever: 'forever',
        scopeGrantRevoked: 'Revoked',
        scopeGrantSaved: 'Saved',
        vectorEnable: 'Enable vector',
        vectorDisabled: 'Vector is off by default. Enabling uses the local hash-256 embedder (no model download); restart required.',
        modelTitle: 'Embedding / rerank models',
        modelHint: 'Local mode talks to an OpenAI-compatible local service (default Ollama bge-m3); remote mode uses /embeddings. Choose exactly one.',
        modelGuide: 'Model guide (expand)',
        modelGuideRemote: 'Remote mode requires an API key; saving is rejected without it. The key goes only into the password field, never into chat. Works with OpenAI, SiliconFlow, DashScope, and other compatible /embeddings services.',
        modelGuideLocal: 'Local mode accepts a blank key. Recommended: bge-m3 (multilingual, 1024 dims, ~1.2GB); on small machines use nomic-embed-text (768 dims, ~274MB, weaker Chinese).',
        modelGuideDefault: 'With no local model, hash remains the default and memory is never lost when the service is down; rebuild vectors after switching.',
        modelDownloadBge: 'Open bge-m3 page',
        modelMode: 'Mode',
        modelHash: 'hash (lexical fallback)',
        modelLocal: 'Local service',
        modelRemote: 'Remote service',
        modelBase: 'baseUrl',
        modelName: 'Model',
        modelDim: 'Dimensions',
        modelKey: 'API key (blank keeps current)',
        modelSave: 'Save model config',
        modelSaved: 'Saved; restart DSH to apply.',
        rerankTitle: 'rerank (optional)',
        rerankEnable: 'Enable rerank',
        rerankHint: 'Leave off to keep fusion order; failures fall back.',
        permissionClick: 'click to toggle',
        permissionApiLocked: 'The local API cannot disable itself from this panel',
        vector: 'Vector',
        scope: 'scope',
        dataRoot: 'dataRoot',
        readOnlyScopes: 'Read-only scopes',
        dbFile: 'dbFile',
        contextBudget: 'contextBudget',
        promptBudget: 'promptBudget',
        metricsTitle: 'Process metrics',
        counters: 'Counters',
        histograms: 'Histograms',
        metricName: 'Name',
        metricValue: 'Value',
        count: 'Count',
        p50: 'p50',
        p95: 'p95',
        max: 'max',
        metricsEmpty: 'No metric samples yet.',
        readOnlyNote: 'Read-only: this page never writes settings or memories.',
        refreshAll: 'Refresh all',
        metricAt: 'Sampled at',
        notAvailable: 'Not available',
        noData: 'No data',
        clickToInspect: 'Open',
        requestFailed: 'Request failed',
        detailConfidence: 'Confidence',
        detailImportance: 'Importance',
        detailSalience: 'Salience',
        detailStability: 'Stability',
        detailRetrievability: 'Retrievability',
        detailAccess: 'Accesses',
        detailReview: 'Reviews',
        detailLapse: 'Lapses',
        detailRecorded: 'Recorded',
        detailValid: 'Valid',
        detailLastAccess: 'Last access',
        detailCompression: 'Compression',
        detailEvent: 'event id',
        detailSession: 'session id',
        detailTurn: 'turn id',
        detailHash: 'hash',
        detailState: 'State',
        detailKind: 'Kind',
        detailActor: 'actor',
        detailSource: 'source',
        detailScope: 'scope',
      },
    };

    const CSS = `
.cortex-root{height:100%;overflow:auto;box-sizing:border-box;padding:20px 24px 36px;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-base,#fff);font:13px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.cortex-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
.cortex-title{margin:0;font-size:18px;font-weight:650}
.cortex-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px}
.cortex-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}
.cortex-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#2f6fed);color:var(--dsw-alias-brand-primary,#2f6fed)}
.cortex-btn.primary{background:var(--dsw-alias-brand-primary,#2f6fed);border-color:var(--dsw-alias-brand-primary,#2f6fed);color:#fff}
.cortex-btn:disabled{opacity:.5;cursor:not-allowed}
.cortex-btn:focus-visible,.cortex-tab:focus-visible,.cortex-input:focus-visible,.cortex-item:focus-visible,.cortex-graph-node:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:2px}
.cortex-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);margin-bottom:16px;overflow-x:auto}
.cortex-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);padding:7px 10px;border-bottom:2px solid transparent;font:inherit;cursor:pointer;white-space:nowrap}
.cortex-tab.on{color:var(--dsw-alias-brand-primary,#2f6fed);border-bottom-color:var(--dsw-alias-brand-primary,#2f6fed);font-weight:600}
.cortex-panel{min-height:120px}
.cortex-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.cortex-card{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:12px;padding:12px 14px;min-width:0}
.cortex-card h4{margin:0 0 6px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);font-weight:600}
.cortex-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.cortex-card-head h4{margin:0}
.cortex-big{font-size:18px;font-weight:650}
.cortex-row{display:flex;align-items:center;gap:6px;margin:3px 0;font-size:12px}
.cortex-dot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-brand-primary,#2f6fed);flex:none}
.cortex-bar{height:6px;background:var(--dsw-alias-bg-layer-2,#f1f3f5);border-radius:999px;overflow:hidden;margin-top:5px}
.cortex-bar>span{display:block;height:100%;background:var(--dsw-alias-brand-primary,#2f6fed);border-radius:999px}
.cortex-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;border-radius:9px;padding:8px 10px;font:inherit;font-size:13px}
select.cortex-input{cursor:pointer}
.cortex-line{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.cortex-toolbar{justify-content:flex-start}
.cortex-list{display:flex;flex-direction:column;gap:6px}
.cortex-item{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:9px;padding:8px 10px;cursor:pointer;background:var(--dsw-alias-bg-layer-1,#fff)}
.cortex-item:hover{border-color:var(--dsw-alias-brand-primary,#2f6fed)}
.cortex-item b{font-size:12px}
button.cortex-item{width:100%;color:inherit;font:inherit;text-align:left;appearance:none}
.cortex-meta{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;margin-top:2px}
.cortex-snippet{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:pre-wrap;word-break:break-word}
.cortex-err{border:1px solid var(--dsw-alias-state-error-primary,#d33);color:var(--dsw-alias-state-error-primary,#d33);border-radius:8px;padding:7px 10px;margin-bottom:10px;font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cortex-err-msg{flex:1;min-width:160px;word-break:break-word}
.cortex-empty{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;padding:10px 0}
.cortex-pre{white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:8px;padding:9px 11px;font:11px/1.5 "Cascadia Code","Consolas",monospace;max-height:320px;overflow:auto}
.cortex-loading{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;padding:10px 0}
.cortex-spinner{width:13px;height:13px;border-radius:999px;border:2px solid var(--dsw-alias-border-l1,#e5e7eb);border-top-color:var(--dsw-alias-brand-primary,#2f6fed);animation:cortex-spin .8s linear infinite;flex:none}
@keyframes cortex-spin{to{transform:rotate(360deg)}}
.cortex-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.cortex-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:10px 0}
.cortex-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.cortex-field-label{font-weight:600;letter-spacing:.02em}
.cortex-field-hint{font-size:10px;color:var(--dsw-alias-label-secondary,#6b7280);line-height:1.35}
.cortex-field .cortex-input{font-size:12px;padding:7px 8px}
.cortex-query-preview{display:flex;gap:8px;align-items:flex-start;margin:2px 0 10px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);flex-wrap:wrap}
.cortex-query-preview code{background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:6px;padding:2px 6px;color:var(--dsw-alias-label-primary,#1f2329);font:11px/1.5 "Cascadia Code","Consolas",monospace;word-break:break-word;white-space:pre-wrap;max-width:100%}
.cortex-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.cortex-badge{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:999px;padding:1px 7px;font-size:10px;line-height:1.6;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}
.cortex-badge.on{color:var(--dsw-alias-state-success-primary,#15803d);border-color:var(--dsw-alias-state-success-primary,#15803d)}
.cortex-badge.warn{color:var(--dsw-alias-state-warning-primary,#b45309);border-color:var(--dsw-alias-state-warning-primary,#b45309)}
button.cortex-badge{cursor:pointer;font:inherit}
button.cortex-badge:hover{border-color:var(--dsw-alias-brand-primary,#2f6fed);color:var(--dsw-alias-brand-primary,#2f6fed)}
button.cortex-badge:disabled{cursor:not-allowed;opacity:.55}
.cortex-result-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.cortex-result-title{flex:1;min-width:100px;word-break:break-word}
.cortex-result-score{font-size:10px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}
.cortex-result-meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;margin:2px 0 8px}
.cortex-note{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#6b7280);background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-left:3px solid var(--dsw-alias-border-l1,#e5e7eb);padding:7px 9px;border-radius:0 6px 6px 0;margin:6px 0}
.cortex-note.warn{border-left-color:var(--dsw-alias-state-warning-primary,#b45309);color:var(--dsw-alias-label-primary,#1f2329)}
.cortex-readonly{font-size:10px;color:var(--dsw-alias-label-secondary,#6b7280);display:inline-flex;align-items:center;gap:4px}
.cortex-drawer-backdrop{position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.38);display:flex;justify-content:flex-end;animation:cortex-fade .15s ease-out}
@keyframes cortex-fade{from{opacity:0}to{opacity:1}}
.cortex-drawer{width:min(580px,100%);height:100%;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2329);display:flex;flex-direction:column;box-shadow:-18px 0 48px rgba(15,23,42,.22);outline:none}
.cortex-drawer-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb)}
.cortex-drawer-head h3{margin:0;font-size:15px;line-height:1.4;word-break:break-word}
.cortex-drawer-sub{color:var(--dsw-alias-label-secondary,#6b7280);font-size:10px;margin-top:3px;word-break:break-all}
.cortex-drawer-body{padding:14px 18px 22px;overflow:auto;flex:1;min-height:0}
.cortex-drawer-foot{padding:10px 18px 16px;border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.cortex-detail-section{margin-top:14px}
.cortex-detail-section>h4{margin:0 0 5px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);font-weight:600;letter-spacing:.03em;text-transform:uppercase}
.cortex-content{white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.65;max-height:360px;overflow:auto}
.cortex-kv{display:grid;grid-template-columns:minmax(105px,auto) 1fr;gap:5px 12px;margin:0;font-size:11px}
.cortex-kv dt{color:var(--dsw-alias-label-secondary,#6b7280);font-weight:500}
.cortex-kv dd{margin:0;min-width:0;word-break:break-word}
.cortex-feedback{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.cortex-feedback-note{font-size:11px;color:var(--dsw-alias-state-success-primary,#15803d);margin-top:4px}
.cortex-feedback-error{font-size:11px;color:var(--dsw-alias-state-error-primary,#d33);margin-top:4px}
.cortex-timeline{position:relative;display:flex;flex-direction:column;gap:0;margin-top:6px}
.cortex-timeline-row{appearance:none;border:0;border-left:2px solid var(--dsw-alias-border-l1,#e5e7eb);background:transparent;color:inherit;font:inherit;text-align:left;display:grid;grid-template-columns:88px 1fr;gap:10px;padding:9px 10px 9px 12px;cursor:pointer;border-radius:0 8px 8px 0}
.cortex-timeline-row:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.cortex-timeline-row.anchor{border-left-color:var(--dsw-alias-brand-primary,#2f6fed);background:rgba(47,111,237,.06);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#2f6fed) 6%,transparent)}
.cortex-timeline-gutter{display:flex;align-items:flex-start;gap:6px;color:var(--dsw-alias-label-secondary,#6b7280);font-size:10px;padding-top:2px}
.cortex-timeline-dot{width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-border-l1,#e5e7eb);margin-top:5px;flex:none}
.cortex-timeline-row.anchor .cortex-timeline-dot{background:var(--dsw-alias-brand-primary,#2f6fed)}
.cortex-timeline-body{min-width:0;word-break:break-word}
.cortex-timeline-body b{font-size:12px}
.cortex-inline-field{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.cortex-inline-field .cortex-input{width:64px;padding:6px 7px}
.cortex-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:10px}
.cortex-table{border-collapse:collapse;width:100%;font-size:11px;min-width:560px}
.cortex-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2,#f7f8fa);color:var(--dsw-alias-label-secondary,#6b7280);text-align:left;font-weight:600;padding:7px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);white-space:nowrap}
.cortex-table td{padding:7px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);vertical-align:top;word-break:break-word}
.cortex-table tr:last-child td{border-bottom:0}
.cortex-code{font:10px/1.5 "Cascadia Code","Consolas",monospace;background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:4px;padding:1px 4px;word-break:break-word}
.cortex-table details summary{cursor:pointer;color:var(--dsw-alias-brand-primary,#2f6fed);font-size:10px}
.cortex-table details .cortex-pre{margin:6px 0 0;max-height:220px;min-width:220px}
.cortex-stat{display:flex;flex-direction:column;gap:1px}
.cortex-stat .cortex-big{font-size:20px}
.cortex-retention-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.cortex-retention-item{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cortex-retention-id{font:11px/1.5 "Cascadia Code","Consolas",monospace;word-break:break-all}
.cortex-retention-side{display:flex;gap:4px;flex-wrap:wrap}
.cortex-graph-card{padding:8px 10px 10px}
.cortex-graph-svg{display:block;width:100%;height:auto;max-height:420px;background:radial-gradient(circle at 50% 48%,var(--dsw-alias-bg-layer-2,#f7f8fa),transparent 68%);border-radius:10px}
.cortex-graph-orbit{fill:none;stroke:var(--dsw-alias-border-l1,#e5e7eb);stroke-width:1;stroke-dasharray:4 5}
.cortex-graph-dot{fill:var(--dsw-alias-brand-primary,#2f6fed);fill-opacity:.82;stroke:var(--dsw-alias-bg-base,#fff);stroke-width:2}
.cortex-graph-edge{stroke:var(--dsw-alias-border-l2,#cbd5e1);stroke-opacity:.45}
.cortex-graph-label{fill:var(--dsw-alias-label-primary,#1f2329);font-size:10px;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;pointer-events:none}
.cortex-graph-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:5px;margin-top:8px}
.cortex-graph-top-row{display:flex;justify-content:space-between;gap:6px;font-size:11px;border-bottom:1px dashed var(--dsw-alias-border-l1,#e5e7eb);padding:3px 0;min-width:0}
.cortex-graph-top-row span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cortex-graph-top-row span:last-child{color:var(--dsw-alias-label-secondary,#6b7280);flex:none}
.cortex-metrics-table td:last-child,.cortex-metrics-table th:last-child{text-align:right}
.cortex-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.cortex-detail-loading{padding:16px 0}
@media (max-width:640px){
  .cortex-root{padding:14px 12px 24px}
  .cortex-drawer{width:100%}
  .cortex-timeline-row{grid-template-columns:70px 1fr}
  .cortex-kv{grid-template-columns:95px 1fr}
}
`;

    function useDict(ctx) {
      const [locale, setLocale] = useState(() => {
        try { return ctx.locale.getSnapshot(); } catch { return 'zh'; }
      });
      useEffect(() => {
        let off = null;
        try { off = ctx.locale.subscribe(() => setLocale(ctx.locale.getSnapshot())); } catch { /* optional */ }
        return () => { try { off?.(); } catch { /* ignore */ } };
      }, [ctx]);
      const lang = String(locale ?? 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
      return (key) => DICT[lang][key] ?? DICT.zh[key] ?? key;
    }

    async function api(path, init = {}) {
      const headers = { ...(init.headers ?? {}) };
      if (init.body) {
        headers['content-type'] = 'application/json';
        headers['x-cortex'] = '1';
      }
      const response = await fetch(`${API}${path}`, { cache: 'no-store', credentials: 'same-origin', ...init, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload.data;
    }

    const FEEDBACK_SIGNALS = [
      ['used', 'feedbackUsed'],
      ['helpful', 'feedbackHelpful'],
      ['incorrect', 'feedbackIncorrect'],
      ['corrected', 'feedbackCorrected'],
    ];

    const KIND_OPTIONS = [
      'utterance', 'observation', 'decision', 'promise',
      'preference', 'emotion', 'instruction', 'reflection',
    ];

    function formatTime(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return String(value);
      const pad = (part) => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatNumber(value, digits = 3) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      const fixed = number.toFixed(digits);
      return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
    }

    function toPercent(value) {
      const number = Number(value);
      return Number.isFinite(number) ? `${Math.round(number * 100)}%` : '—';
    }

    function displayValue(value) {
      if (value == null || value === '') return '—';
      if (Array.isArray(value)) return value.length ? value.join('、') : '—';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }

    function cleanToken(value) {
      return String(value ?? '').trim().replace(/\s+/g, '');
    }

    /**
     * The server parses filters from the single q string. Keep every filter in
     * that one string; do not send invented kind/tag/after query parameters.
     */
    function buildSearchQuery(filters, text) {
      const parts = [];
      const free = String(text ?? '').trim();
      if (free) parts.push(free);
      const add = (key, value) => {
        const clean = cleanToken(value);
        if (clean) parts.push(`${key}:${clean}`);
      };
      add('kind', filters.kind);
      String(filters.tag ?? '').split(/[,\uFF0C\s]+/).map((tag) => tag.trim()).filter(Boolean).forEach((tag) => add('tag', tag));
      add('after', filters.after);
      add('before', filters.before);
      const importance = String(filters.importance ?? '').trim();
      if (importance) {
        const number = Number(importance);
        if (Number.isFinite(number)) parts.push(`importance:>${number}`);
      }
      return parts.join(' ');
    }

    function useEndpoint(path, { enabled = true } = {}) {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(Boolean(enabled && path));
      const [tick, setTick] = useState(0);
      useEffect(() => {
        if (!enabled || !path) return undefined;
        let alive = true;
        setBusy(true);
        setError('');
        api(path)
          .then((value) => { if (alive) { setData(value); setBusy(false); } })
          .catch((issue) => { if (alive) { setError(String(issue.message ?? issue)); setBusy(false); } });
        return () => { alive = false; };
      }, [path, enabled, tick]);
      return { data, error, busy, reload: () => setTick((value) => value + 1), setData };
    }

    function LoadingBlock({ label }) {
      return h('div', { className: 'cortex-loading', role: 'status', 'aria-live': 'polite' }, [
        h('span', { key: 's', className: 'cortex-spinner', 'aria-hidden': 'true' }),
        h('span', { key: 'l' }, label),
      ]);
    }

    function ErrorBlock({ message, onRetry, retryLabel, prefix }) {
      return h('div', { className: 'cortex-err', role: 'alert' }, [
        h('span', { key: 'm', className: 'cortex-err-msg' }, `${prefix ? `${prefix}: ` : ''}${message}`),
        onRetry ? h('button', { key: 'r', type: 'button', className: 'cortex-btn', onClick: onRetry }, retryLabel) : null,
      ]);
    }

    function EmptyBlock({ children }) {
      return h('div', { className: 'cortex-empty', role: 'status' }, children);
    }

    function Field({ label, hint, children }) {
      return h('label', { className: 'cortex-field' }, [
        h('span', { key: 'l', className: 'cortex-field-label' }, label),
        children,
        hint ? h('span', { key: 'h', className: 'cortex-field-hint' }, hint) : null,
      ]);
    }

    function Badge({ children, tone = '' }) {
      return h('span', { className: `cortex-badge${tone ? ` ${tone}` : ''}` }, children);
    }

    function KeyValueList({ rows }) {
      return h('dl', { className: 'cortex-kv' }, (rows ?? []).map(([key, label, value]) => h(
        React.Fragment,
        { key },
        [
          h('dt', { key: 'k' }, label),
          h('dd', { key: 'v' }, value),
        ],
      )));
    }

    function Icon({ size = 18, active = false }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 64 64', 'aria-hidden': true, style: { display: 'block', opacity: active ? 1 : 0.85 } }, [
        h('rect', { key: 'r', x: 4, y: 4, width: 56, height: 56, rx: 16, fill: 'currentColor', opacity: 0.12 }),
        h('path', { key: 'b', d: 'M16 36c6-12 26-12 32 0-6 12-26 12-32 0Z', fill: 'currentColor', opacity: 0.9 }),
        h('circle', { key: 'e1', cx: 28, cy: 32, r: 2.4, fill: 'var(--dsw-alias-bg-base,#fff)' }),
        h('circle', { key: 'e2', cx: 36, cy: 32, r: 2.4, fill: 'var(--dsw-alias-bg-base,#fff)' }),
      ]);
    }

    function Meter({ label, value, max = 1 }) {
      const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
      return h('div', { style: { margin: '5px 0' } }, [
        h('div', { key: 'l', className: 'cortex-row' }, [h('span', { key: 'd', className: 'cortex-dot' }), h('span', { key: 't', style: { flex: 1 } }, label), h('span', { key: 'v', className: 'cortex-meta' }, `${Math.round(ratio * 100)}%`)]),
        h('div', { key: 'b', className: 'cortex-bar' }, h('span', { style: { width: `${Math.round(ratio * 100)}%` } })),
      ]);
    }

    function SelfTab({ data }) {
      if (!data) return null;
      const self = data.self;
      const identity = data.identity;
      const rel = data.relationships ?? [];
      const intents = data.intentions ?? [];
      const cal = data.calibration;
      return h('div', {}, [
        h('div', { key: 'g', className: 'cortex-grid' }, [
          h('div', { key: 'stage', className: 'cortex-card' }, [h('h4', {}, '阶段'), h('div', { className: 'cortex-big' }, self.stage), h('div', { className: 'cortex-meta' }, `mood ${self.mood.valence.toFixed(2)} / ${self.mood.arousal.toFixed(2)}`)]),
          h('div', { key: 'cal', className: 'cortex-card' }, [h('h4', {}, '校准'), h('div', { className: 'cortex-big' }, cal?.brier == null ? '—' : cal.brier.toFixed(3)), h('div', { className: 'cortex-meta' }, `n=${cal?.n ?? 0} · ECE ${cal?.ece == null ? '—' : cal.ece.toFixed(3)}`)]),
          h('div', { key: 'rel', className: 'cortex-card' }, [h('h4', {}, '关系'), ...(rel.length ? rel.map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${item.target} · 信任 ${Math.round(item.trust * 100)}% · 在乎 ${Math.round(item.care * 100)}%`)) : [h('div', { key: 'none', className: 'cortex-empty' }, '—')])]),
          h('div', { key: 'int', className: 'cortex-card' }, [h('h4', {}, '主动意图'), ...(intents.length ? intents.slice(0, 6).map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${item.kind} · ${item.reason ?? ''}`)) : [h('div', { key: 'none', className: 'cortex-empty' }, '—')])]),
        ]),
        h('div', { key: 'drives', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, '驱力'), ...Object.entries(self.drives).map(([name, value]) => h(Meter, { key: name, label: name, value }))]),
        h('div', { key: 'id', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, `身份 v${identity?.version ?? '—'}`), h('div', { className: 'cortex-pre' }, identity?.content?.narrative ?? '—')]),
      ]);
    }

    function SearchTab({ t, onSelect }) {
      const [text, setText] = useState('');
      const [filters, setFilters] = useState({ kind: '', tag: '', after: '', before: '', importance: '' });
      const [limit, setLimit] = useState(10);
      const [result, setResult] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const requestSeq = useRef(0);
      const query = buildSearchQuery(filters, text);
      const change = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

      const run = useCallback(async () => {
        if (busy) return;
        const built = buildSearchQuery(filters, text);
        if (!built) {
          setError(t('searchNeedsQuery'));
          setResult(null);
          return;
        }
        const importance = String(filters.importance ?? '').trim();
        if (importance) {
          const number = Number(importance);
          if (!Number.isFinite(number) || number < 0 || number > 1) {
            setError(t('importanceRange'));
            setResult(null);
            return;
          }
        }
        const token = requestSeq.current + 1;
        requestSeq.current = token;
        setBusy(true);
        setError('');
        try {
          const data = await api(`/search?q=${encodeURIComponent(built)}&limit=${limit}`);
          if (requestSeq.current !== token) return;
          setResult(data);
        } catch (issue) {
          if (requestSeq.current !== token) return;
          setResult(null);
          setError(String(issue.message ?? issue));
        } finally {
          if (requestSeq.current === token) setBusy(false);
        }
      }, [filters, text, limit, busy, t]);

      const clear = () => {
        requestSeq.current += 1;
        setBusy(false);
        setText('');
        setFilters({ kind: '', tag: '', after: '', before: '', importance: '' });
        setResult(null);
        setError('');
      };

      const items = result?.items ?? [];
      const enter = (event) => { if (event.key === 'Enter') { event.preventDefault(); run(); } };

      return h('div', {}, [
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('label', { key: 'ql', className: 'cortex-field', style: { flex: '1 1 260px' } }, [
            h('span', { key: 'l', className: 'cortex-field-label' }, t('searchText')),
            h('input', {
              key: 'q',
              className: 'cortex-input',
              value: text,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchText'),
              onChange: (event) => setText(event.target.value),
              onKeyDown: enter,
            }),
            h('span', { key: 'h', className: 'cortex-field-hint' }, t('searchTextHint')),
          ]),
          h('label', { key: 'll', className: 'cortex-field', style: { flex: '0 0 90px' } }, [
            h('span', { key: 'l', className: 'cortex-field-label' }, t('resultLimit')),
            h('select', {
              key: 'l',
              className: 'cortex-input cortex-select',
              value: limit,
              'aria-label': t('resultLimit'),
              onChange: (event) => setLimit(Number(event.target.value) || 10),
            }, [10, 20].map((value) => h('option', { key: value, value }, String(value)))),
          ]),
          h('button', { key: 'b', type: 'button', className: 'cortex-btn primary', disabled: busy, onClick: run }, busy ? t('searchLoading') : t('search')),
          h('button', { key: 'c', type: 'button', className: 'cortex-btn', onClick: clear }, t('clearFilters')),
        ]),
        h('div', { key: 'filters', className: 'cortex-filters' }, [
          h(Field, { key: 'kind', label: t('filterKind'), hint: KIND_OPTIONS.join(' / ') }, h('input', {
            className: 'cortex-input',
            list: 'cortex-kind-options',
            value: filters.kind,
            placeholder: 'utterance',
            'aria-label': t('filterKind'),
            onChange: (event) => change('kind', event.target.value),
            onKeyDown: enter,
          })),
          h(Field, { key: 'tag', label: t('filterTag'), hint: t('filterTagsHint') }, h('input', {
            className: 'cortex-input',
            value: filters.tag,
            placeholder: '白饭, 主人',
            'aria-label': t('filterTag'),
            onChange: (event) => change('tag', event.target.value),
            onKeyDown: enter,
          })),
          h(Field, { key: 'after', label: t('filterAfter') }, h('input', {
            className: 'cortex-input',
            type: 'date',
            value: filters.after,
            'aria-label': t('filterAfter'),
            onChange: (event) => change('after', event.target.value),
          })),
          h(Field, { key: 'before', label: t('filterBefore') }, h('input', {
            className: 'cortex-input',
            type: 'date',
            value: filters.before,
            'aria-label': t('filterBefore'),
            onChange: (event) => change('before', event.target.value),
          })),
          h(Field, { key: 'importance', label: t('filterImportance'), hint: t('filterImportanceHint') }, h('input', {
            className: 'cortex-input',
            type: 'number',
            min: 0,
            max: 1,
            step: 0.05,
            value: filters.importance,
            placeholder: '0.5',
            'aria-label': t('filterImportance'),
            onChange: (event) => change('importance', event.target.value),
            onKeyDown: enter,
          })),
        ]),
        h('datalist', { key: 'kinds', id: 'cortex-kind-options' }, KIND_OPTIONS.map((kind) => h('option', { key: kind, value: kind }))),
        query ? h('div', { key: 'preview', className: 'cortex-query-preview' }, [
          h('span', { key: 'l' }, `${t('queryPreview')}:`),
          h('code', { key: 'q' }, query),
        ]) : null,
        error ? h(ErrorBlock, { key: 'err', message: error }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('searchLoading') }) : null,
        result ? h('div', { key: 'rmeta', className: 'cortex-result-meta' }, [
          h('span', { key: 'n' }, `${t('results')} ${items.length}`),
          result.intent ? h('span', { key: 'i' }, `${t('intent')} ${result.intent}`) : null,
          result.trace?.elapsedMs != null ? h('span', { key: 'e' }, `${t('elapsed')} ${result.trace.elapsedMs} ms`) : null,
          result.trace?.candidates != null ? h('span', { key: 'c' }, `${t('candidateCount')} ${result.trace.candidates}`) : null,
          result.trace?.selected != null ? h('span', { key: 's' }, `${t('selectedCount')} ${result.trace.selected}`) : null,
          result.budget ? h('span', { key: 'b' }, `${t('budgetUsed')} ${result.budget.used}/${result.budget.total}`) : null,
        ]) : null,
        !result && !busy && !error ? h(EmptyBlock, { key: 'hint' }, t('searchHint')) : null,
        result && !items.length ? h(EmptyBlock, { key: 'none' }, t('noResults')) : null,
        h('div', { key: 'list', className: 'cortex-list', id: 'cortex-search-results', 'aria-live': 'polite' }, items.map((item) => h(
          'button',
          {
            key: item.id,
            type: 'button',
            className: 'cortex-item cortex-result',
            onClick: () => onSelect?.(item),
            'aria-label': `${t('openDetail')}: ${item.title ?? item.id}`,
          },
          [
            h('div', { key: 'head', className: 'cortex-result-head' }, [
              h(Badge, { key: 'layer' }, item.layer ?? item.type ?? 'trace'),
              h('b', { key: 'title', className: 'cortex-result-title' }, item.title ?? item.id),
              item.attachments ? h('span', { key: 'attachments', className: 'cortex-meta' }, `📎 ${item.attachments}`) : null,
              h('span', { key: 'score', className: 'cortex-result-score' }, `score ${formatNumber(item.score, 3)}`),
            ]),
            h('div', { key: 'meta', className: 'cortex-meta' }, `${item.id} · ${formatTime(item.recordedAt)}${item.why ? ` · ${item.why}` : ''}`),
            h('div', { key: 'snippet', className: 'cortex-snippet' }, item.snippet ?? ''),
          ],
        ))),
      ]);
    }

    function traceMetaRows(trace, t) {
      return [
        ['id', 'ID', trace.id],
        ['kind', t('detailKind'), trace.kind],
        ['state', t('detailState'), trace.state],
        ['actor', t('detailActor'), trace.actor],
        ['source', t('detailSource'), trace.source],
        ['scope', t('detailScope'), trace.scopeId],
        ['importance', t('detailImportance'), toPercent(trace.importance)],
        ['confidence', t('detailConfidence'), toPercent(trace.confidence)],
        ['salience', t('detailSalience'), toPercent(trace.salience)],
        ['stability', t('detailStability'), formatNumber(trace.stability, 2)],
        ['retrievability', t('detailRetrievability'), toPercent(trace.retrievability)],
        ['access', t('detailAccess'), trace.accessCount],
        ['review', t('detailReview'), trace.reviewCount],
        ['lapse', t('detailLapse'), trace.lapseCount],
        ['recorded', t('detailRecorded'), formatTime(trace.recordedAt)],
        ['valid', t('detailValid'), formatTime(trace.validAt)],
        ['lastAccess', t('detailLastAccess'), formatTime(trace.lastAccessAt)],
        ['compression', t('detailCompression'), trace.compression],
        ['event', t('detailEvent'), trace.eventId],
        ['session', t('detailSession'), trace.sessionId],
        ['turn', t('detailTurn'), trace.turnId],
        ['hash', t('detailHash'), trace.hash],
      ].map(([key, label, value]) => [key, label, displayValue(value)]);
    }

    function AttachmentComposer({ trace, t, onSaved }) {
      const [uri, setUri] = useState('');
      const [note, setNote] = useState('');
      const [busy, setBusy] = useState(false);
      const inspect = async () => {
        if (!uri.trim()) return;
        setBusy(true); setNote('');
        try {
          const result = await api('/attachments/inspect', { method: 'POST', body: JSON.stringify({ uri: uri.trim() }) });
          setNote(`${result.name} · ${result.bytes} B · ${result.sha256.slice(0, 16)}…`);
        } catch (issue) {
          setNote(String(issue.message ?? issue));
        } finally { setBusy(false); }
      };
      const save = async () => {
        if (!uri.trim()) return;
        setBusy(true); setNote('');
        try {
          await api('/trace/attachments', { method: 'POST', body: JSON.stringify({ id: trace.id, attachments: [{ kind: 'file', uri: uri.trim() }] }) });
          setUri('');
          setNote(t('attachmentSaved'));
          onSaved?.();
        } catch (issue) {
          setNote(String(issue.message ?? issue));
        } finally { setBusy(false); }
      };
      return h('section', { className: 'cortex-detail-section' }, [
        h('h4', {}, t('attachmentAddTitle')),
        h('div', { className: 'cortex-note' }, t('attachmentAddHint')),
        h('div', { className: 'cortex-line' }, [
          h('input', { className: 'cortex-input', value: uri, placeholder: 'file:///C:/path/rice.png', onChange: (event) => setUri(event.target.value) }),
          h('button', { type: 'button', className: 'cortex-btn', disabled: busy || !uri.trim(), onClick: inspect }, t('attachmentCheck')),
          h('button', { type: 'button', className: 'cortex-btn', disabled: busy || !uri.trim(), onClick: save }, t('attachmentSave')),
        ]),
        note ? h('div', { className: 'cortex-meta' }, note) : null,
      ]);
    }

    function ExtractionComposer({ trace, t, onSaved }) {
      const [uri, setUri] = useState('');
      const [mode, setMode] = useState('ocr');
      const [language, setLanguage] = useState('');
      const [layout, setLayout] = useState('auto');
      const [targetId, setTargetId] = useState(trace.id);
      const [candidates, setCandidates] = useState([{ id: trace.id, title: trace.title || trace.snippet || trace.id }]);
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState('');
      useEffect(() => {
        let alive = true;
        api(`/timeline?id=${encodeURIComponent(trace.id)}&before=5&after=5`)
          .then((value) => {
            if (!alive) return;
            const list = [];
            const seen = new Set();
            const push = (item) => {
              if (!item?.id || seen.has(item.id)) return;
              seen.add(item.id);
              list.push({ id: item.id, title: item.title || item.snippet || item.id });
            };
            push(value?.anchor);
            for (const item of value?.items ?? []) push(item);
            if (!list.length) push({ id: trace.id, title: trace.title || trace.id });
            setCandidates(list.slice(0, 8));
          })
          .catch(() => {});
        return () => { alive = false; };
      }, [trace.id]);
      const run = async () => {
        if (!uri.trim()) return;
        setBusy(true); setNote('');
        try {
          const result = await api('/attachments/extract', {
            method: 'POST',
            body: JSON.stringify({ uri: uri.trim(), mode, language: language.trim() || undefined, layout, traceId: targetId }),
          });
          setNote(`${t('extractSaved')} ${result.extractedTraceId ?? ''}`.trim());
          setUri('');
          onSaved?.();
        } catch (issue) {
          setNote(String(issue.message ?? issue));
        } finally { setBusy(false); }
      };
      return h('section', { className: 'cortex-detail-section' }, [
        h('h4', {}, t('extractTitle')),
        h('div', { className: 'cortex-note' }, t('extractHint')),
        h('div', { className: 'cortex-line' }, [
          h('input', { className: 'cortex-input', value: uri, placeholder: 'file:///C:/path/rice.png', onChange: (event) => setUri(event.target.value) }),
          h('select', { className: 'cortex-input', value: mode, onChange: (event) => setMode(event.target.value) }, [
            h('option', { key: 'ocr', value: 'ocr' }, 'OCR'),
            h('option', { key: 'asr', value: 'asr' }, 'ASR'),
          ]),
          h('input', { className: 'cortex-input', value: language, placeholder: mode === 'ocr' ? 'zh-Hans' : 'zh', onChange: (event) => setLanguage(event.target.value) }),
          h('select', { className: 'cortex-input', value: layout, title: t('extractLayout'), onChange: (event) => setLayout(event.target.value) }, [
            h('option', { key: 'auto', value: 'auto' }, t('layoutAuto')),
            h('option', { key: 'single', value: 'single' }, t('layoutSingle')),
            h('option', { key: 'two-column', value: 'two-column' }, t('layoutTwoColumn')),
            h('option', { key: 'handwriting', value: 'handwriting' }, t('layoutHandwriting')),
          ]),
        ]),
        h('label', { className: 'cortex-line', style: { marginTop: 8 } }, [
          t('extractTarget'),
          h('select', { className: 'cortex-input', value: targetId, onChange: (event) => setTargetId(event.target.value) }, candidates.map((item) => h('option', { key: item.id, value: item.id }, `${item.title} · ${item.id}`))),
        ]),
        h('div', { className: 'cortex-line' }, [
          h('button', { type: 'button', className: 'cortex-btn', disabled: busy || !uri.trim(), onClick: run }, t('extractRun')),
          h('span', { className: 'cortex-meta' }, targetId === trace.id ? t('extractSuggested') : t('extractChanged')),
        ]),
        note ? h('div', { className: 'cortex-meta' }, note) : null,
      ]);
    }

    function TraceDetail({ id, t, onClose, onTimeline }) {
      const [trace, setTrace] = useState(null);
      const [loading, setLoading] = useState(true);
      const [loadError, setLoadError] = useState('');
      const [feedbackBusy, setFeedbackBusy] = useState('');
      const [feedbackNote, setFeedbackNote] = useState('');
      const [feedbackError, setFeedbackError] = useState('');
      const closeRef = useRef(null);
      const dialogRef = useRef(null);

      const loadTrace = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
          setTrace(await api(`/trace?id=${encodeURIComponent(id)}`));
        } catch (issue) {
          setTrace(null);
          setLoadError(String(issue.message ?? issue));
        } finally {
          setLoading(false);
        }
      }, [id]);

      useEffect(() => {
        if (id) loadTrace();
      }, [id, loadTrace]);

      useEffect(() => {
        const previous = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        try { closeRef.current?.focus?.(); } catch { /* focus is best-effort */ }

        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose?.();
            return;
          }
          if (event.key !== 'Tab' || !dialogRef.current) return;
          const focusable = Array.from(dialogRef.current.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.body.style.overflow = previousOverflow;
          try { previous?.focus?.(); } catch { /* focus is best-effort */ }
        };
      }, [onClose]);

      const sendFeedback = async (signal) => {
        if (!trace?.id) return;
        setFeedbackBusy(signal);
        setFeedbackError('');
        setFeedbackNote('');
        try {
          const data = await api('/feedback', { method: 'POST', body: JSON.stringify({ id: trace.id, signal }) });
          if (data?.trace) setTrace(data.trace);
          setFeedbackNote(data?.grade ? `${t('feedbackSaved')} · grade ${data.grade}` : t('feedbackSaved'));
        } catch (issue) {
          setFeedbackError(String(issue.message ?? issue));
        } finally {
          setFeedbackBusy('');
        }
      };

      const title = trace?.title || t('detailTitle');
      return h('div', {
        className: 'cortex-drawer-backdrop',
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose?.(); },
      }, [
        h('div', {
          key: 'd',
          ref: dialogRef,
          className: 'cortex-drawer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'cortex-detail-title',
          'aria-describedby': 'cortex-detail-id',
          tabIndex: -1,
        }, [
          h('div', { key: 'head', className: 'cortex-drawer-head' }, [
            h('div', { key: 't' }, [
              h('h3', { id: 'cortex-detail-title' }, title),
              h('div', { key: 'id', id: 'cortex-detail-id', className: 'cortex-drawer-sub' }, id),
            ]),
            h('button', {
              key: 'x',
              ref: closeRef,
              type: 'button',
              className: 'cortex-btn',
              onClick: onClose,
              'aria-label': t('closeDetail'),
            }, `✕ ${t('close')}`),
          ]),
          h('div', { key: 'body', className: 'cortex-drawer-body' }, [
            loading ? h('div', { key: 'loading', className: 'cortex-detail-loading' }, h(LoadingBlock, { label: t('detailLoading') })) : null,
            loadError ? h(ErrorBlock, {
              key: 'err',
              message: loadError,
              prefix: t('detail'),
              onRetry: loadTrace,
              retryLabel: t('retry'),
            }) : null,
            !loading && !loadError && !trace ? h(EmptyBlock, { key: 'missing' }, t('traceMissing')) : null,
            trace ? h('div', { key: 'trace' }, [
              trace.summary ? h('section', { key: 'summary', className: 'cortex-detail-section' }, [
                h('h4', {}, t('detailSummary')),
                h('div', { className: 'cortex-content' }, trace.summary),
              ]) : null,
              h('section', { key: 'content', className: 'cortex-detail-section' }, [
                h('h4', {}, t('detailContent')),
                h('div', { className: 'cortex-content' }, trace.content || t('empty')),
              ]),
              (trace.tags ?? []).length ? h('section', { key: 'tags', className: 'cortex-detail-section' }, [
                h('h4', {}, t('detailTags')),
                h('div', { className: 'cortex-chips' }, trace.tags.map((tag, index) => h(Badge, { key: `${tag}-${index}` }, tag))),
              ]) : null,
              (trace.metadata?.attachments ?? []).length ? h('section', { key: 'attachments', className: 'cortex-detail-section' }, [
                h('h4', {}, t('detailAttachments')),
                h('div', { className: 'cortex-note' }, trace.metadata.attachments.map((item, index) => h('div', { key: `${item.uri}-${index}` }, `${item.kind} · ${item.name ?? item.uri}${item.mime ? ` · ${item.mime}` : ''}${item.bytes ? ` · ${item.bytes} B` : ''}`))),
              ]) : null,
              h(AttachmentComposer, { key: 'attach', trace, t, onSaved: loadTrace }),
              h(ExtractionComposer, { key: 'extract', trace, t, onSaved: loadTrace }),
              (trace.keywords ?? []).length ? h('section', { key: 'keywords', className: 'cortex-detail-section' }, [
                h('h4', {}, t('detailKeywords')),
                h('div', { className: 'cortex-chips' }, trace.keywords.map((keyword, index) => h(Badge, { key: `${keyword}-${index}` }, keyword))),
              ]) : null,
              h('section', { key: 'meta', className: 'cortex-detail-section' }, [
                h('h4', {}, t('detailMeta')),
                h(KeyValueList, { rows: traceMetaRows(trace, t) }),
              ]),
              h('section', { key: 'feedback', className: 'cortex-detail-section' }, [
                h('h4', {}, t('detailFeedback')),
                h('div', { className: 'cortex-feedback', role: 'group', 'aria-label': t('detailFeedback') }, FEEDBACK_SIGNALS.map(([signal, key]) => h(
                  'button',
                  {
                    key: signal,
                    type: 'button',
                    className: 'cortex-btn',
                    disabled: Boolean(feedbackBusy),
                    onClick: () => sendFeedback(signal),
                    'aria-label': `${t(key)} ${trace.id}`,
                  },
                  feedbackBusy === signal ? t('loading') : t(key),
                ))),
                h('div', { className: 'cortex-note' }, t('feedbackHint')),
                feedbackNote ? h('div', { key: 'ok', className: 'cortex-feedback-note', role: 'status' }, feedbackNote) : null,
                feedbackError ? h('div', { key: 'bad', className: 'cortex-feedback-error', role: 'alert' }, `${t('feedbackFailed')}: ${feedbackError}`) : null,
              ]),
            ]) : null,
          ]),
          h('div', { key: 'foot', className: 'cortex-drawer-foot' }, [
            trace ? h('button', {
              key: 'timeline',
              type: 'button',
              className: 'cortex-btn primary',
              onClick: () => onTimeline?.(trace.id),
            }, t('openTimeline')) : null,
            h('button', { key: 'close', type: 'button', className: 'cortex-btn', onClick: onClose }, t('close')),
          ]),
        ]),
      ]);
    }

    function TimelineTab({ t, anchorId, onAnchorChange, onSelect }) {
      const initialAnchor = String(anchorId ?? '').trim();
      const [draft, setDraft] = useState(initialAnchor);
      const [committed, setCommitted] = useState(initialAnchor);
      const [before, setBefore] = useState(4);
      const [after, setAfter] = useState(4);
      const [data, setData] = useState(null);
      const [busy, setBusy] = useState(Boolean(initialAnchor));
      const [error, setError] = useState('');
      const [tick, setTick] = useState(0);

      useEffect(() => {
        const next = String(anchorId ?? '').trim();
        if (next && next !== committed) {
          setDraft(next);
          setCommitted(next);
        }
      }, [anchorId, committed]);

      useEffect(() => {
        if (!committed) { setData(null); setError(''); setBusy(false); return undefined; }
        let alive = true;
        setBusy(true);
        setError('');
        setData(null);
        api(`/timeline?id=${encodeURIComponent(committed)}&before=${before}&after=${after}`)
          .then((value) => { if (alive) { setData(value); setBusy(false); } })
          .catch((issue) => { if (alive) { setError(String(issue.message ?? issue)); setBusy(false); } });
        return () => { alive = false; };
      }, [committed, before, after, tick]);

      const submit = () => {
        const next = draft.trim();
        if (!next) {
          setError(t('timelineMissing'));
          setData(null);
          setCommitted('');
          setBusy(false);
          return;
        }
        setError('');
        setCommitted(next);
        setTick((value) => value + 1);
        onAnchorChange?.(next);
      };

      const rawItems = data?.items ?? [];
      const items = rawItems.length
        ? rawItems
        : (data?.anchor ? [{
          id: data.anchor.id,
          title: data.anchor.title,
          snippet: (data.anchor.summary || data.anchor.content || '').slice(0, 160),
          recordedAt: data.anchor.recordedAt,
          kind: data.anchor.kind,
          isAnchor: true,
        }] : []);
      const anchorIndex = items.findIndex((item) => item.isAnchor);
      const relative = (index) => {
        if (index === anchorIndex) return t('timelineAnchor');
        if (anchorIndex < 0) return '';
        return index < anchorIndex ? t('timelineBefore') : t('timelineAfter');
      };

      return h('div', {}, [
        h('div', { key: 'hint', className: 'cortex-note' }, t('timelineHint')),
        h('form', {
          key: 'form',
          className: 'cortex-line cortex-toolbar',
          onSubmit: (event) => { event.preventDefault(); submit(); },
        }, [
          h('label', { key: 'id', className: 'cortex-field', style: { flex: '1 1 260px' } }, [
            h('span', { key: 'l', className: 'cortex-field-label' }, t('timelineAnchorId')),
            h('input', {
              key: 'i',
              className: 'cortex-input',
              value: draft,
              placeholder: 'trc_…',
              'aria-label': t('timelineAnchorId'),
              onChange: (event) => setDraft(event.target.value),
            }),
          ]),
          h('label', { key: 'b', className: 'cortex-inline-field' }, [
            h('span', { key: 'l' }, t('timelineBeforeCount')),
            h('input', {
              key: 'i',
              className: 'cortex-input',
              type: 'number',
              min: 0,
              max: 50,
              value: before,
              'aria-label': t('timelineBeforeCount'),
              onChange: (event) => setBefore(Math.max(0, Math.min(50, Math.trunc(Number(event.target.value) || 0)))),
            }),
          ]),
          h('label', { key: 'a', className: 'cortex-inline-field' }, [
            h('span', { key: 'l' }, t('timelineAfterCount')),
            h('input', {
              key: 'i',
              className: 'cortex-input',
              type: 'number',
              min: 0,
              max: 50,
              value: after,
              'aria-label': t('timelineAfterCount'),
              onChange: (event) => setAfter(Math.max(0, Math.min(50, Math.trunc(Number(event.target.value) || 0)))),
            }),
          ]),
          h('button', { key: 'go', type: 'submit', className: 'cortex-btn primary', disabled: busy }, t('timelineLoad')),
        ]),
        !committed && !error ? h(EmptyBlock, { key: 'empty' }, t('timelineEmpty')) : null,
        error ? h(ErrorBlock, { key: 'err', message: error, onRetry: submit, retryLabel: t('retry') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        !busy && data && !data.anchor ? h(EmptyBlock, { key: 'missing' }, t('timelineMissing')) : null,
        !busy && data?.anchor && !items.length ? h(EmptyBlock, { key: 'noitems' }, t('timelineNoItems')) : null,
        !busy && items.length ? h('div', { key: 'list', className: 'cortex-timeline', 'aria-label': t('tabTimeline') }, items.map((item, index) => h(
          'button',
          {
            key: item.id,
            type: 'button',
            className: `cortex-timeline-row${item.isAnchor ? ' anchor' : ''}`,
            onClick: () => onSelect?.(item.id),
            'aria-label': `${relative(index) || t('timelineCount')}: ${item.title ?? item.id}`,
          },
          [
            h('span', { key: 'g', className: 'cortex-timeline-gutter' }, [
              h('span', { key: 'd', className: 'cortex-timeline-dot', 'aria-hidden': 'true' }),
              h('span', { key: 'r' }, relative(index)),
            ]),
            h('span', { key: 'b', className: 'cortex-timeline-body' }, [
              h('b', { key: 't' }, item.title ?? item.id),
              h('div', { key: 'm', className: 'cortex-meta' }, `${formatTime(item.recordedAt)}${item.kind ? ` · ${item.kind}` : ''}`),
              h('div', { key: 's', className: 'cortex-snippet' }, item.snippet ?? ''),
            ]),
          ],
        ))) : null,
      ]);
    }

    function HealthTab({ t, onRefresh }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(true);
      const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try { setData(await api('/health')); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      }, []);
      useEffect(() => { load(); }, [load]);
      return h('div', {}, [
        h('div', { key: 'line', className: 'cortex-line' }, [h('button', { key: 'r', type: 'button', className: 'cortex-btn', onClick: () => { load(); onRefresh?.(); } }, t('refresh'))]),
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed'), onRetry: load, retryLabel: t('retry') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        data ? h('div', {}, [
          h('div', { key: 'score', className: 'cortex-card' }, [h('h4', {}, t('score')), h('div', { className: 'cortex-big' }, `${data.score}/100`), h('div', { className: 'cortex-meta' }, `events ${data.counts.events} · traces ${data.counts.traces.total} · facts ${data.counts.facts.active} · skills ${data.counts.skills}`)]),
          h('div', { key: 'issues', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, t('issues')), ...(data.issues.length ? data.issues.map((issue, index) => h('div', { key: index, className: 'cortex-row' }, `${issue.severity} · ${issue.message}`)) : [h('div', { key: 'ok', className: 'cortex-row' }, t('ok'))])]),
        ]) : null,
      ]);
    }

    function PlaybookTab({ t }) {
      const [candidates, setCandidates] = useState([]);
      const [active, setActive] = useState([]);
      const [busy, setBusy] = useState(true);
      const [error, setError] = useState('');
      const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
          const [pending, current] = await Promise.all([api('/playbook?status=candidate'), api('/playbook?status=active')]);
          setCandidates(pending ?? []);
          setActive(current ?? []);
        } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const act = async (action, id) => {
        setBusy(true);
        setError('');
        try {
          await api('/playbook', { method: 'POST', body: JSON.stringify({ action, id }) });
          await load();
        } catch (issue) { setError(String(issue.message ?? issue)); setBusy(false); }
      };
      const suggest = async () => {
        setBusy(true);
        setError('');
        try { await api('/playbook', { method: 'POST', body: JSON.stringify({ action: 'suggest' }) }); await load(); } catch (issue) { setError(String(issue.message ?? issue)); setBusy(false); }
      };
      const rule = (item, isCandidate) => h('div', { key: item.id, className: 'cortex-card', style: { marginBottom: 8 } }, [
        h('div', { key: 'head', className: 'cortex-line' }, [
          h('strong', { key: 'title' }, item.title),
          h('span', { key: 'meta', className: 'cortex-meta' }, `+${item.helpful}/-${item.harmful}${item.validTo ? ` · ${item.validTo}` : ''}`),
        ]),
        h('div', { key: 'body', className: 'cortex-note' }, item.body),
        h('div', { key: 'actions', className: 'cortex-line' }, [
          isCandidate ? h('button', { key: 'a', type: 'button', className: 'cortex-btn', disabled: busy, onClick: () => act('approve', item.id) }, t('playbookApprove')) : null,
          isCandidate ? h('button', { key: 'r', type: 'button', className: 'cortex-btn', disabled: busy, onClick: () => act('retire', item.id) }, t('playbookReject')) : null,
          !isCandidate ? h('button', { key: 'v', type: 'button', className: 'cortex-btn', disabled: busy, onClick: () => act('vote', item.id) }, '+ helpful') : null,
          !isCandidate ? h('button', { key: 'x', type: 'button', className: 'cortex-btn', disabled: busy, onClick: () => act('retire', item.id) }, t('playbookReject')) : null,
        ].filter(Boolean)),
      ]);
      return h('div', {}, [
        h('div', { key: 'hint', className: 'cortex-note' }, t('playbookHint')),
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('button', { key: 's', type: 'button', className: 'cortex-btn', disabled: busy, onClick: suggest }, t('playbookSuggest')),
          h('button', { key: 'r', type: 'button', className: 'cortex-btn', disabled: busy, onClick: load }, t('refresh')),
        ]),
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed'), onRetry: load, retryLabel: t('retry') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        h('div', { key: 'cand', className: 'cortex-card', style: { marginTop: 10 } }, [
          h('h4', {}, t('playbookCandidates')),
          ...(candidates.length ? candidates.map((item) => rule(item, true)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('playbookEmpty'))]),
        ]),
        h('div', { key: 'active', className: 'cortex-card', style: { marginTop: 10 } }, [
          h('h4', {}, t('playbookActive')),
          ...(active.length ? active.map((item) => rule(item, false)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))]),
        ]),
      ]);
    }

    function EvolutionTab({ t }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(true);
      const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try { setData(await api('/evolution')); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const optimize = async () => {
        setBusy(true);
        setError('');
        try { await api('/evolve/optimize', { method: 'POST', body: JSON.stringify({}) }); await load(); } catch (issue) { setError(String(issue.message ?? issue)); setBusy(false); }
      };
      return h('div', {}, [
        h('div', { key: 'line', className: 'cortex-line' }, [h('button', { key: 'o', type: 'button', className: 'cortex-btn', disabled: busy, onClick: optimize }, t('optimize'))]),
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        data ? h('div', {}, [
          h('div', { key: 'active', className: 'cortex-card' }, [h('h4', {}, t('activePolicies')), ...Object.entries(data.active ?? {}).filter(([, value]) => value).map(([key, value]) => h('div', { key, className: 'cortex-row' }, `${key} v${value.version}`)), Object.values(data.active ?? {}).every((value) => !value) ? h('div', { key: 'none', className: 'cortex-empty' }, t('noPolicies')) : null]),
          h('div', { key: 'cand', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, t('candidates')), ...((data.candidates ?? []).length ? data.candidates.map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${item.kind} v${item.version} · ${item.status}`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))])]),
        ]) : null,
      ]);
    }

    function WorkingTab({ t }) {
      const [working, setWorking] = useState([]);
      const [goals, setGoals] = useState([]);
      const [text, setText] = useState('');
      const [title, setTitle] = useState('');
      const [error, setError] = useState('');
      const load = useCallback(async () => {
        try {
          const [w, g] = await Promise.all([api('/working'), api('/goals')]);
          setWorking(w ?? []);
          setGoals(g ?? []);
        } catch (issue) { setError(String(issue.message ?? issue)); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const add = async () => {
        if (!text.trim()) return;
        try { await api('/working/add', { method: 'POST', body: JSON.stringify({ text, priority: 0.6 }) }); setText(''); load(); } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      const addGoal = async () => {
        if (!title.trim()) return;
        try { await api('/goals/add', { method: 'POST', body: JSON.stringify({ title }) }); setTitle(''); load(); } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      return h('div', {}, [
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        h('div', { key: 'w', className: 'cortex-card' }, [
          h('h4', {}, '工作记忆'),
          h('div', { key: 'line', className: 'cortex-line' }, [
            h('input', { key: 'i', className: 'cortex-input', value: text, placeholder: '加一条焦点…', 'aria-label': '工作记忆', onChange: (event) => setText(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') add(); } }),
            h('button', { key: 'b', type: 'button', className: 'cortex-btn primary', onClick: add }, '加入'),
          ]),
          ...(working.length ? working.map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${item.pinned ? '[pin] ' : ''}${item.text}`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))]),
        ]),
        h('div', { key: 'g', className: 'cortex-card', style: { marginTop: 10 } }, [
          h('h4', {}, '目标'),
          h('div', { key: 'line', className: 'cortex-line' }, [
            h('input', { key: 'i', className: 'cortex-input', value: title, placeholder: '加一个目标…', 'aria-label': '目标', onChange: (event) => setTitle(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') addGoal(); } }),
            h('button', { key: 'b', type: 'button', className: 'cortex-btn primary', onClick: addGoal }, '新建'),
          ]),
          ...(goals.length ? goals.map((goal) => h('div', { key: goal.id, className: 'cortex-row' }, `${goal.title} · ${Math.round(goal.progress * 100)}%`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))]),
        ]),
      ]);
    }

    function EmotionTab({ t }) {
      const [data, setData] = useState(null);
      const [text, setText] = useState('');
      const [error, setError] = useState('');
      const load = useCallback(async () => { try { setData(await api('/emotion')); } catch (issue) { setError(String(issue.message ?? issue)); } }, []);
      useEffect(() => { load(); }, [load]);
      const record = async () => {
        if (!text.trim()) return;
        try { await api('/emotion/record', { method: 'POST', body: JSON.stringify({ text, target: '主人' }) }); setText(''); load(); } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      return h('div', {}, [
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('input', { key: 'i', className: 'cortex-input', value: text, placeholder: '本鲸现在有点…', 'aria-label': '情绪记录', onChange: (event) => setText(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') record(); } }),
          h('button', { key: 'b', type: 'button', className: 'cortex-btn primary', onClick: record }, '记一下'),
        ]),
        data ? h('div', {}, [
          h('div', { key: 't', className: 'cortex-card' }, [h('h4', {}, '情感态度'), h('div', { className: 'cortex-big' }, data.text)]),
          h('div', { key: 'targets', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, '对象'), ...(data.targets.length ? data.targets.map((item) => h('div', { key: item.target, className: 'cortex-row' }, `${item.target} · ${item.attitude} · ${item.count} 次`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))])]),
          h('div', { key: 'events', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, '最近情绪事件'), ...(data.events.length ? data.events.slice(0, 8).map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${item.emotions.map((emotion) => emotion.name).join('、')} · ${item.text.slice(0, 60)}`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))])]),
        ]) : h(LoadingBlock, { key: 'loading', label: t('loading') }),
      ]);
    }

    function LifeTab({ t }) {
      const [data, setData] = useState(null);
      const [text, setText] = useState('');
      const [error, setError] = useState('');
      const load = useCallback(async () => { try { setData(await api('/life')); } catch (issue) { setError(String(issue.message ?? issue)); } }, []);
      useEffect(() => { load(); }, [load]);
      const diary = async () => {
        if (!text.trim()) return;
        try { await api('/life/diary', { method: 'POST', body: JSON.stringify({ text }) }); setText(''); load(); } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      const dream = async () => { try { await api('/life/dream', { method: 'POST', body: '{}' }); load(); } catch (issue) { setError(String(issue.message ?? issue)); } };
      const sleep = async () => { try { await api('/life/sleep', { method: 'POST', body: '{}' }); load(); } catch (issue) { setError(String(issue.message ?? issue)); } };
      return h('div', {}, [
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        h('div', { key: 'line', className: 'cortex-line' }, [h('button', { key: 'd', type: 'button', className: 'cortex-btn', onClick: dream }, '做个梦'), h('button', { key: 's', type: 'button', className: 'cortex-btn', onClick: sleep }, '睡一觉')]),
        h('div', { key: 'diary', className: 'cortex-card' }, [
          h('h4', {}, '日记'),
          h('div', { key: 'line', className: 'cortex-line' }, [
            h('input', { key: 'i', className: 'cortex-input', value: text, placeholder: '今天想记住…', 'aria-label': '日记', onChange: (event) => setText(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') diary(); } }),
            h('button', { key: 'b', type: 'button', className: 'cortex-btn primary', onClick: diary }, '写'),
          ]),
          ...((data?.diary ?? []).length ? data.diary.map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${item.at.slice(0, 10)} ${item.text}`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))]),
        ]),
        h('div', { key: 'dreams', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, '梦'), ...((data?.dreams ?? []).length ? data.dreams.map((item) => h('div', { key: item.id, className: 'cortex-snippet' }, item.text)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))])]),
      ]);
    }

    function AuditTab({ t }) {
      const [limit, setLimit] = useState(50);
      const { data, error, busy, reload } = useEndpoint(`/audit?limit=${limit}`);
      const rows = Array.isArray(data) ? data : [];
      return h('div', {}, [
        h('div', { key: 'hint', className: 'cortex-note' }, t('auditHint')),
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('label', { key: 'l', className: 'cortex-inline-field' }, [
            h('span', { key: 't' }, t('auditLimit')),
            h('select', {
              key: 's',
              className: 'cortex-input cortex-select',
              value: limit,
              'aria-label': t('auditLimit'),
              onChange: (event) => setLimit(Number(event.target.value) || 50),
            }, [25, 50, 100, 200].map((value) => h('option', { key: value, value }, String(value)))),
          ]),
          h('button', { key: 'r', type: 'button', className: 'cortex-btn', disabled: busy, onClick: reload }, t('refresh')),
          h('span', { key: 'c', className: 'cortex-meta' }, `${t('auditCount')} ${rows.length}`),
        ]),
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed'), onRetry: reload, retryLabel: t('retry') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        !busy && !error && !rows.length ? h(EmptyBlock, { key: 'empty' }, t('auditEmpty')) : null,
        rows.length ? h('div', { key: 'table', className: 'cortex-table-wrap' }, h('table', { className: 'cortex-table cortex-audit-table' }, [
          h('caption', { key: 'caption', className: 'cortex-sr' }, t('auditTitle')),
          h('thead', { key: 'head' }, h('tr', {}, [
            h('th', { key: 'time' }, t('auditTime')),
            h('th', { key: 'actor' }, t('auditActor')),
            h('th', { key: 'action' }, t('auditAction')),
            h('th', { key: 'target' }, t('auditTarget')),
            h('th', { key: 'detail' }, t('auditDetail')),
          ])),
          h('tbody', { key: 'body' }, rows.map((row) => h('tr', { key: row.id }, [
            h('td', { key: 'time' }, formatTime(row.at)),
            h('td', { key: 'actor' }, h(Badge, {}, row.actor ?? '—')),
            h('td', { key: 'action' }, h('code', { className: 'cortex-code' }, row.action ?? '—')),
            h('td', { key: 'target' }, row.targetType || row.targetId ? [row.targetType, row.targetId].filter(Boolean).join(':') : '—'),
            h('td', { key: 'detail' }, h('details', {}, [
              h('summary', { key: 's' }, t('auditDetail')),
              h('pre', { key: 'p', className: 'cortex-pre' }, JSON.stringify(row.detail ?? {}, null, 2)),
            ])),
          ]))),
        ])) : null,
      ]);
    }

    function RetentionTab({ t, onSelect }) {
      const { data, error, busy, reload } = useEndpoint('/retention');
      const [applying, setApplying] = useState(false);
      const [applyMessage, setApplyMessage] = useState('');
      const candidates = data?.candidates ?? [];
      const applyNow = async () => {
        setApplying(true); setApplyMessage('');
        try {
          const result = await api('/retention/apply', { method: 'POST', body: JSON.stringify({ dryRun: false }) });
          setApplyMessage(`archived ${result.archived ?? 0}`);
          reload();
        } catch (e) {
          setApplyMessage(String(e.message ?? e));
        } finally {
          setApplying(false);
        }
      };
      return h('div', {}, [
        h('div', { key: 'hint', className: 'cortex-note' }, t('retentionHint')),
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('button', { key: 'plan', type: 'button', className: 'cortex-btn primary', disabled: busy || applying, onClick: reload }, t('planOnly')),
          h('button', {
            key: 'apply',
            type: 'button',
            className: 'cortex-btn',
            disabled: busy || applying || candidates.length === 0,
            title: t('retentionGap'),
            'aria-describedby': 'cortex-retention-apply-note',
            onClick: applyNow,
          }, t('applyRetention')),
          data?.at ? h('span', { key: 'at', className: 'cortex-meta' }, `${t('retentionAt')} ${formatTime(data.at)}`) : null,
          applyMessage ? h('span', { key: 'msg', className: 'cortex-meta' }, applyMessage) : null,
        ]),
        h('div', { key: 'gap', id: 'cortex-retention-apply-note', className: 'cortex-note' }, t('retentionGap')),
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed'), onRetry: reload, retryLabel: t('retry') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        data ? h('div', { key: 'data' }, [
          h('div', { key: 'stats', className: 'cortex-grid' }, [
            h('div', { key: 'active', className: 'cortex-card cortex-stat' }, [h('h4', {}, t('activeTraces')), h('div', { className: 'cortex-big' }, data.active ?? 0)]),
            h('div', { key: 'cand', className: 'cortex-card cortex-stat' }, [h('h4', {}, t('candidateTraces')), h('div', { className: 'cortex-big' }, data.count ?? candidates.length)]),
            h('div', { key: 'scope', className: 'cortex-card cortex-stat' }, [h('h4', {}, t('scope')), h('div', { className: 'cortex-big' }, data.scopeId ?? '—')]),
          ]),
          h('div', { key: 'rules', className: 'cortex-note' }, t('retentionRules')),
          candidates.length ? h('div', { key: 'list', className: 'cortex-retention-list' }, candidates.map((candidate) => h(
            'button',
            {
              key: candidate.id,
              type: 'button',
              className: 'cortex-item cortex-retention-item',
              onClick: () => onSelect?.(candidate.id),
              'aria-label': `${t('retentionClick')}: ${candidate.id}`,
            },
            [
              h('span', { key: 'id', className: 'cortex-retention-id' }, candidate.id),
              h('span', { key: 'side', className: 'cortex-retention-side' }, [
                h(Badge, { key: 'age' }, `${t('retentionAge')} ${formatNumber(candidate.ageDays, 1)}d`),
                h(Badge, { key: 'imp' }, `${t('retentionImportance')} ${toPercent(candidate.importance)}`),
                h(Badge, { key: 'conf' }, `${t('retentionConfidence')} ${toPercent(candidate.confidence)}`),
                h(Badge, { key: 'reason', tone: 'warn' }, `${t('retentionReason')} ${candidate.reason ?? '—'}`),
              ]),
            ],
          ))) : h(EmptyBlock, { key: 'empty' }, t('retentionEmpty')),
        ]) : null,
      ]);
    }

    function buildGraphLayout(top) {
      const items = [...(top ?? [])].sort((left, right) => Number(right.score) - Number(left.score));
      const maximum = Math.max(...items.map((item) => Number(item.score) || 0), 1e-9);
      const width = 640;
      const height = 400;
      const cx = width / 2;
      const cy = height / 2;
      return items.map((item, index) => {
        const ratio = Math.max(0, Math.min(1, (Number(item.score) || 0) / maximum));
        if (index === 0) return { ...item, x: cx, y: cy, r: 22 + 12 * ratio, ring: 0 };
        const ringIndex = index - 1;
        const ring = ringIndex < 7 ? 0 : 1;
        const count = ring === 0 ? Math.min(7, items.length - 1) : Math.max(1, items.length - 8);
        const offset = ring === 0 ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / Math.max(1, count);
        const indexInRing = ring === 0 ? ringIndex : ringIndex - 7;
        const angle = offset + (indexInRing / Math.max(1, count)) * Math.PI * 2;
        const radius = ring === 0 ? 105 : 165;
        return {
          ...item,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          r: 8 + 10 * ratio,
          ring,
        };
      });
    }

    function GraphTab({ t }) {
      const { data, error, busy, reload } = useEndpoint('/graph');
      const { data: edgeData } = useEndpoint('/graph/edges');
      const candidates = useEndpoint('/graph/candidates');
      const [candidateNotice, setCandidateNotice] = useState('');
      const [candidateBusy, setCandidateBusy] = useState('');
      const top = Array.isArray(data?.top) ? data.top : [];
      const layout = buildGraphLayout(top);
      const positions = new Map(layout.map((node) => [node.id, node]));
      const edges = Array.isArray(edgeData?.edges) ? edgeData.edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to)).slice(0, 120) : [];
      const pendingEdges = Array.isArray(candidates.data) ? candidates.data : [];
      const shortLabel = (id) => {
        const value = String(id ?? '');
        return value.length > 18 ? `${value.slice(0, 16)}…` : value;
      };
      const decideCandidate = async (id, action) => {
        setCandidateBusy(id);
        setCandidateNotice('');
        try {
          await api('/graph/candidates/action', { method: 'POST', body: JSON.stringify({ action, id }) });
          candidates.reload();
          reload();
          setCandidateNotice(action === 'approve' ? t('graphApprove') : t('graphReject'));
        } catch (issue) {
          setCandidateNotice(String(issue.message ?? issue));
        } finally {
          setCandidateBusy('');
        }
      };
      return h('div', {}, [
        h('div', { key: 'hint', className: 'cortex-note' }, t('graphHint')),
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('button', { key: 'r', type: 'button', className: 'cortex-btn', disabled: busy, onClick: reload }, t('refresh')),
        ]),
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed'), onRetry: reload, retryLabel: t('retry') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        candidates.error ? h(ErrorBlock, { key: 'cerr', message: candidates.error, prefix: t('requestFailed'), onRetry: candidates.reload, retryLabel: t('retry') }) : null,
        candidateNotice ? h('div', { key: 'cnotice', className: 'cortex-meta' }, candidateNotice) : null,
        data ? h('div', { key: 'data' }, [
          h('div', { key: 'stats', className: 'cortex-grid' }, [
            h('div', { key: 'nodes', className: 'cortex-card cortex-stat' }, [h('h4', {}, t('graphNodes')), h('div', { className: 'cortex-big' }, data.nodes ?? 0)]),
            h('div', { key: 'edges', className: 'cortex-card cortex-stat' }, [h('h4', {}, t('graphEdges')), h('div', { className: 'cortex-big' }, data.edges ?? 0)]),
            h('div', { key: 'components', className: 'cortex-card cortex-stat' }, [h('h4', {}, t('graphComponents')), h('div', { className: 'cortex-big' }, data.components ?? 0)]),
            h('div', { key: 'communities', className: 'cortex-card cortex-stat' }, [h('h4', {}, t('graphCommunities')), h('div', { className: 'cortex-big' }, data.communities ?? 0)]),
          ]),
          !data.nodes ? h(EmptyBlock, { key: 'empty' }, t('graphEmpty')) : null,
          data.nodes && !top.length ? h(EmptyBlock, { key: 'notop' }, t('noData')) : null,
          layout.length ? h('div', { key: 'graph', className: 'cortex-card cortex-graph-card', style: { marginTop: 10 } }, [
            h('div', { key: 'h', className: 'cortex-card-head' }, [
              h('h4', {}, t('graphTop')),
              h('span', { key: 'c', className: 'cortex-meta' }, `${t('graphTopCount')} ${top.length}`),
            ]),
            h('svg', {
              key: 'svg',
              className: 'cortex-graph-svg',
              viewBox: '0 0 640 400',
              role: 'img',
              'aria-label': t('graphAria'),
              preserveAspectRatio: 'xMidYMid meet',
            }, [
              h('title', { key: 'title' }, t('graphAria')),
              h('circle', { key: 'o1', className: 'cortex-graph-orbit', cx: 320, cy: 200, r: 105 }),
              h('circle', { key: 'o2', className: 'cortex-graph-orbit', cx: 320, cy: 200, r: 165 }),
              ...edges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                return h('line', {
                  key: `e-${edge.id}`,
                  className: 'cortex-graph-edge',
                  x1: from.x, y1: from.y, x2: to.x, y2: to.y,
                  strokeWidth: Math.max(1, Math.min(3, Number(edge.weight) || 1)),
                });
              }),
              ...layout.map((node) => h('g', { key: node.id, className: 'cortex-graph-node' }, [
                h('title', { key: 't' }, `${node.id} · ${t('graphRank')} ${formatNumber(node.score, 5)}`),
                h('circle', { key: 'c', className: 'cortex-graph-dot', cx: node.x, cy: node.y, r: node.r }),
                h('text', { key: 'l', className: 'cortex-graph-label', x: node.x, y: node.y + node.r + 13, textAnchor: 'middle' }, shortLabel(node.id)),
              ])),
            ]),
            h('div', { key: 'note', className: 'cortex-meta' }, t('graphScaleNote')),
            h('div', { key: 'top', className: 'cortex-graph-top' }, top.map((node) => h('div', { key: node.id, className: 'cortex-graph-top-row' }, [
              h('span', { key: 'i', title: node.id }, node.id),
              h('span', { key: 's' }, formatNumber(node.score, 5)),
            ]))),
          ]) : null,
        ]) : null,
        h('div', { key: 'candidates', className: 'cortex-card', style: { marginTop: 10 } }, [
          h('div', { key: 'head', className: 'cortex-card-head' }, [
            h('h4', {}, t('graphCandidatesTitle')),
            h('span', { key: 'count', className: 'cortex-meta' }, pendingEdges.length),
          ]),
          h('div', { key: 'hint', className: 'cortex-meta' }, t('graphCandidatesHint')),
          candidates.busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
          pendingEdges.length ? h('div', { key: 'list', style: { marginTop: 6 } }, pendingEdges.map((edge) => h('div', {
            key: edge.id,
            className: 'cortex-item',
            style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
          }, [
            h('span', { key: 'label', style: { flex: '1 1 240px', minWidth: 0 } },
              `${shortLabel(edge.fromId)} → ${shortLabel(edge.toId)} · ${edge.rel} · ${t('graphCandidateConfidence')} ${formatNumber(edge.metadata?.confidence ?? edge.weight ?? 0, 2)}`),
            h('button', {
              key: 'approve',
              type: 'button',
              className: 'cortex-btn',
              disabled: candidateBusy === edge.id,
              onClick: () => decideCandidate(edge.id, 'approve'),
            }, t('graphApprove')),
            h('button', {
              key: 'reject',
              type: 'button',
              className: 'cortex-btn',
              disabled: candidateBusy === edge.id,
              onClick: () => decideCandidate(edge.id, 'reject'),
            }, t('graphReject')),
          ]))) : h(EmptyBlock, { key: 'empty' }, t('graphCandidatesEmpty')),
        ]),
      ]);
    }

    function ModelSettings({ t }) {
      const models = useEndpoint('/models');
      const [mode, setMode] = useState('hash');
      const [baseUrl, setBaseUrl] = useState('');
      const [model, setModel] = useState('');
      const [dim, setDim] = useState('');
      const [apiKey, setApiKey] = useState('');
      const [rerankEnabled, setRerankEnabled] = useState(false);
      const [rerankBase, setRerankBase] = useState('');
      const [rerankModel, setRerankModel] = useState('');
      const [rerankKey, setRerankKey] = useState('');
      const [loaded, setLoaded] = useState(false);
      const [notice, setNotice] = useState('');
      useEffect(() => {
        if (!models.data || loaded) return;
        const e = models.data.embedding ?? {};
        setMode(e.mode ?? 'hash');
        setBaseUrl(e.baseUrl ?? '');
        setModel(e.model ?? '');
        setDim(e.dim ? String(e.dim) : '');
        setRerankEnabled(models.data.rerank?.enabled === true);
        setRerankBase(models.data.rerank?.baseUrl ?? '');
        setRerankModel(models.data.rerank?.model ?? '');
        setLoaded(true);
      }, [models.data, loaded]);
      const changeMode = (next) => {
        setMode(next);
        if (next === 'local' && !baseUrl) { setBaseUrl('http://127.0.0.1:11434/v1'); setModel('bge-m3'); setDim('1024'); }
        if (next === 'remote' && !baseUrl) { setBaseUrl('https://api.openai.com/v1'); setModel('text-embedding-3-small'); setDim('1536'); }
      };
      const save = async () => {
        if (!window.confirm(t('permissionConfirm'))) return;
        setNotice('');
        const embedding = { mode, baseUrl, model, dim: Number(dim) || 0 };
        if (apiKey) embedding.apiKey = apiKey;
        const rerank = { enabled: rerankEnabled, baseUrl: rerankBase, model: rerankModel };
        if (rerankKey) rerank.apiKey = rerankKey;
        try {
          const result = await api('/models', { method: 'POST', body: JSON.stringify({ embedding, rerank, confirm: true }) });
          setApiKey(''); setRerankKey('');
          setNotice(`${t('modelSaved')} ${result.restartRequired ? '' : ''}`);
          models.reload();
        } catch (issue) { setNotice(String(issue.message ?? issue)); }
      };
      return h('section', { className: 'cortex-card', style: { marginTop: 10 } }, [
        h('h4', {}, t('modelTitle')),
        h('p', { className: 'cortex-note' }, t('modelHint')),
        h('details', { key: 'guide', className: 'cortex-note' }, [
          h('summary', {}, t('modelGuide')),
          h('p', { key: 'r' }, t('modelGuideRemote')),
          h('p', { key: 'l' }, t('modelGuideLocal')),
          h('p', { key: 'd' }, t('modelGuideDefault')),
          h('div', { key: 'links', className: 'cortex-chips' }, [
            h('a', { key: 'ollama', href: 'https://ollama.com/download', target: '_blank', rel: 'noopener noreferrer', className: 'cortex-badge' }, t('modelDownloadOllama')),
            h('a', { key: 'bge', href: 'https://ollama.com/library/bge-m3', target: '_blank', rel: 'noopener noreferrer', className: 'cortex-badge' }, t('modelDownloadBge')),
            h('a', { key: 'nomic', href: 'https://ollama.com/library/nomic-embed-text', target: '_blank', rel: 'noopener noreferrer', className: 'cortex-badge' }, t('modelDownloadModel')),
          ]),
          h('code', { key: 'cmd', className: 'cortex-code' }, 'ollama pull bge-m3'),
        ]),
        models.error ? h(ErrorBlock, { message: models.error, prefix: t('requestFailed'), onRetry: models.reload, retryLabel: t('retry') }) : null,
        h('div', { className: 'cortex-grid' }, [
          h('label', { key: 'mode' }, [t('modelMode'), h('select', { className: 'cortex-input', value: mode, onChange: (event) => changeMode(event.target.value) }, [
            h('option', { value: 'hash' }, t('modelHash')),
            h('option', { value: 'local' }, t('modelLocal')),
            h('option', { value: 'remote' }, t('modelRemote')),
          ])]),
          h('label', { key: 'base' }, [t('modelBase'), h('input', { className: 'cortex-input', value: baseUrl, disabled: mode === 'hash', onChange: (event) => setBaseUrl(event.target.value) })]),
          h('label', { key: 'name' }, [t('modelName'), h('input', { className: 'cortex-input', value: model, disabled: mode === 'hash', onChange: (event) => setModel(event.target.value) })]),
          h('label', { key: 'dim' }, [t('modelDim'), h('input', { className: 'cortex-input', type: 'number', value: dim, disabled: mode === 'hash', onChange: (event) => setDim(event.target.value) })]),
          h('label', { key: 'key' }, [t('modelKey'), h('input', { className: 'cortex-input', type: 'password', value: apiKey, disabled: mode === 'hash', placeholder: models.data?.embedding?.apiKeySet ? '••••' : '', onChange: (event) => setApiKey(event.target.value) })]),
        ]),
        h('h4', { style: { marginTop: 12 } }, t('rerankTitle')),
        h('p', { className: 'cortex-note' }, t('rerankHint')),
        h('label', { className: 'cortex-line' }, [h('input', { type: 'checkbox', checked: rerankEnabled, onChange: (event) => setRerankEnabled(event.target.checked) }), t('rerankEnable')]),
        h('div', { className: 'cortex-grid' }, [
          h('label', { key: 'rbase' }, [t('modelBase'), h('input', { className: 'cortex-input', value: rerankBase, disabled: !rerankEnabled, onChange: (event) => setRerankBase(event.target.value) })]),
          h('label', { key: 'rname' }, [t('modelName'), h('input', { className: 'cortex-input', value: rerankModel, disabled: !rerankEnabled, onChange: (event) => setRerankModel(event.target.value) })]),
          h('label', { key: 'rkey' }, [t('modelKey'), h('input', { className: 'cortex-input', type: 'password', value: rerankKey, disabled: !rerankEnabled, placeholder: models.data?.rerank?.apiKeySet ? '••••' : '', onChange: (event) => setRerankKey(event.target.value) })]),
        ]),
        h('div', { className: 'cortex-line', style: { marginTop: 8 } }, [h('button', { type: 'button', className: 'cortex-btn', onClick: save, disabled: models.busy }, t('modelSave'))]),
        notice ? h('div', { className: 'cortex-note' }, notice) : null,
      ]);
    }

    function SettingsTab({ t }) {
      const settings = useEndpoint('/settings');
      const metrics = useEndpoint('/metrics');
      const grants = useEndpoint('/security/grants');
      const [notice, setNotice] = useState('');
      const [grantName, setGrantName] = useState('shared:agent-a');
      const [grantUntil, setGrantUntil] = useState('');
      const [grantNotice, setGrantNotice] = useState('');
      const [grantBusy, setGrantBusy] = useState(false);
      const addGrant = async () => {
        setGrantBusy(true); setGrantNotice('');
        try {
          await api('/security/grants', { method: 'POST', body: JSON.stringify({ action: 'add', grant: grantName.trim(), until: grantUntil.trim() || null }) });
          grants.reload();
          setGrantNotice(t('scopeGrantSaved'));
        } catch (issue) { setGrantNotice(String(issue.message ?? issue)); } finally { setGrantBusy(false); }
      };
      const revokeGrant = async (grant) => {
        setGrantBusy(true); setGrantNotice('');
        try {
          await api('/security/grants', { method: 'POST', body: JSON.stringify({ action: 'revoke', grant }) });
          grants.reload();
          setGrantNotice(t('scopeGrantSaved'));
        } catch (issue) { setGrantNotice(String(issue.message ?? issue)); } finally { setGrantBusy(false); }
      };
      const refreshAll = () => { settings.reload(); metrics.reload(); };
      const changePermission = async (key, value) => {
        if (!window.confirm(t('permissionConfirm'))) return;
        setNotice('');
        try {
          const result = await api('/permissions', { method: 'POST', body: JSON.stringify({ key, value, confirm: true }) });
          setNotice(`${key}: ${result.to ? t('permissionOn') : t('permissionOff')} · ${t('permissionSaved')}`);
          settings.reload();
        } catch (issue) { setNotice(String(issue.message ?? issue)); }
      };
      const rollbackPermission = async () => {
        if (!window.confirm(t('permissionConfirm'))) return;
        try { const result = await api('/permissions/rollback', { method: 'POST', body: JSON.stringify({}) }); setNotice(result.rolledBack ? `${t('permissionRollback')}: ${result.key}` : t('empty')); settings.reload(); } catch (issue) { setNotice(String(issue.message ?? issue)); }
      };
      const setting = settings.data;
      const metric = metrics.data;
      const counters = Object.entries(metric?.counters ?? {}).sort(([left], [right]) => left.localeCompare(right));
      const histograms = Object.entries(metric?.histograms ?? {});
      return h('div', {}, [
        h('div', { key: 'hint', className: 'cortex-note' }, t('settingsHint')),
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('button', { key: 'r', type: 'button', className: 'cortex-btn', disabled: settings.busy || metrics.busy, onClick: refreshAll }, t('refreshAll')),
          h('span', { key: 'ro', className: 'cortex-readonly' }, t('readOnlyNote')),
        ]),
        settings.error ? h(ErrorBlock, { key: 'serr', message: settings.error, prefix: t('requestFailed'), onRetry: settings.reload, retryLabel: t('retry') }) : null,
        metrics.error ? h(ErrorBlock, { key: 'merr', message: metrics.error, prefix: t('requestFailed'), onRetry: metrics.reload, retryLabel: t('retry') }) : null,
        settings.busy && !setting ? h(LoadingBlock, { key: 'sload', label: t('loading') }) : null,
        setting ? h('div', { key: 'settings', className: 'cortex-grid' }, [
          h('section', { key: 'runtime', className: 'cortex-card' }, [
            h('h4', {}, t('runtime')),
            h(KeyValueList, { rows: [
              ['scope', t('scope'), setting.scope],
              ['dataRoot', t('dataRoot'), setting.dataRoot],
              ['dbFile', t('dbFile'), setting.dbFile],
              ['readOnlyScopes', t('readOnlyScopes'), (setting.readOnlyScopes ?? []).join(', ') || '—'],
              ['contextBudget', t('contextBudget'), setting.contextBudget],
              ['promptBudget', t('promptBudget'), setting.promptBudget],
            ].map(([key, label, value]) => [key, label, displayValue(value)]) }),
          ]),
          h('section', { key: 'features', className: 'cortex-card' }, [
            h('h4', {}, t('features')),
            Object.keys(setting.features ?? {}).length
              ? h('div', { className: 'cortex-chips' }, Object.entries(setting.features).map(([name, value]) => {
                const current = setting.overrides?.[name] ?? value;
                const editable = name !== 'api';
                return h('button', {
                  key: name,
                  type: 'button',
                  className: `cortex-badge${current ? ' on' : ''}`,
                  'aria-pressed': Boolean(current),
                  disabled: !editable,
                  title: editable ? `${t('permissionClick')} · ${t('permissionRestart')}` : t('permissionApiLocked'),
                  onClick: editable ? () => changePermission(name, !current) : undefined,
                }, `${name} ${current ? 'on' : 'off'}`);
              }))
              : h(EmptyBlock, {}, t('empty')),
          ]),
          h('section', { key: 'permissions', className: 'cortex-card' }, [
            h('h4', {}, t('permissions')),
            h('div', { className: 'cortex-chips' }, [
              h(Badge, { key: 'local', tone: setting.permissions?.localApi ? 'on' : '' }, `${t('permissionLocal')} ${setting.permissions?.localApi ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'llm', tone: setting.permissions?.network?.llm ? 'on' : '' }, `LLM ${setting.permissions?.network?.llm ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'embed', tone: setting.permissions?.network?.remoteEmbedding ? 'on' : '' }, `embed ${setting.permissions?.network?.remoteEmbedding ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'rerank', tone: setting.permissions?.network?.rerank ? 'on' : '' }, `rerank ${setting.permissions?.network?.rerank ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'vector', tone: setting.permissions?.vector ? 'on' : '' }, `vector ${setting.permissions?.vector ? t('permissionOn') : t('permissionOff')}`),
            ]),
            h('div', { className: 'cortex-grid', style: { marginTop: 10 } }, [
              ['llm', 'LLM'], ['rerank', 'rerank'], ['capture', 'capture'], ['recall', 'recall'],
              ['vector', t('vector')], ['autoFacts', 'autoFacts'],
            ].map(([key, label]) => {
              const current = setting.overrides?.[key] ?? setting.features?.[key] ?? (key === 'rerank' ? setting.permissions?.network?.rerank : false);
              return h('div', { key, className: 'cortex-row', style: { justifyContent: 'space-between', gap: 8 } }, [
                h('span', { key: 'label' }, label),
                h('button', {
                  key: 'toggle',
                  type: 'button',
                  className: 'cortex-btn',
                  'aria-pressed': Boolean(current),
                  title: `${t('permissionClick')} · ${t('permissionRestart')}`,
                  onClick: () => changePermission(key, !current),
                }, `${current ? t('permissionOn') : t('permissionOff')} · ${t('permissionClick')}`),
              ]);
            })),
            h('div', { className: 'cortex-line', style: { marginTop: 8 } }, [
              h('button', { key: 'undo', type: 'button', className: 'cortex-btn', onClick: rollbackPermission }, t('permissionRollback')),
              h('span', { key: 'note', className: 'cortex-meta' }, t('permissionRestart')),
            ]),
            notice ? h('div', { className: 'cortex-note' }, notice) : null,
          ]),
          h('section', { key: 'grants', className: 'cortex-card' }, [
            h('h4', {}, t('scopeGrants')),
            h('p', { className: 'cortex-note' }, t('scopeGrantsHint')),
            grants.error ? h(ErrorBlock, { key: 'gerr', message: grants.error, prefix: t('requestFailed'), onRetry: grants.reload, retryLabel: t('retry') }) : null,
            grants.busy ? h(LoadingBlock, { key: 'gload', label: t('loading') }) : null,
            (grants.data?.grants ?? []).length
              ? h('div', { key: 'glist', className: 'cortex-grid' }, grants.data.grants.map((item) => h('div', { key: item.grant, className: 'cortex-row', style: { justifyContent: 'space-between', gap: 8 } }, [
                h('code', { key: 'g', className: 'cortex-code' }, item.grant),
                h('span', { key: 'u', className: 'cortex-meta' }, item.until ? formatTime(item.until) : t('scopeGrantForever')),
                h('button', { key: 'r', type: 'button', className: 'cortex-btn', disabled: grantBusy, onClick: () => revokeGrant(item.grant) }, t('scopeGrantRevoke')),
              ])))
              : h(EmptyBlock, { key: 'gempty' }, t('scopeGrantEmpty')),
            h('div', { key: 'gadd', className: 'cortex-grid', style: { marginTop: 8 } }, [
              h('label', { key: 'name' }, [t('scopeGrantName'), h('input', { className: 'cortex-input', value: grantName, placeholder: 'shared:agent-a', onChange: (event) => setGrantName(event.target.value) })]),
              h('label', { key: 'until' }, [t('scopeGrantUntil'), h('input', { className: 'cortex-input', value: grantUntil, placeholder: '2026-12-31T00:00:00Z', onChange: (event) => setGrantUntil(event.target.value) })]),
            ]),
            h('div', { key: 'gline', className: 'cortex-line' }, [
              h('button', { key: 'add', type: 'button', className: 'cortex-btn', disabled: grantBusy, onClick: addGrant }, t('scopeGrantAdd')),
              grantNotice ? h('span', { key: 'n', className: 'cortex-meta' }, grantNotice) : null,
            ]),
            (grants.data?.revoked ?? []).length ? h('div', { key: 'revoked', className: 'cortex-note' }, `${t('scopeGrantRevoked')}: ${grants.data.revoked.join(', ')}`) : null,
          ]),
          h('section', { key: 'vector', className: 'cortex-card' }, [
            h('h4', {}, t('vector')),
            setting.vector
              ? h('pre', { className: 'cortex-pre' }, JSON.stringify(setting.vector, null, 2))
              : h('div', {}, [
                h('p', { key: 'why', className: 'cortex-note' }, t('vectorDisabled')),
                h('button', { key: 'enable', type: 'button', className: 'cortex-btn', onClick: () => changePermission('vector', true) }, t('vectorEnable')),
              ]),
          ]),
          h(ModelSettings, { key: 'models', t }),
        ]) : null,
        h('div', { key: 'metrics', className: 'cortex-card', style: { marginTop: 10 } }, [
          h('div', { key: 'head', className: 'cortex-card-head' }, [
            h('h4', {}, t('metricsTitle')),
            metric?.at ? h('span', { key: 'at', className: 'cortex-meta' }, `${t('metricAt')} ${formatTime(metric.at)}`) : null,
          ]),
          metrics.busy && !metric ? h(LoadingBlock, { key: 'mload', label: t('loading') }) : null,
          metric ? h('div', { key: 'tables' }, [
            h('h4', { key: 'counters' }, t('counters')),
            counters.length ? h('div', { key: 'ctable', className: 'cortex-table-wrap' }, h('table', { className: 'cortex-table cortex-metrics-table' }, [
              h('caption', { key: 'c', className: 'cortex-sr' }, t('counters')),
              h('thead', { key: 'h' }, h('tr', {}, [h('th', { key: 'n' }, t('metricName')), h('th', { key: 'v' }, t('metricValue'))])),
              h('tbody', { key: 'b' }, counters.map(([name, value]) => h('tr', { key: name }, [
                h('td', { key: 'n' }, h('code', { className: 'cortex-code' }, name)),
                h('td', { key: 'v' }, formatNumber(value, 2)),
              ]))),
            ])) : h(EmptyBlock, { key: 'cempty' }, t('metricsEmpty')),
            h('h4', { key: 'hist', style: { marginTop: 12 } }, t('histograms')),
            histograms.length ? h('div', { key: 'htable', className: 'cortex-table-wrap' }, h('table', { className: 'cortex-table cortex-metrics-table' }, [
              h('caption', { key: 'c', className: 'cortex-sr' }, t('histograms')),
              h('thead', { key: 'h' }, h('tr', {}, [
                h('th', { key: 'n' }, t('metricName')),
                h('th', { key: 'c' }, t('count')),
                h('th', { key: 'p50' }, t('p50')),
                h('th', { key: 'p95' }, t('p95')),
                h('th', { key: 'max' }, t('max')),
              ])),
              h('tbody', { key: 'b' }, histograms.map(([name, summary]) => h('tr', { key: name }, [
                h('td', { key: 'n' }, h('code', { className: 'cortex-code' }, name)),
                h('td', { key: 'c' }, summary?.count ?? 0),
                h('td', { key: 'p50' }, summary?.p50 == null ? '—' : formatNumber(summary.p50, 2)),
                h('td', { key: 'p95' }, summary?.p95 == null ? '—' : formatNumber(summary.p95, 2)),
                h('td', { key: 'max' }, summary?.max == null ? '—' : formatNumber(summary.max, 2)),
              ]))),
            ])) : h(EmptyBlock, { key: 'hempty' }, t('metricsEmpty')),
          ]) : null,
        ]),
      ]);
    }

    function Panel({ ctx }) {
      const t = useDict(ctx);
      const [tab, setTab] = useState('self');
      const [self, setSelf] = useState(null);
      const [selfBusy, setSelfBusy] = useState(true);
      const [error, setError] = useState('');
      const [detailId, setDetailId] = useState(null);
      const [timelineId, setTimelineId] = useState('');

      const loadSelf = useCallback(async () => {
        setSelfBusy(true);
        try { setSelf(await api('/self')); setError(''); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setSelfBusy(false); }
      }, []);

      useEffect(() => { loadSelf(); }, [loadSelf]);

      const openTrace = useCallback((value) => {
        const id = typeof value === 'string' ? value : value?.id;
        if (id) setDetailId(String(id));
      }, []);

      const openTimeline = useCallback((id) => {
        const value = String(id ?? '').trim();
        if (!value) return;
        setDetailId(null);
        setTimelineId(value);
        setTab('timeline');
      }, []);

      const closeDetail = useCallback(() => setDetailId(null), []);

      const tabs = [
        ['self', t('tabSelf')],
        ['search', t('tabSearch')],
        ['timeline', t('tabTimeline')],
        ['working', t('tabWorking')],
        ['emotion', t('tabEmotion')],
        ['life', t('tabLife')],
        ['graph', t('tabGraph')],
        ['playbook', t('tabPlaybook')],
        ['audit', t('tabAudit')],
        ['retention', t('tabRetention')],
        ['health', t('tabHealth')],
        ['evolution', t('tabEvolution')],
        ['settings', t('tabSettings')],
      ];

      const moveTab = (event, index) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        const [nextId] = tabs[next];
        setTab(nextId);
        document.getElementById(`cortex-tab-${nextId}`)?.focus();
      };

      let content = null;
      if (tab === 'self') {
        content = self
          ? h(SelfTab, { data: self })
          : h('div', {}, [
            selfBusy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
            !selfBusy && error ? h(EmptyBlock, { key: 'empty' }, t('noData')) : null,
          ]);
      } else if (tab === 'search') {
        content = h(SearchTab, { t, onSelect: openTrace });
      } else if (tab === 'timeline') {
        content = h(TimelineTab, { t, anchorId: timelineId, onAnchorChange: setTimelineId, onSelect: openTrace });
      } else if (tab === 'working') {
        content = h(WorkingTab, { t });
      } else if (tab === 'emotion') {
        content = h(EmotionTab, { t });
      } else if (tab === 'life') {
        content = h(LifeTab, { t });
      } else if (tab === 'graph') {
        content = h(GraphTab, { t });
      } else if (tab === 'audit') {
        content = h(AuditTab, { t });
      } else if (tab === 'retention') {
        content = h(RetentionTab, { t, onSelect: openTrace });
      } else if (tab === 'playbook') {
        content = h(PlaybookTab, { t });
      } else if (tab === 'health') {
        content = h(HealthTab, { t, onRefresh: loadSelf });
      } else if (tab === 'evolution') {
        content = h(EvolutionTab, { t });
      } else if (tab === 'settings') {
        content = h(SettingsTab, { t });
      }

      return h('div', { className: 'cortex-root' }, [
        h('div', { key: 'head', className: 'cortex-head' }, [
          h('div', { key: 't' }, [h('h3', { className: 'cortex-title' }, t('title')), h('p', { className: 'cortex-sub' }, t('subtitle'))]),
          h('button', { key: 'r', type: 'button', className: 'cortex-btn', onClick: loadSelf, disabled: selfBusy }, t('refresh')),
        ]),
        tab === 'self' && error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('errorPrefix'), onRetry: loadSelf, retryLabel: t('retry') }) : null,
        h('div', { key: 'tabs', className: 'cortex-tabs', role: 'tablist', 'aria-label': t('navLabel') }, tabs.map(([id, label], index) => h('button', {
          key: id,
          id: `cortex-tab-${id}`,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === id,
          'aria-controls': `cortex-panel-${id}`,
          tabIndex: tab === id ? 0 : -1,
          className: `cortex-tab${tab === id ? ' on' : ''}`,
          onClick: () => setTab(id),
          onKeyDown: (event) => moveTab(event, index),
        }, label))),
        h('div', {
          key: tab,
          id: `cortex-panel-${tab}`,
          className: 'cortex-panel',
          role: 'tabpanel',
          'aria-labelledby': `cortex-tab-${tab}`,
          tabIndex: 0,
        }, content),
        detailId ? h(TraceDetail, {
          key: detailId,
          id: detailId,
          t,
          onClose: closeDetail,
          onTimeline: openTimeline,
        }) : null,
      ]);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const zh = ctx.locale.register(NS, 'zh', DICT.zh);
          const en = ctx.locale.register(NS, 'en', DICT.en);
          return () => { en(); zh(); };
        }, 'cortex: locale');

        ctx.effect(() => {
          const style = document.createElement('style');
          style.id = 'dsh-cortex-style';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'cortex: style');

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'cortex',
          order: 9,
          label: () => ctx.locale.bind(NS)('navLabel'),
        }, (owner) => h(Icon, { size: owner?.size ?? 18, active: owner?.active === true })));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'cortex',
        }, () => h(Panel, { ctx })));
      },
    };
  },
});
