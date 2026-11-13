window.__ModuleLoader__.load({
  id: 'dsh-cortex',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const NS = 'cortex';
    const API = '/api/cortex';

    function withoutReferences(text) {
      return String(text ?? '').replace(/\n\s*参考：[\s\S]*$/u, '').trim();
    }

    const FEATURE_META = {
      recall: { zh: '自动召回', en: 'Auto recall', descZh: '每轮前查找相关记忆', descEn: 'Find relevant memories before each turn' },
      capture: { zh: '自动捕获', en: 'Auto capture', descZh: '对话自动写入记忆', descEn: 'Write turns into memory' },
      reflect: { zh: '反思整理', en: 'Reflection', descZh: '摘要、反思与巩固', descEn: 'Summaries, reflection and consolidation' },
      growth: { zh: '成长评估', en: 'Growth', descZh: '评估阶段与成长指标', descEn: 'Evaluate stage and growth metrics' },
      vector: { zh: '向量检索', en: 'Vector search', descZh: '相似记忆向量检索', descEn: 'Semantic vector retrieval' },
      vectorAnn: { zh: '本地近似索引', en: 'Local ANN', descZh: 'HNSW 加速大量向量', descEn: 'HNSW acceleration for many vectors' },
      vectorAnnExternal: { zh: '外置近似索引', en: 'External ANN', descZh: '调用外置 ANN 服务', descEn: 'Use an external ANN service' },
      attachmentReader: { zh: '读取附件', en: 'Attachments', descZh: '读取本地附件内容', descEn: 'Read local attachment content' },
      graph: { zh: '关系图', en: 'Graph', descZh: '时间关系图激活', descEn: 'Temporal graph activation' },
      llm: { zh: '模型调用', en: 'LLM', descZh: '允许调用模型', descEn: 'Allow model calls' },
      autoDiary: { zh: '自动日记', en: 'Auto diary', descZh: '每天 12:00 / 22:00 写', descEn: 'Write at 12:00 and 22:00' },
      autoDream: { zh: '自动做梦', en: 'Auto dream', descZh: '每天 22:05 做一次', descEn: 'One dream at 22:05' },
      autoFeeling: { zh: '自动感受', en: 'Auto feeling', descZh: '空闲时每小时写感受', descEn: 'Hourly feelings while idle' },
      autoEvolve: { zh: '自动迭代', en: 'Auto evolve', descZh: '策略自动提案并激活', descEn: 'Auto-propose and activate policies' },
      aiOnlyLife: { zh: 'AI 接管生活', en: 'AI-only life', descZh: '日记/梦只由 AI 写，不套模板', descEn: 'Diary/dream are AI-only, no template fallback' },
      autoGraphCandidates: { zh: 'AI 接管候选边', en: 'Auto graph candidates', descZh: '高置信候选边自动入图', descEn: 'Approve high-confidence candidate edges' },
      aiEdgeReview: { zh: 'AI 逐条审核边', en: 'AI edge review', descZh: '每条候选边由 LLM 判断', descEn: 'LLM reviews each candidate edge' },
      webSearch: { zh: '联网资料', en: 'Web search', descZh: '日记/梦参考外部来源', descEn: 'Use external sources for diary/dreams' },
      api: { zh: '本机接口', en: 'Local API', descZh: '本机 HTTP 接口，锁定开启', descEn: 'Local HTTP API, locked on' },
      autoFacts: { zh: '自动事实', en: 'Auto facts', descZh: '写入时自动抽事实', descEn: 'Extract facts on write' },
      llmFacts: { zh: '模型事实', en: 'LLM facts', descZh: '用模型抽取事实', descEn: 'Extract facts with the model' },
      tieredRecall: { zh: '分层召回', en: 'Tiered recall', descZh: '按 perm / hot / cold 取记忆', descEn: 'Recall by perm / hot / cold tiers' },
      consolidateOnSleep: { zh: '睡眠整理', en: 'Sleep consolidate', descZh: '睡一觉时整理记忆', descEn: 'Consolidate during sleep' },
      consolidateOnTick: { zh: '心跳整理', en: 'Tick consolidate', descZh: '每次心跳整理一次', descEn: 'Consolidate on each heartbeat' },
      rerank: { zh: '远程重排', en: 'Rerank', descZh: '模型对候选记忆重排', descEn: 'Rerank candidate memories' },
    };

    const DICT = {
      zh: {
        navLabel: 'Cortex 记忆',
        title: 'Cortex 记忆',
        subtitle: 'Cortex 的分层记忆 · 自我状态 · 守护 · 进化',
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
        tabMemoryEdit: '召唤册',
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
        timelineHint: '默认展示最近 20 条记忆；点击查看详情，也可输入 trace id 查看前后相邻记忆。',
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
        timelineEmpty: '还没有可展示的最近记忆。',
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
        settingsHint: '功能开关与指标为只读快照；权限修改会写入本机配置，重启后生效。',
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
        permissionReadOnly: '只读快照',
        autoEvolveNote: '自动迭代已开：策略会自动提案并激活，可回滚；身份变更仍单独审批。',
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
        readOnlyNote: '快照只读；权限按钮可写，需确认并重启。',
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
        tabMemoryEdit: 'Summon book',
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
        timelineHint: 'Shows the latest 20 memories by default; click for details, or enter a trace id to see its neighbours.',
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
        timelineEmpty: 'No recent memories to show yet.',
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
        settingsHint: 'Feature flags and metrics are read-only snapshots; permission changes write local config and apply after restart.',
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
        permissionReadOnly: 'read-only snapshot',
        autoEvolveNote: 'Autonomous evolution is on: policies can be proposed and activated automatically, with rollback. Identity changes still require separate approval.',
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
        readOnlyNote: 'Snapshots are read-only; permission buttons write config after confirmation and need a restart.',
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
.cortex-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
.cortex-settings > .cortex-card--wide{grid-column:1/-1}
.cortex-feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:6px}
.cortex-feature{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:10px;padding:8px 10px;min-width:0}
.cortex-feature-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.cortex-feature-name{font-size:12px;font-weight:600}
.cortex-feature-desc{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#6b7280);margin:3px 0 6px}
.cortex-feature .cortex-btn{padding:2px 8px;font-size:11px}
.cortex-memory-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.cortex-memory-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:12px;align-items:start}
.cortex-memory-days{max-height:640px;overflow:auto;padding:8px}
.cortex-memory-day{appearance:none;border:0;background:transparent;display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:7px 8px;border-radius:8px;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;cursor:pointer;text-align:left}
.cortex-memory-day:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.cortex-memory-day.on{background:var(--dsw-alias-bg-layer-2,#f7f8fa);box-shadow:inset 2px 0 var(--dsw-alias-brand-primary,#2f6fed)}
.cortex-memory-emotion{border-left:3px solid #d97706}
.cortex-memory-work{border-left:3px solid var(--dsw-alias-brand-primary,#2f6fed)}
.cortex-memory-event{border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb);padding:8px 0}
.cortex-memory-event:first-of-type{border-top:0}
.cortex-memory-trace{border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb);padding:9px 0}
.cortex-memory-trace:first-of-type{border-top:0}
.cortex-memory-title{font-size:12px;font-weight:600;margin:2px 0 4px}
.cortex-memory-text{font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
.cortex-memory-edit-form{display:grid;gap:6px;margin:6px 0}
.cortex-memory-edit-form textarea{resize:vertical;min-height:120px}
.cortex-memory-extra{margin-top:10px;font-size:12px}
.cortex-memory-extra summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#6b7280)}
.cortex-summon-left{border-left:3px solid #db7c9b}
.cortex-summon-right{border-left:3px solid var(--dsw-alias-brand-primary,#2f6fed)}
.cortex-summon-card{border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb);padding:4px 0 8px}
.cortex-summon-card:first-of-type{border-top:0}
.cortex-summon-title{appearance:none;border:0;background:transparent;padding:7px 4px;width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer;font:inherit;color:inherit;border-radius:8px}
.cortex-summon-title:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.cortex-summon-title span:first-child{font-size:12px;font-weight:600}
.cortex-summon-body{padding:2px 4px 4px}
.cortex-summon-volume{margin-top:6px;font-size:12px}
.cortex-summon-volume summary{cursor:pointer;color:var(--dsw-alias-brand-primary,#2f6fed)}
.cortex-diagnostics .cortex-row{flex-wrap:wrap}
@media (max-width:900px){.cortex-settings{grid-template-columns:1fr}.cortex-settings > .cortex-card--wide{grid-column:auto}.cortex-memory-layout{grid-template-columns:1fr}.cortex-memory-days{max-height:200px}}
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

    const ICON_DATA = 'data:image/jpeg;base64,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';

    function Icon({ size = 18, active = false }) {
      return h('img', { src: ICON_DATA, width: size, height: size, alt: '', 'aria-hidden': true, draggable: false, style: { display: 'block', borderRadius: '30%', objectFit: 'cover', opacity: active ? 1 : 0.82 } });
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
        h('div', { key: 'capacity', className: 'cortex-card', style: { marginTop: 10 } }, [
          h('h4', {}, '容量上限'),
          data.capacity ? h('div', {}, [
            h('div', { key: 'l0', className: 'cortex-row' }, `人设 L0：${data.capacity.identityTokens} / ${data.capacity.identityBudget} tokens${data.capacity.identityTokens > data.capacity.identityBudget ? '（超出预算，注入会截断）' : ''}`),
            h('div', { key: 'l1', className: 'cortex-row' }, `工作记忆 L1：${data.capacity.workingBudget} tokens`),
            h('div', { key: 'prompt', className: 'cortex-row' }, `系统提示总预算：${data.capacity.promptBudget} tokens`),
            h('div', { key: 'ctx', className: 'cortex-row' }, `检索上下文：${data.capacity.contextBudget} tokens`),
            h('div', { key: 'tiers', className: 'cortex-row' }, `分层召回：perm ${data.capacity.tiers?.perm} / hot ${data.capacity.tiers?.hot} / cold ${data.capacity.tiers?.cold} tokens`),
            h('div', { key: 'search', className: 'cortex-row' }, `单次检索：${data.capacity.resultLimit} 条；FTS 候选 ${data.capacity.ftsLimit} 条`),
            h('div', { key: 'shape', className: 'cortex-row' }, `人设结构：values ≤ ${data.capacity.valuesLimit}；boundaries ≤ ${data.capacity.boundariesLimit}`),
            h('div', { key: 'l23', className: 'cortex-note' }, 'L2 火花卡 / L3 专题没有固定条数上限，受检索、注入预算和每轮选择约束。'),
          ]) : h('div', { className: 'cortex-note' }, '容量数据暂不可用。'),
        ]),
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
            placeholder: '主题, 对象',
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
      const [recent, setRecent] = useState(null);
      const [busy, setBusy] = useState(Boolean(initialAnchor));
      const [error, setError] = useState('');
      const [tick, setTick] = useState(0);

      useEffect(() => {
        if (committed) return undefined;
        let alive = true;
        api('/timeline/recent?limit=20')
          .then((value) => { if (alive) setRecent(value); })
          .catch((issue) => { if (alive) setError(String(issue.message ?? issue)); });
        return () => { alive = false; };
      }, [committed, tick]);

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

      const rawItems = committed ? (data?.items ?? []) : (recent?.items ?? []);
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
        !committed && !error && !items.length ? h(EmptyBlock, { key: 'empty' }, t('timelineEmpty')) : null,
        error ? h(ErrorBlock, { key: 'err', message: error, onRetry: submit, retryLabel: t('retry') }) : null,
        busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
        !busy && committed && data && !data.anchor ? h(EmptyBlock, { key: 'missing' }, t('timelineMissing')) : null,
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
        try { await api('/evolve/optimize', { method: 'POST', body: JSON.stringify({ baseline: true }) }); await load(); } catch (issue) { setError(String(issue.message ?? issue)); setBusy(false); }
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
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const load = useCallback(async () => { try { setData(await api('/emotion')); } catch (issue) { setError(String(issue.message ?? issue)); } }, []);
      useEffect(() => { load(); }, [load]);
      const generate = async () => {
        if (busy) return;
        setBusy(true);
        try { await api('/emotion/generate', { method: 'POST', body: '{}' }); await load(); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      return h('div', {}, [
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        h('div', { key: 'line', className: 'cortex-line' }, [
          h('button', { key: 'b', type: 'button', className: 'cortex-btn primary', disabled: busy, onClick: generate }, busy ? '助手在感受…' : '让助手感受一下'),
          h('span', { key: 'note', className: 'cortex-meta' }, '空闲时每小时自动写一次；感受由助手自己判断'),
        ]),
        data ? h('div', {}, [
          h('div', { key: 't', className: 'cortex-card' }, [h('h4', {}, '情感态度'), h('div', { className: 'cortex-big' }, data.text)]),
          h('div', { key: 'targets', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, '对象'), ...(data.targets.length ? data.targets.map((item) => h('div', { key: item.target, className: 'cortex-row' }, `${item.target} · ${item.attitude} · ${item.count} 次`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))])]),
          h('div', { key: 'events', className: 'cortex-card', style: { marginTop: 10 } }, [h('h4', {}, '最近感受'), ...(data.events.length ? data.events.slice(0, 8).map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${item.emotions.map((emotion) => emotion.name).join('、')} · ${item.text.slice(0, 120)}`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))])]),
        ]) : h(LoadingBlock, { key: 'loading', label: t('loading') }),
      ]);
    }

    function LifeTab({ t }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const settings = useEndpoint('/settings');
      const load = useCallback(async () => { try { setData(await api('/life')); } catch (issue) { setError(String(issue.message ?? issue)); } }, []);
      useEffect(() => { load(); }, [load]);
      const autoValue = (key) => settings.data?.overrides?.[key] ?? settings.data?.features?.[key] ?? false;
      const toggleAuto = async (key) => {
        if (!window.confirm(t('permissionConfirm'))) return;
        try {
          await api('/permissions', { method: 'POST', body: JSON.stringify({ key, value: !autoValue(key), confirm: true }) });
          settings.reload();
        } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      const writeDiary = async () => {
        if (busy) return;
        setBusy(true);
        try { await api('/life/diary/generate', { method: 'POST', body: '{}' }); await load(); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      const dream = async () => {
        if (busy) return;
        setBusy(true);
        try { await api('/life/dream', { method: 'POST', body: '{}' }); await load(); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      const sleep = async () => {
        if (busy) return;
        setBusy(true);
        try { await api('/life/sleep', { method: 'POST', body: '{}' }); await load(); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      return h('div', {}, [
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        h('div', { key: 'line', className: 'cortex-line' }, [h('button', { key: 'd', type: 'button', className: 'cortex-btn', disabled: busy, onClick: dream }, busy ? '梦里…' : '做个梦'), h('button', { key: 's', type: 'button', className: 'cortex-btn', disabled: busy, onClick: sleep }, busy ? '睡着…' : '睡一觉'), h('button', { key: 'ai', type: 'button', className: 'cortex-btn', onClick: () => toggleAuto('aiOnlyLife') }, `不用模板：${autoValue('aiOnlyLife') ? '开' : '关'}`)]),
        h('div', { key: 'diary', className: 'cortex-card' }, [
          h('h4', {}, '日记'),
          h('div', { key: 'line', className: 'cortex-line' }, [
            h('button', { key: 'b', type: 'button', className: 'cortex-btn primary', disabled: busy, onClick: writeDiary }, busy ? '助手在想…' : '让助手写日记'),
            h('button', { key: 'auto', type: 'button', className: 'cortex-btn', onClick: () => toggleAuto('autoDiary') }, `AI 接管日记：${autoValue('autoDiary') ? '开' : '关'}`),
            h('button', { key: 'web', type: 'button', className: 'cortex-btn', onClick: () => toggleAuto('webSearch') }, `联网：${autoValue('webSearch') ? '开' : '关'}`),
            h('span', { key: 'note', className: 'cortex-meta' }, '助手自己思考后写；不是用户代笔'),
          ]),
          ...((data?.diary ?? []).length ? data.diary.map((item) => h('div', { key: item.id, className: 'cortex-row' }, `${formatTime(item.at).slice(0, 10)} ${withoutReferences(item.text)}`)) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))]),
        ]),
        h('div', { key: 'dreams', className: 'cortex-card', style: { marginTop: 10 } }, [
          h('h4', {}, '梦'),
          h('div', { key: 'auto-line', className: 'cortex-line' }, [
            h('button', { key: 'auto', type: 'button', className: 'cortex-btn', onClick: () => toggleAuto('autoDream') }, `AI 接管梦：${autoValue('autoDream') ? '开' : '关'}`),
            h('button', { key: 'web', type: 'button', className: 'cortex-btn', onClick: () => toggleAuto('webSearch') }, `联网：${autoValue('webSearch') ? '开' : '关'}`),
            h('span', { key: 'note', className: 'cortex-meta' }, '22:05 自动生成；失败不回退模板'),
          ]),
          ...((data?.dreams ?? []).length ? data.dreams.map((item) => h('div', { key: item.id, className: 'cortex-snippet' }, withoutReferences(item.text))) : [h('div', { key: 'none', className: 'cortex-empty' }, t('empty'))]),
        ]),
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
      const settings = useEndpoint('/settings');
      const autoGraph = settings.data?.overrides?.autoGraphCandidates ?? settings.data?.features?.autoGraphCandidates ?? false;
      const aiEdgeReview = settings.data?.overrides?.aiEdgeReview ?? settings.data?.features?.aiEdgeReview ?? false;
      const [candidateNotice, setCandidateNotice] = useState('');
      const [candidateBusy, setCandidateBusy] = useState('');
      const top = Array.isArray(data?.top) ? data.top : [];
      const layout = buildGraphLayout(top);
      const positions = new Map(layout.map((node) => [node.id, node]));
      const edges = Array.isArray(edgeData?.edges) ? edgeData.edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to)).slice(0, 120) : [];
      const pendingEdges = Array.isArray(candidates.data) ? candidates.data : [];
      const shortLabel = (value) => {
        const text = String(value ?? '');
        return text.length > 18 ? `${text.slice(0, 16)}…` : text;
      };
      const labelOf = (id) => shortLabel(positions.get(id)?.name || id);
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
      const toggleAutoGraph = async () => {
        if (!window.confirm(t('permissionConfirm'))) return;
        try {
          await api('/permissions', { method: 'POST', body: JSON.stringify({ key: 'autoGraphCandidates', value: !autoGraph, confirm: true }) });
          settings.reload();
        } catch (issue) {
          setCandidateNotice(String(issue.message ?? issue));
        }
      };
      const toggleAiEdgeReview = async () => {
        if (!window.confirm(t('permissionConfirm'))) return;
        try {
          await api('/permissions', { method: 'POST', body: JSON.stringify({ key: 'aiEdgeReview', value: !aiEdgeReview, confirm: true }) });
          settings.reload();
        } catch (issue) {
          setCandidateNotice(String(issue.message ?? issue));
        }
      };
      const labelEntities = async () => {
        setCandidateBusy('entity-label');
        setCandidateNotice('');
        try {
          const result = await api('/entities/label', { method: 'POST', body: JSON.stringify({ limit: 5 }) });
          setCandidateNotice(`已审阅 ${result.scanned ?? 0} 个坏名，改名 ${result.count ?? 0} 个`);
          reload();
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
          h('button', { key: 'label', type: 'button', className: 'cortex-btn', disabled: candidateBusy === 'entity-label', onClick: labelEntities }, '自动命名实体'),
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
                h('title', { key: 't' }, `${node.name || node.id} · ${t('graphRank')} ${formatNumber(node.score, 5)}`),
                h('circle', { key: 'c', className: 'cortex-graph-dot', cx: node.x, cy: node.y, r: node.r }),
                h('text', { key: 'l', className: 'cortex-graph-label', x: node.x, y: node.y + node.r + 13, textAnchor: 'middle' }, labelOf(node.id)),
              ])),
            ]),
            h('div', { key: 'note', className: 'cortex-meta' }, t('graphScaleNote')),
            h('div', { key: 'top', className: 'cortex-graph-top' }, top.map((node) => h('div', { key: node.id, className: 'cortex-graph-top-row' }, [
              h('span', { key: 'i', title: node.id }, node.name || node.id),
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
          h('div', { key: 'ai-line', className: 'cortex-line' }, [
            h('button', { key: 'ai', type: 'button', className: 'cortex-btn', onClick: toggleAutoGraph }, `AI 接管候选边：${autoGraph ? '开' : '关'}`),
            h('button', { key: 'ai-review', type: 'button', className: 'cortex-btn', onClick: toggleAiEdgeReview }, `AI 全权审核：${aiEdgeReview ? '开' : '关'}`),
            h('span', { key: 'ai-note', className: 'cortex-meta' }, '全权审核会逐条让 LLM 判断；可回滚'),
          ]),
          candidates.busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
          pendingEdges.length ? h('div', { key: 'list', style: { marginTop: 6 } }, pendingEdges.map((edge) => h('div', {
            key: edge.id,
            className: 'cortex-item',
            style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
          }, [
            h('span', { key: 'label', style: { flex: '1 1 240px', minWidth: 0 } },
              `${shortLabel(edge.fromName || positions.get(edge.fromId)?.name || edge.fromId)} → ${shortLabel(edge.toName || positions.get(edge.toId)?.name || edge.toId)} · ${edge.relLabel || edge.rel} · ${t('graphCandidateConfidence')} ${formatNumber(edge.metadata?.confidence ?? edge.weight ?? 0, 2)}`),
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

    function MemoryEditTab({ t }) {
      const days = useEndpoint('/memory/days?limit=60');
      const lock = useEndpoint('/memory/edit');
      const [selected, setSelected] = useState('');
      const [day, setDay] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [editing, setEditing] = useState(null);
      const [draft, setDraft] = useState({ title: '', content: '', tags: '' });
      const [editingEmotion, setEditingEmotion] = useState(null);
      const [emotionDraft, setEmotionDraft] = useState({ text: '', target: '' });
      const [emotionOpen, setEmotionOpen] = useState(false);
      const [workOpen, setWorkOpen] = useState(true);
      const unlocked = lock.data?.enabled === true;
      const dayList = Array.isArray(days.data) ? days.data : [];
      const loadDay = useCallback(async (value) => {
        if (!value) { setDay(null); return; }
        setBusy(true); setError('');
        try { setDay(await api(`/memory/day?date=${encodeURIComponent(value)}`)); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      }, []);
      useEffect(() => {
        if (!selected && dayList.length) setSelected(dayList[0].date);
      }, [selected, dayList]);
      useEffect(() => { loadDay(selected); }, [selected, loadDay]);
      useEffect(() => {
        if (!selected) return undefined;
        const sync = () => { loadDay(selected); };
        const timer = setInterval(sync, 10_000);
        const onFocus = () => { sync(); days.reload(); };
        window.addEventListener('focus', onFocus);
        return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
      }, [selected, loadDay, days.reload]);
      const moveDay = (offset) => {
        const index = dayList.findIndex((item) => item.date === selected);
        const next = dayList[index + offset];
        if (next) setSelected(next.date);
      };
      const toggleLock = async () => {
        if (!window.confirm(unlocked ? '关闭编辑权限，恢复只读？' : '打开编辑权限？开启后可以修改记忆正文；会写入审计。')) return;
        try { await api('/memory/edit', { method: 'POST', body: JSON.stringify({ enabled: !unlocked }) }); lock.reload(); } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      const startEdit = (trace) => {
        if (!unlocked) return;
        setEditing(trace.id);
        setDraft({ title: trace.title ?? '', content: trace.content ?? '', tags: (trace.tags ?? []).join(', ') });
      };
      const saveEdit = async () => {
        if (!editing || !unlocked) return;
        setBusy(true); setError('');
        try {
          await api('/memory/trace', { method: 'POST', body: JSON.stringify({
            id: editing,
            title: draft.title,
            content: draft.content,
            tags: draft.tags.split(/[,，\s]+/).filter(Boolean),
          }) });
          setEditing(null);
          await loadDay(selected);
        } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      const startEmotionEdit = (event) => {
        if (!unlocked) return;
        setEditingEmotion(event.id);
        setEmotionDraft({ text: event.text ?? '', target: event.target ?? '' });
      };
      const saveEmotionEdit = async () => {
        if (!editingEmotion || !unlocked) return;
        setBusy(true); setError('');
        try {
          await api('/memory/emotion', { method: 'POST', body: JSON.stringify({ id: editingEmotion, ...emotionDraft }) });
          setEditingEmotion(null);
          await loadDay(selected);
        } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      const emotionEvents = day?.emotion ?? [];
      const work = day?.work ?? { traces: [], facts: [], summaries: [], diary: [], dreams: [] };
      const counts = day?.counts ?? {};
      return h('div', { className: 'cortex-memory-edit' }, [
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        h('div', { key: 'toolbar', className: 'cortex-memory-toolbar' }, [
          h('div', { key: 'lock', className: 'cortex-line' }, [
            h('span', { key: 'label', className: `cortex-badge${unlocked ? ' on' : ''}` }, `编辑权限：${unlocked ? '开' : '关（只读）'}`),
            h('button', { key: 'toggle', type: 'button', className: 'cortex-btn', onClick: toggleLock }, unlocked ? '关闭编辑' : '开启编辑权限'),
            h('span', { key: 'hint', className: 'cortex-meta' }, '关闭时只能查询；开启后可改正文，改动进审计'),
          ]),
          h('div', { key: 'nav', className: 'cortex-line' }, [
            h('button', { key: 'prev', type: 'button', className: 'cortex-btn', onClick: () => moveDay(1), disabled: !dayList.length }, '上一天'),
            h('input', { key: 'date', type: 'date', className: 'cortex-input', value: selected, onChange: (event) => setSelected(event.target.value), 'aria-label': '选择日期' }),
            h('button', { key: 'next', type: 'button', className: 'cortex-btn', onClick: () => moveDay(-1), disabled: !dayList.length }, '下一天'),
            h('button', { key: 'refresh', type: 'button', className: 'cortex-btn', onClick: () => { days.reload(); loadDay(selected); } }, t('refresh')),
            h('span', { key: 'sync', className: 'cortex-meta' }, '自动同步 10 秒；编辑后立即刷新'),
          ]),
        ]),
        h('div', { key: 'layout', className: 'cortex-memory-layout' }, [
          h('aside', { key: 'days', className: 'cortex-card cortex-memory-days' }, [
            h('h4', {}, '按天'),
            dayList.length ? dayList.map((item) => h('button', {
              key: item.date,
              type: 'button',
              className: `cortex-memory-day${item.date === selected ? ' on' : ''}`,
              onClick: () => setSelected(item.date),
            }, [
              h('span', { key: 'd' }, item.date),
              h('span', { key: 'c', className: 'cortex-meta' }, `情 ${item.emotion} · 工 ${item.work}`),
            ])) : h('div', { className: 'cortex-empty' }, '还没有按天记录'),
            dayList.length ? h('div', { key: 'earliest', className: 'cortex-note', style: { marginTop: 8 } }, `最早可查 ${dayList[dayList.length - 1].date}；Cortex 初始化前没有原始痕迹。`) : null,
          ]),
          h('div', { key: 'main', className: 'cortex-memory-main' }, [
            busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
            h('section', { key: 'emotion', className: 'cortex-card cortex-memory-emotion' }, [
              h('div', { key: 'head', className: 'cortex-card-head' }, [
                h('h4', {}, `情感 · ${selected || '—'}`),
                h('div', { key: 'actions', className: 'cortex-line' }, [
                  h('span', { key: 'count', className: 'cortex-meta' }, counts.emotion ?? 0),
                  h('button', { key: 'toggle', type: 'button', className: 'cortex-btn', onClick: () => setEmotionOpen(!emotionOpen) }, emotionOpen ? '收起情感' : '展开情感'),
                ]),
              ]),
              !emotionOpen ? h('div', { key: 'collapsed', className: 'cortex-note' }, `情感已收起（${counts.emotion ?? 0} 条）；展开后再看，下面是工作记忆。`) : emotionEvents.length ? emotionEvents.map((event) => h('div', { key: event.id, className: 'cortex-memory-event' }, [
                h('div', { key: 'meta', className: 'cortex-line' }, [
                  h('span', { key: 'time', className: 'cortex-meta' }, formatTime(event.at)),
                  h('span', { key: 'target', className: 'cortex-badge' }, event.target ?? '—'),
                  ...(event.emotions ?? []).map((emotion) => h('span', { key: `${event.id}-${emotion.name}`, className: 'cortex-badge on' }, `${emotion.name}${emotion.score ? ` ${emotion.score}` : ''}`)),
                  unlocked ? h('button', { key: 'edit', type: 'button', className: 'cortex-btn', onClick: () => startEmotionEdit(event) }, '编辑') : null,
                ]),
                editingEmotion === event.id ? h('div', { key: 'form', className: 'cortex-memory-edit-form' }, [
                  h('input', { key: 'target', className: 'cortex-input', value: emotionDraft.target, onChange: (e) => setEmotionDraft({ ...emotionDraft, target: e.target.value }), placeholder: '对象' }),
                  h('textarea', { key: 'text', className: 'cortex-input', rows: 4, value: emotionDraft.text, onChange: (e) => setEmotionDraft({ ...emotionDraft, text: e.target.value }), placeholder: '感受正文' }),
                  h('div', { key: 'buttons', className: 'cortex-line' }, [
                    h('button', { key: 'save', type: 'button', className: 'cortex-btn primary', disabled: busy, onClick: saveEmotionEdit }, '保存修改'),
                    h('button', { key: 'cancel', type: 'button', className: 'cortex-btn', onClick: () => setEditingEmotion(null) }, '取消'),
                  ]),
                ]) : h('div', { key: 'text', className: 'cortex-memory-text' }, event.text),
              ])) : h('div', { key: 'empty', className: 'cortex-empty' }, '这天没有情感记录'),
            ]),
            h('section', { key: 'work', className: 'cortex-card cortex-memory-work' }, [
              h('div', { key: 'head', className: 'cortex-card-head' }, [
                h('h4', {}, `工作记忆 · ${selected || '—'}`),
                h('div', { key: 'actions', className: 'cortex-line' }, [
                  h('span', { key: 'count', className: 'cortex-meta' }, `${counts.traces ?? 0} 痕迹`),
                  h('button', { key: 'toggle', type: 'button', className: 'cortex-btn', onClick: () => setWorkOpen(!workOpen) }, workOpen ? '收起工作' : '展开工作'),
                ]),
              ]),
              !workOpen ? h('div', { key: 'collapsed', className: 'cortex-note' }, `工作记忆已收起（${counts.traces ?? 0} 条痕迹）；点“展开工作”查看。`) : h('div', { key: 'body' }, [
                work.traces.length ? work.traces.map((trace) => h('div', { key: trace.id, className: 'cortex-memory-trace' }, [
                  h('div', { key: 'meta', className: 'cortex-line' }, [
                    h('span', { key: 'time', className: 'cortex-meta' }, formatTime(trace.recordedAt)),
                    h('span', { key: 'kind', className: 'cortex-badge' }, trace.kind),
                    h('span', { key: 'imp', className: 'cortex-meta' }, `重要度 ${formatNumber(trace.importance, 2)}`),
                    unlocked ? h('button', { key: 'edit', type: 'button', className: 'cortex-btn', onClick: () => startEdit(trace) }, '编辑') : h('span', { key: 'ro', className: 'cortex-meta' }, '只读'),
                  ]),
                  h('div', { key: 'title', className: 'cortex-memory-title' }, trace.title || '(无标题)'),
                  editing === trace.id ? h('div', { key: 'form', className: 'cortex-memory-edit-form' }, [
                    h('input', { key: 'title', className: 'cortex-input', value: draft.title, onChange: (event) => setDraft({ ...draft, title: event.target.value }), placeholder: '标题' }),
                    h('textarea', { key: 'content', className: 'cortex-input', rows: 8, value: draft.content, onChange: (event) => setDraft({ ...draft, content: event.target.value }), placeholder: '正文' }),
                    h('input', { key: 'tags', className: 'cortex-input', value: draft.tags, onChange: (event) => setDraft({ ...draft, tags: event.target.value }), placeholder: '标签，用逗号分隔' }),
                    h('div', { key: 'buttons', className: 'cortex-line' }, [
                      h('button', { key: 'save', type: 'button', className: 'cortex-btn primary', disabled: busy, onClick: saveEdit }, '保存修改'),
                      h('button', { key: 'cancel', type: 'button', className: 'cortex-btn', onClick: () => setEditing(null) }, '取消'),
                    ]),
                  ]) : h('div', { key: 'text', className: 'cortex-memory-text' }, trace.content),
                  (trace.tags ?? []).length ? h('div', { key: 'tags', className: 'cortex-chips' }, trace.tags.map((tag) => h('span', { key: tag, className: 'cortex-badge' }, tag))) : null,
                ])) : h('div', { key: 'empty', className: 'cortex-empty' }, '这天没有工作记忆'),
                h('details', { key: 'facts', className: 'cortex-memory-extra' }, [
                  h('summary', {}, `事实 ${counts.facts ?? 0} · 摘要 ${counts.summaries ?? 0} · 日记 ${counts.diary ?? 0} · 梦 ${counts.dreams ?? 0}`),
                  ...(work.facts ?? []).map((fact) => h('div', { key: fact.id, className: 'cortex-row' }, `${fact.subjectId ?? '—'} ${fact.predicate} ${fact.objectLiteral ?? fact.objectId ?? '—'}`)),
                  ...(work.summaries ?? []).map((summary) => h('div', { key: summary.id, className: 'cortex-snippet' }, summary.content)),
                  ...(work.diary ?? []).map((item) => h('div', { key: item.id, className: 'cortex-snippet' }, withoutReferences(item.text))),
                  ...(work.dreams ?? []).map((item) => h('div', { key: item.id, className: 'cortex-snippet' }, withoutReferences(item.text))),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]);
    }

    function SummonBookTab({ t }) {
      const lock = useEndpoint('/memory/edit');
      const [book, setBook] = useState(null);
      const [selected, setSelected] = useState('');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [leftOpen, setLeftOpen] = useState(true);
      const [rightOpen, setRightOpen] = useState(true);
      const [volumesOpen, setVolumesOpen] = useState(false);
      const [openCard, setOpenCard] = useState(null);
      const [editing, setEditing] = useState(null);
      const [draft, setDraft] = useState({ title: '', content: '', triggers: '' });
      const [feedbackNotice, setFeedbackNotice] = useState('');
      const unlocked = lock.data?.enabled === true;
      const load = useCallback(async (date) => {
        setBusy(true); setError('');
        try { setBook(await api(`/summon/book${date ? `?date=${encodeURIComponent(date)}` : ''}`)); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      }, []);
      useEffect(() => { load(selected); }, [load, selected]);
      useEffect(() => {
        const timer = setInterval(() => load(selected), 10_000);
        const onFocus = () => load(selected);
        window.addEventListener('focus', onFocus);
        return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
      }, [load, selected]);
      const days = book?.days ?? [];
      const chooseDay = (date) => setSelected(date);
      const toggleLock = async () => {
        if (!window.confirm(unlocked ? '关闭召唤册编辑权限？' : '开启召唤册编辑权限？改动会写审计。')) return;
        try { await api('/memory/edit', { method: 'POST', body: JSON.stringify({ enabled: !unlocked }) }); lock.reload(); } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      const rebuild = async () => {
        setBusy(true); setError('');
        try { await api('/summon/rebuild', { method: 'POST', body: '{}' }); await load(selected); } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      const startEdit = (card) => {
        if (!unlocked) return;
        setEditing(card.id);
        setDraft({ title: card.title, content: card.content, triggers: (card.triggers ?? []).join(', ') });
        setOpenCard(card.id);
      };
      const save = async () => {
        if (!editing || !unlocked) return;
        setBusy(true); setError('');
        try {
          await api('/summon/card', { method: 'POST', body: JSON.stringify({ id: editing, title: draft.title, content: draft.content, triggers: draft.triggers.split(/[,，\s]+/).filter(Boolean) }) });
          setEditing(null);
          await load(selected);
        } catch (issue) { setError(String(issue.message ?? issue)); } finally { setBusy(false); }
      };
      const sendFeedback = async (card, signal) => {
        try {
          await api('/summon/feedback', { method: 'POST', body: JSON.stringify({ id: card.id, signal }) });
          setFeedbackNotice(`${card.title}：${signal === 'helpful' ? '已标记有用' : '已标记忽略'}`);
        } catch (issue) { setError(String(issue.message ?? issue)); }
      };
      const cardList = (cards, side) => cards.length ? cards.map((card) => h('div', { key: card.id, className: 'cortex-summon-card' }, [
        h('button', { key: 'title', type: 'button', className: 'cortex-summon-title', onClick: () => setOpenCard(openCard === card.id ? null : card.id) }, [
          h('span', { key: 'n' }, card.title),
          h('span', { key: 't', className: 'cortex-meta' }, `${card.day} · ${card.category ?? side}`),
        ]),
        openCard === card.id ? h('div', { key: 'body', className: 'cortex-summon-body' }, [
          editing === card.id ? h('div', { key: 'form', className: 'cortex-memory-edit-form' }, [
            h('input', { key: 'title', className: 'cortex-input', value: draft.title, onChange: (event) => setDraft({ ...draft, title: event.target.value }), placeholder: '卡片名' }),
            h('textarea', { key: 'content', className: 'cortex-input', rows: 6, value: draft.content, onChange: (event) => setDraft({ ...draft, content: event.target.value }), placeholder: '卡片内容' }),
            h('input', { key: 'triggers', className: 'cortex-input', value: draft.triggers, onChange: (event) => setDraft({ ...draft, triggers: event.target.value }), placeholder: '触发词，逗号分隔' }),
            h('div', { key: 'buttons', className: 'cortex-line' }, [
              h('button', { key: 'save', type: 'button', className: 'cortex-btn primary', disabled: busy, onClick: save }, '保存'),
              h('button', { key: 'cancel', type: 'button', className: 'cortex-btn', onClick: () => setEditing(null) }, '取消'),
            ]),
          ]) : h('div', { key: 'content', className: 'cortex-memory-text' }, card.content),
          h('div', { key: 'triggers', className: 'cortex-chips' }, (card.triggers ?? []).slice(0, 16).map((trigger) => h('span', { key: trigger, className: 'cortex-badge' }, trigger))),
          h('div', { key: 'feedback', className: 'cortex-line' }, [
            h('button', { key: 'helpful', type: 'button', className: 'cortex-btn', onClick: () => sendFeedback(card, 'helpful') }, '这张卡有用'),
            h('button', { key: 'ignored', type: 'button', className: 'cortex-btn', onClick: () => sendFeedback(card, 'ignored') }, '忽略'),
          ]),
          unlocked && editing !== card.id ? h('div', { key: 'edit', className: 'cortex-line' }, [h('button', { type: 'button', className: 'cortex-btn', onClick: () => startEdit(card) }, '编辑这张卡')]) : null,
        ]) : null,
      ])) : h('div', { key: 'empty', className: 'cortex-empty' }, '这一天还没有召唤卡');
      return h('div', { className: 'cortex-summon-book' }, [
        error ? h(ErrorBlock, { key: 'err', message: error, prefix: t('requestFailed') }) : null,
        h('div', { key: 'toolbar', className: 'cortex-memory-toolbar' }, [
          h('div', { key: 'lock', className: 'cortex-line' }, [
            h('span', { key: 'state', className: `cortex-badge${unlocked ? ' on' : ''}` }, `编辑权限：${unlocked ? '开' : '关（只读）'}`),
            h('button', { key: 'toggle', type: 'button', className: 'cortex-btn', onClick: toggleLock }, unlocked ? '关闭编辑' : '开启编辑权限'),
            h('span', { key: 'sync', className: 'cortex-meta' }, '召唤册 10 秒同步；召唤卡由记忆自动生成'),
          ]),
          h('div', { key: 'nav', className: 'cortex-line' }, [
            h('input', { key: 'date', type: 'date', className: 'cortex-input', value: selected, onChange: (event) => setSelected(event.target.value), 'aria-label': '选择召唤日期' }),
            h('button', { key: 'rebuild', type: 'button', className: 'cortex-btn', disabled: busy, onClick: rebuild }, '回填旧记忆为召唤卡'),
            h('button', { key: 'refresh', type: 'button', className: 'cortex-btn', onClick: () => load(selected) }, t('refresh')),
          ]),
        ]),
        feedbackNotice ? h('div', { key: 'feedbackNotice', className: 'cortex-note' }, feedbackNotice) : null,
        h('div', { key: 'layout', className: 'cortex-memory-layout' }, [
          h('aside', { key: 'days', className: 'cortex-card cortex-memory-days' }, [
            h('h4', {}, '召唤日'),
            days.length ? days.map((day) => h('button', { key: day, type: 'button', className: `cortex-memory-day${day === (selected || book?.date) ? ' on' : ''}`, onClick: () => chooseDay(day) }, day)) : h('div', { className: 'cortex-empty' }, '还没有召唤卡'),
            h('div', { key: 'note', className: 'cortex-note', style: { marginTop: 8 } }, '召唤卡从情感/工作记忆回填；召唤策按类别合册。'),
          ]),
          h('div', { key: 'main', className: 'cortex-memory-main' }, [
            busy ? h(LoadingBlock, { key: 'loading', label: t('loading') }) : null,
            h('section', { key: 'left', className: 'cortex-card cortex-summon-left' }, [
              h('div', { key: 'head', className: 'cortex-card-head' }, [
                h('h4', {}, `左脑 · 情感卡 · ${book?.date || selected || '—'}`),
                h('div', { key: 'a', className: 'cortex-line' }, [h('span', { className: 'cortex-meta' }, book?.left?.length ?? 0), h('button', { type: 'button', className: 'cortex-btn', onClick: () => setLeftOpen(!leftOpen) }, leftOpen ? '收起' : '展开')]),
              ]),
              leftOpen ? cardList(book?.left ?? [], '情感') : h('div', { className: 'cortex-note' }, '左脑召唤卡已收起'),
            ]),
            h('section', { key: 'right', className: 'cortex-card cortex-summon-right' }, [
              h('div', { key: 'head', className: 'cortex-card-head' }, [
                h('h4', {}, `右脑 · 工作卡 · ${book?.date || selected || '—'}`),
                h('div', { key: 'a', className: 'cortex-line' }, [h('span', { className: 'cortex-meta' }, book?.right?.length ?? 0), h('button', { type: 'button', className: 'cortex-btn', onClick: () => setRightOpen(!rightOpen) }, rightOpen ? '收起' : '展开')]),
              ]),
              rightOpen ? cardList(book?.right ?? [], '工作') : h('div', { className: 'cortex-note' }, '右脑召唤卡已收起'),
            ]),
            h('section', { key: 'volumes', className: 'cortex-card cortex-summon-volumes' }, [
              h('div', { key: 'head', className: 'cortex-card-head' }, [
                h('h4', {}, `召唤策 · ${book?.volumes?.length ?? 0}`),
                h('button', { key: 'toggle', type: 'button', className: 'cortex-btn', onClick: () => setVolumesOpen(!volumesOpen) }, volumesOpen ? '收起召唤策' : '展开召唤策'),
              ]),
              volumesOpen ? (book?.volumes ?? []).map((volume) => h('details', { key: volume.id, className: 'cortex-summon-volume' }, [
                h('summary', {}, `${volume.side === 'left' ? '左脑册' : '右脑册'} · ${volume.title}`),
                h('div', { className: 'cortex-memory-text' }, volume.content),
              ])) : h('div', { className: 'cortex-note' }, '召唤策收起中；展开后按左右脑与类别看合册。'),
            ]),
          ]),
        ]),
      ]);
    }

    function DiagnosticsCard({ t }) {
      const diagnostics = useEndpoint('/diagnostics');
      const [busy, setBusy] = useState('');
      const [notice, setNotice] = useState('');
      const data = diagnostics.data;
      const act = async (kind, id, decision = 'dismiss') => {
        if (!window.confirm('这会写审计记录；确认处理这一项？')) return;
        setBusy(id); setNotice('');
        try {
          if (kind === 'fact') {
            await api('/facts/resolve', { method: 'POST', body: JSON.stringify({ id, decision, reason: '用户从诊断框处理' }) });
            setNotice(decision === 'confirm' ? '已确认有效' : '已降级为无效，内容保留');
          } else if (kind === 'suggest') {
            const result = await api('/skills/suggest', { method: 'POST', body: '{}' });
            setNotice(`已提炼 ${result.count} 个技能候选；候选不会自动启用`);
          } else if (kind === 'promote') {
            await api('/skills/promote', { method: 'POST', body: JSON.stringify({ id }) });
            setNotice('技能已启用');
          }
          diagnostics.reload();
        } catch (issue) { setNotice(String(issue.message ?? issue)); } finally { setBusy(''); }
      };
      return h('section', { key: 'diagnostics', className: 'cortex-card cortex-diagnostics', style: { marginTop: 10 } }, [
        h('div', { key: 'head', className: 'cortex-card-head' }, [
          h('h4', {}, '诊断'),
          h('span', { key: 'score', className: `cortex-badge${data?.score === 100 ? ' on' : ''}` }, `健康 ${data?.score ?? '—'}/100`),
        ]),
        notice ? h('div', { key: 'notice', className: 'cortex-note' }, notice) : null,
        !data ? h('div', { key: 'loading', className: 'cortex-note' }, t('loading')) : h('div', {}, [
          (data.issues ?? []).length ? h('div', { key: 'issues' }, [
            h('div', { key: 'label', className: 'cortex-meta' }, '检测到的问题'),
            ...data.issues.map((issue) => h('div', { key: issue.code ?? issue.message, className: 'cortex-row' }, `${issue.code ?? 'ISSUE'} · ${issue.message ?? ''}`)),
          ]) : h('div', { key: 'ok', className: 'cortex-note' }, '没有发现问题。'),
          h('div', { key: 'disputes', style: { marginTop: 10 } }, [
            h('div', { key: 'label', className: 'cortex-meta' }, `争议事实 ${data.disputes?.length ?? 0}`),
            ...(data.disputes ?? []).map((fact) => h('div', { key: fact.id, className: 'cortex-row cortex-diagnostic-row' }, [
              h('span', { key: 'text', style: { flex: '1 1 260px' } }, `${fact.subject} ${fact.predicate} ${fact.objectLiteral ?? fact.objectId ?? '—'} · 置信 ${formatNumber(fact.confidence, 2)}`),
              h('button', { key: 'confirm', type: 'button', className: 'cortex-btn', disabled: busy === fact.id, onClick: () => act('fact', fact.id, 'confirm') }, '确认有效'),
              h('button', { key: 'dismiss', type: 'button', className: 'cortex-btn', disabled: busy === fact.id, onClick: () => act('fact', fact.id, 'dismiss') }, '降级无效'),
            ])),
          ]),
          h('div', { key: 'skills', style: { marginTop: 10 } }, [
            h('div', { key: 'label', className: 'cortex-meta' }, `技能：active ${data.skills?.active ?? 0} · 候选 ${data.skills?.candidates ?? 0}`),
            h('button', { key: 'suggest', type: 'button', className: 'cortex-btn', disabled: busy === 'suggest', onClick: () => act('suggest') }, '从痕迹提炼技能候选'),
            ...(data.skills?.items ?? []).filter((skill) => skill.state !== 'active').slice(0, 6).map((skill) => h('div', { key: skill.id, className: 'cortex-row cortex-diagnostic-row' }, [
              h('span', { key: 'name', style: { flex: '1 1 220px' } }, `${skill.name} · ${skill.state}`),
              h('button', { key: 'promote', type: 'button', className: 'cortex-btn', disabled: busy === skill.id, onClick: () => act('promote', skill.id) }, '启用'),
            ])),
          ]),
        ]),
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
        setting ? h('div', { key: 'settings', className: 'cortex-settings' }, [
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
          h('section', { key: 'features', className: 'cortex-card cortex-card--wide' }, [
            h('h4', {}, t('features')),
            Object.keys(setting.features ?? {}).length
              ? h('div', { className: 'cortex-feature-grid' }, Object.entries(setting.features).map(([name, value]) => {
                const current = setting.overrides?.[name] ?? value;
                const editable = name !== 'api';
                const meta = FEATURE_META[name] ?? { zh: name, en: name, descZh: '', descEn: '' };
                const zh = t('permissionOn') === '开';
                const label = zh ? meta.zh : meta.en;
                const desc = zh ? meta.descZh : meta.descEn;
                return h('div', { key: name, className: 'cortex-feature' }, [
                  h('div', { key: 'head', className: 'cortex-feature-head' }, [
                    h('span', { key: 'name', className: 'cortex-feature-name' }, label),
                    h('span', { key: 'state', className: `cortex-badge${current ? ' on' : ''}` }, current ? t('permissionOn') : t('permissionOff')),
                  ]),
                  h('div', { key: 'desc', className: 'cortex-feature-desc' }, desc),
                  h('button', {
                    key: 'toggle',
                    type: 'button',
                    className: 'cortex-btn',
                    disabled: !editable,
                    'aria-pressed': Boolean(current),
                    title: editable ? `${t('permissionClick')} · ${t('permissionRestart')}` : t('permissionReadOnly'),
                    onClick: editable ? () => changePermission(name, !current) : undefined,
                  }, editable ? (current ? '关闭' : '开启') : '锁定'),
                ]);
              }))
              : h(EmptyBlock, {}, t('empty')),
            setting.features?.autoEvolve ? h('div', { key: 'auto-evolve-note', className: 'cortex-note' }, t('autoEvolveNote')) : null,
          ]),
          h('section', { key: 'permissions', className: 'cortex-card cortex-card--wide' }, [
            h('h4', {}, t('permissions')),
            h('div', { className: 'cortex-chips' }, [
              h(Badge, { key: 'local', tone: setting.permissions?.localApi ? 'on' : '' }, `${t('permissionLocal')} ${setting.permissions?.localApi ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'llm', tone: setting.permissions?.network?.llm ? 'on' : '' }, `LLM ${setting.permissions?.network?.llm ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'embed', tone: setting.permissions?.network?.remoteEmbedding ? 'on' : '' }, `embed ${setting.permissions?.network?.remoteEmbedding ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'rerank', tone: setting.permissions?.network?.rerank ? 'on' : '' }, `rerank ${setting.permissions?.network?.rerank ? t('permissionOn') : t('permissionOff')}`),
              h(Badge, { key: 'vector', tone: setting.permissions?.vector ? 'on' : '' }, `vector ${setting.permissions?.vector ? t('permissionOn') : t('permissionOff')}`),
            ]),
            h('p', { key: 'ro', className: 'cortex-note' }, t('permissionReadOnly')),
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
        h(DiagnosticsCard, { key: 'diagnostics', t }),
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
      useEffect(() => {
        const timer = setInterval(async () => {
          try { setSelf(await api('/self')); } catch { /* keep last snapshot */ }
        }, 15_000);
        return () => clearInterval(timer);
      }, []);

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
        ['memory', t('tabMemoryEdit')],
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
      } else if (tab === 'memory') {
        content = h(SummonBookTab, { t });
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
