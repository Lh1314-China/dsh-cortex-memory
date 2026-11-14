# Cortex Memory

本地优先的分层记忆引擎，给 DeepSeek Harness 一个能长期成长的记忆与自我状态。

不是把聊天记录堆起来，也不是只做关键词检索。Cortex 把记忆拆成工作记忆、情景痕迹、语义事实、程序技能、反思摘要与召唤卡，再配合时序事实、DSR 遗忘、混合召回、身份/情绪/关系和守护审计，让 agent 在新会话里还能把自己拼回来。

## 当前版本

```text
主包：dsh-cortex-memory@0.4.22
提取器：dsh-cortex-extractors@0.3.5
DSH：>=0.2.1-rc.2 <0.4.0
Node：>=24
测试：440/440
```

## 现在能做什么

| 能力 | 说明 |
|---|---|
| 分层记忆 | 工作记忆、L1 情景痕迹、语义事实、程序技能、反思摘要 |
| 时序事实 | 事实带有效时间，支持更新、失效和争议，不把旧结论当永久真相 |
| 遗忘曲线 | DSR/FSRS 风格复习、遗忘、归档与唤醒 |
| 混合召回 | FTS + 向量 + 时间/重要性；弱相关候选在注入前过滤 |
| 自我状态 | 身份、驱力、情绪、关系、主动意图与校准 |
| 召唤卡 | L2 卡片 + L3 专题，按触发词浮回，可人工修订 |
| 反思与生活 | 摘要、日记、梦、睡眠整理 |
| 守护与审计 | 健康检查、完整性、FTS 对齐、备份、事件链 |
| 眼耳 | Windows OCR / Tesseract / Whisper / PaddleOCR，可选安装 |
| 本地优先 | SQLite 本地库；核心引擎无外部模型依赖 |

## 安装

先关闭 DSH，再安装并重启：

```powershell
dsh plugin --profile desktop add dsh-cortex-memory@0.4.22
dsh plugin --profile desktop add dsh-cortex-extractors@0.3.5
```

`dsh-cortex-extractors` 是可选的图片/音频入口；只做文字记忆时可以不装。

### Windows 一键包

GitHub Release 提供：

```text
cortex-memory-oneclick-0.4.21.zip
```

解压后双击 `install.cmd`。安装器会做 profile 检查、备份、SHA256 校验和可选路径迁移。

## 该装哪些

| 需求 | 建议 |
|---|---|
| 只要文字记忆 | 主包 |
| 看截图/图片 | 主包 + extractor，Windows OCR 即可 |
| 扫描件/复杂排版 | 再加 Tesseract + chi_sim 语言包 |
| 手写图片 | PaddleOCR + 本地模型目录 |
| 中文音频 | Whisper.cpp + ggml-small，显式下载 |
| 大模型 | 不安装；走 DSH 自己的模型服务 |

原则：

```text
核心零外部模型
提取器不自动下载模型
Whisper 需显式 -Whisper
PaddleOCR 需显式模型目录
不替用户填 LLM API key
```

## 开发与测试

必须使用 DSH 自带的 **Node 24** 跑测试/bench。系统 PATH 上如果是 Node 22，会低于 `engines.node >=24`，`node --test` 可能直接失败。

```text
DSH 运行时 Node：24.21.0
系统 Node：仅作兼容性参考，不保证
```

CLI 默认读取 `~/.dsh/cortex-memory`；需要指定其他库时显式传 `--data <dir>`。

## 性能与边界

已做：

```text
主包测试：440/440
受控中文语义探针：recall@3 1.000 / MRR@3 0.917 / nDCG@3 0.938
受控探针延迟：p50 1.31ms / p95 4.07ms
真实图片 OCR：已跑通
```

必须说清楚：

```text
受控语义探针是合成集，不是 LoCoMo/LongMemEval 官方分数
ASR 还没有真实音频样本验收
技能沉淀当前为 0，管线存在但没有真实技能闭环
没有多代理集群验证
```

Cortex 的定位是“本地可解释、可回滚、能长期长”的记忆系统，不把“功能多”宣传成“公开基准第一”。

## 和同类插件的区别

| 插件 | 主要强项 | 和 Cortex 的差异 |
|---|---|---|
| `dsh-persona-memory` | MEMORY.md / USER.md 文件记忆、用户画像、跨会话注入、简单直接 | 更轻、更透明；没有完整时序事实、DSR、自我状态和召唤卡 |
| `dsh-shiori` | Spark 卡、专题、触发词，卡/专题体验成熟 | 卡片层更专注；没有完整的情绪/关系/遗忘/自进化闭环 |
| `dsh-memory` | SQLite FTS、三工具、轻量 | 简单检索；没有分层、反思和生活模块 |
| `OpenViking` / `dsh-mnemon` | 平台化、多来源、上下文基础设施 | 更偏底座和 provider；Cortex 更偏“长期记忆 + 自我状态”一体 |

## 数据与隐私

```text
默认数据目录：~/.dsh/cortex-memory
本地 SQLite
不把密钥写进 npm 包
不自动上传记忆
提取器默认不下载模型
```

## 下载

- npm 主包：`dsh-cortex-memory@0.4.22`
- npm 提取器：`dsh-cortex-extractors@0.3.5`
- GitHub Release：`v0.4.21`
- Windows 一键包：`cortex-memory-oneclick-0.4.21.zip`

安装后重启 DSH，左侧出现「Cortex 记忆」入口。
