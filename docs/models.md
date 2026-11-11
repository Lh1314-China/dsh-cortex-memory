# 可选模型：embedder / rerank

> 结论先说：**安装包不自动下载模型，也不默认联网。**
> 大模型动辄几百 MB，自动下载会把“装插件”变成“装模型”，还可能带来磁盘、网络、校验和更新问题。
> 本插件只提供可插拔接口；用户显式配置后才使用。

## 0. 当前接线状态（2026-11-11）

- HTTP rerank：**已接到 QA**（`cortex_qa`），默认关，失败开放。
- HTTP embedder：**接口已实现**（`createOpenAIEmbedder`）；**异步索引入口** `POST /vector/index` / `POST /vector/rebuild` 已可用，写不会被网络阻塞；**异步混合检索** `GET /search?async=true` 与 QA 已走 `searchAsync`（远程向量可参与）；默认同步 `/search` 仍不等待网络。
- 安装包**不自动下载**任何模型。

## 1. 默认路径（零依赖）

- `features.vector = false`：不用向量，FTS5 + 图 + recent 融合。
- `features.vector = true`：使用内置 `hash-256` embedder（词法哈希，**不是语义模型**）。
- 不下载任何文件；不需要 `node_modules`；Windows 直接可用。

## 2. 可选 HTTP embedder

代码：`src/vector/providers.js` 的 `createOpenAIEmbedder`。

接口是 OpenAI-compatible `/embeddings`：

```http
POST {baseUrl}/embeddings
Authorization: Bearer <apiKey>
{"model":"bge-m3","input":["文本"]}
```

返回：

```json
{"data":[{"embedding":[0.1,0.2]}]}
```

它不会在安装时运行。要接本地服务（如 Xinference / Ollama 的 OpenAI 兼容层 / vLLM），由用户自己启动服务并提供 `baseUrl`。
**不要把 API key 写进仓库或安装包。**

## 2.1 本地 bge 可选配置（默认关）

本机实测用 Ollama 的 `bge-m3`（1024 维）通过 OpenAI 兼容 `/v1/embeddings` 接入。

### profile 配置

```yaml
- id: cortex
  name: dsh-cortex
  config:
    features:
      vector: true
    # dataRoot / dbFile 按你的 profile 配
```

### 模型配置

在 cortex 的 dataRoot 下放 `model-config.json`（可在面板模型设置里保存，效果相同）：

```json
{
  "embedding": {
    "mode": "local",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "bge-m3",
    "dim": 1024,
    "apiKey": ""
  },
  "rerank": {
    "enabled": false,
    "baseUrl": "",
    "model": "",
    "apiKey": ""
  }
}
```

- `mode: local` 表示本地 keyless 服务；不要把云端 key 写进仓库。
- 不配模型时，`features.vector=true` 只会用内置 `hash-256` 词法哈希，**不是语义模型**。
- 向量索引是暴力扫描，适合个人千条级记忆；不是十亿级 ANN。

### 实测代价（2026-11-11，300 traces / 50 paraphrase queries）

```text
FTS:  hit 0.96 / MRR 0.694 / nDCG 0.603 / p50 4.5-4.8ms
bge:  hit 1.00 / MRR 0.960 / nDCG 0.883 / p50 51-63ms
```

- 语义召回明显提升，但查询延迟约 10 倍。
- 这是合成 paraphrase，不是 LoCoMo；不能当公开 SOTA。
- 默认仍关闭；没有本地模型/服务就不要开。

## 2.2 可选 ANN（默认关）

```yaml
features:
  vector: true
  vectorAnn: true
vectorAnnMin: 20000
vectorAnnEngine: hnsw
```

- 复用 `src/vector/ann.js` 的单层 NSW 索引；纯 JS，无原生依赖。
- 小于 `vectorAnnMin` 时仍走暴力精确扫描。
- ANN 命中不足 5 条时自动回退暴力扫描，避免 scope/过滤把结果卡空。
- 首次搜索从 embeddings 懒构建；写入/删除会同步索引。
- 默认 `vectorAnn: false`；不开启时行为不变。
- 当前验证是单元/小规模，不是 100k ANN 压测；大库收益和召回还需单独 benchmark。
- 5000 条 A/B 结论（dim 64）：ANN ef=120 recall@10 0.29，ef=400 0.70（p50 0.99ms，暴力 1.11ms），ef=800 0.93（p50 2.73ms，暴力 1.16ms），ef=1600 0.998（p50 11ms）。**小库暴力反而更快**，所以默认阈值放在 20000，且 ANN 默认关。
- 20k / 100k 复验（ef=800/1600）：20k recall 0.591（ANN p50 5.4ms，暴力 9.2ms）；100k recall 0.413（ANN p50 10.9ms，暴力 38.9ms，构建约 101s）。
- HNSW 候选（`src/vector/hnsw.js`，二叉堆版）在 5k/20k 的质量：
  - 5k：recall 0.997，build 5.5s，p50 2.24ms（暴力 1.15ms）
  - 20k：recall 0.956，build 58.4s，p50 4.88ms（暴力 5.78ms）
- 所以 `vectorAnnEngine: hnsw` 已接到可选路径，但 **`vectorAnn` 仍默认关**；HNSW 冷构建慢，20k 以下没明显查询优势。
- 旧 NSW 保留为 `vectorAnnEngine: nsw` 的兼容选项，不再是默认引擎。
- 100k 构建/内存尚未验证；不建议在生产库直接开。

### 外置 ANN（默认关）

```yaml
features:
  vector: true
  vectorAnnExternal: true
vectorAnnEndpoint: 'http://127.0.0.1:8765/search'
vectorAnnTimeoutMs: 800
```

- 只接 `searchAsync` 异步路径；同步 `search` 继续精确扫描。
- 端点为空或请求失败 → 回退精确扫描，不丢召回。
- 客户端契约见 `docs/external-ann.md`。
- **需要你手动启动本地 ANN 服务**；当前没有常驻服务。
- 20k 端到端验证：recall@10 1.0，p50 20.3-20.8ms（HTTP 客户端 + HNSW 服务）。

## 3. 可选 HTTP rerank（已接到 QA）

代码：`createHttpReranker`，已在 `cortex_qa` 的检索结果上生效（失败开放，回退融合顺序）。

配置：

```yaml
- id: cortex
  name: dsh-cortex
  config:
    rerankEnabled: true
    rerankBaseUrl: "http://127.0.0.1:9000/v1"
    rerankModel: "bge-reranker-base"
    # rerankApiKey: ""   # 本机服务通常不需要
```

接口：

```http
POST {baseUrl}/rerank
{"model":"bge-reranker-base","query":"...","documents":["..."],"top_n":8}
```

返回 `results: [{index, relevance_score}]`。

默认关；没有配置或请求失败时，QA 保持原来的 RRF 顺序，不阻塞回答。

## 4. 本地 ONNX 模型（未内置）

本鲸没有把 `onnxruntime-node` 或 `@huggingface/transformers` 放进运行时依赖，原因：

- 安装体积大（数百 MB）；
- Windows 上原生二进制/驱动差异；
- 安装期下载模型不可审计。

后续如果要内置，应该是**单独的 optional 包**，并满足：

1. 用户显式点“下载模型”；
2. 显示 URL、大小、SHA-256；
3. 下载到 `~/.dsh/cortex/models/`，不写 profile；
4. 失败开放，不影响 FTS；
5. 可一键删除。

## 5. 安装包里有什么

- 没有模型文件；
- 没有原生 `.node`；
- 没有 `node_modules`；
- 只有纯 JS + SQL + 文档。

所以 Windows 用户装完即可用；要用语义模型时再按上面的配置接服务。
