# 配额压缩（Quota Compaction）设计草案 · v3

> v1 → v2 → v3：v3 采纳第二轮评审意见（①–⑨），核心是**修复 r 的数学**（重归一）与**可核验、可承载的覆盖**。
> 状态：可以开工 0.4.116（只读）。未写执行代码。

## 0. v3 相对 v2 的关键修正

| 批注 | 修正 |
|---|---|
| ① 加权后 r 永远 <0.8 | `r` 改为**在场信号重归一** `Σ(w·s)/Σ(w)`；缺席项不进分母；阈值由 116 实测分位定 |
| ② extract.js 没有实体词表 | 改用 `src/memory/tokenizer.js` 的 `tokens()` + 数字/日期正则 |
| ③ pin 是死引用 | traces 无 pinned；保护位写 `kind==='reflection' \|\| kind==='promise'` |
| ④ access_count 是累计 | 改 `last_access_at >= now-30d`（有索引） |
| ⑤ 灰区没有入口 | evaluate 三档：auto / gray / keep |
| ⑥ 熔断阈值=额度 | 熔断改 2；REVIVE_PER_DAY 提到 6 |
| ⑦ 「2 轮/天」实为 0 | 现状 consolidateOnTick=false、traceDelta 为空 → 自动 0 轮；117 显式工具触发 |
| ⑧ 覆盖≠承载 | 加承载下限：摘要 tokens ≥ trace tokens 的 30%，否则只允许「有更优副本」时归档 |
| ⑨ 小项 | 样本 ≥30 再判精度；revive 口径统一；coverage2 预编译 grams；观测期等有轮次 |

## 1. 代码级根因（已核实）

```js
// compression.js L12：sourceIds 命中即覆盖=1（许可证）
if (sourceHit) return { coverage: 1, by: 'summary-source' };
// evaluate 四道门，importance<0.35 永不成立（p25=0.95）→ 管道从不触发
```

`REVIVE_PER_DAY = 3`，`get({revive:true})` 会自动复活并写 audit（读路径副作用）。

## 2. 可核验覆盖（coverage2）

```js
import { tokens } from '../memory/tokenizer.js';

coverage2(trace, summaries, facts):
  best = 0
  traceTokens = new Set(tokens(trace.title + trace.content))
  if (fact-source): best = 0.6
  for s in summaries (只取 period 与 trace 时间重叠的):
    sTokens = new Set(tokens(s.content))
    hit = |traceTokens ∩ sTokens|
    if hit >= 2:
      rate = hit / traceTokens.size
      score = min(0.9, 0.45 + 0.45 * rate)      // rate 0.5 → 0.675，rate 1.0 → 0.9
      // 承载下限：摘要必须装得下这条
      if (sTokens.size < 0.3 * traceTokens.size) score = min(score, 0.35)
      best = max(best, score)
  return best
```

- 数字/日期另加正则命中（`\d{1,4}`、日期格式），命中也算「实体」；
- 预编译：每轮把候选与摘要的 token 集算一次（`Map<id,Set>`），避免 N×M 重算；
- `sourceIds` 命中**仅用于选候选摘要**，不加分。

## 3. 信号与 r（重归一）

```
s1 = coverage2(t)                     权重 0.5
s2 = similarity_to_better_survivor(t) 权重 0.3   （无簇时缺席）
s3 = duplicate_support(t)             权重 0.2   （无簇时缺席）

r = Σ(w_i * s_i，仅在场项) / Σ(仅在场项的 w_i)
```

- 只有 coverage 在场时 `r = s1`，可以到 0.9 → 与 0/0.35 的低覆盖条有区分度；
- 「在场」判定：`s2` 需存在更优同簇成员；`s3` 需 dedupe 簇；
- **门槛双条件**：`r >= T` **且**在场证据类别 ≥1（coverage 或 similarity，其一是主证据）；
- `T` 由 116 实测分位定：初值 `T_hi = p90`、`T_lo = p75`，并给绝对下限 `T_hi >= 0.75`；若分布无区分度（p90−p75 < 0.05），116 就报告「信号不可用」，不开 117。

## 4. 三档判决（evaluate 入口）

| 档 | 条件 | 动作 |
|---|---|---|
| **auto** | `r >= T_hi` 且有第二证据 | 代码直接归档（无需 LLM） |
| **gray** | `T_lo <= r < T_hi` | 交 LLM 双问；一致才归档 |
| **keep** | 其余 | 不动 |

候选池前置过滤（都在打门前）：

- `isProtected`：`importance >= max(0.9, p75)`、`kind in (reflection, promise)`、`age < 7d`；
- `recentlyAccessed`：`last_access_at >= now - 30d`（不看累计 access_count）；
- 承载不足：`coverage2` 命中但摘要 tokens < 30% trace tokens → 只能走 gray，且必须有更优副本。

## 5. 配额（与真实轮次对齐）

现状：`consolidateOnTick=false`、`consolidateTraceDelta` 未配 → **自动巩固 0 轮/天**。117 执行必须显式触发（`cortex_consolidate action=run`，caller=tool）。

```
runs_day = 2                       // 人为安排：午/晚各一次
k_round  = clamp( ceil((|A| - S*) / runs_day), 0, ceil(0.025 * |A|) )
k_day    = min(2 * k_round, ceil(0.05 * |A|))
```

- `S*` 初值 **永不触发**（116/117 纯观测）；
- **bottom-k 只在 `r >= T_hi` 池内取**，不足就 0；k 是上限不是 KPI；
- LLM 全 keep 时，bottom-k 仍在该池内执行——唯一的「不会永不压缩」保证。

## 6. 安全与回滚

| 项 | 规定 |
|---|---|
| 软删 | `state='archived'`、`compression='quota'`、`metadata.archiveReason/basis` |
| 快照 | `VACUUM INTO backups/quota-<ISO>.sqlite`；时间戳命名；保留 7 天/2GB；**失败即跳过本轮** |
| 事务 | LLM 判定在事务外；archive+ledger 短事务（持锁 <1s） |
| 账本 | 新表 `compaction_ledger`：`op_id, trace_id, bucket(auto/gray), r, r_components, basis, before_hash, after_hash, created_at, revived_at, revived_by, revive_trigger(read/tool)` |
| 熔断 | 单轮被复活 ≥2 条，或连续两轮 ≥2% → 停用并写 health warn；`REVIVE_PER_DAY` 提到 6，避免熔断与额度耗尽重合 |
| 复活口径 | `compression.revive()` → `trigger='tool'`；`get({revive:true})` → `trigger='read'`；两条路径都写 ledger 并保留归档原因 |

## 7. 观测点（口径先定义）

- `archive_precision` = 1 − (归档后 7 天内**任一触发** revive 的比例)；
- `resurrection_rate_tool` = tool revive / 归档数；`resurrection_rate_read` = read revive / 归档数；
- `coverage_delta`：可核验覆盖占比变化；
- `quota_skipped_rounds`：快照失败/池不足跳过的轮次；
- health 一行：`压缩：候选 N · 归档 k · 复活 主动 T/读 D · 预算 S*/|A|`。

## 8. 分批落地

| 版本 | 内容 | 验收门槛 |
|---|---|---|
| 0.4.116 | 只读：coverage2、r 分布、三档划分、若开 118 会削哪 5 条 | 池 ≥20；`r≥T_hi` ≥5；列出 5 条含 basis；**不改库** |
| 0.4.117 | gray 双问 + auto 执行；每轮 ≤1%，绝对值 ≥5 条 | 累计归档 ≥30 条后再判：`archive_precision` ≥95% 或「0 主动复活」 |
| 0.4.118 | bottom-k、每日 5%、熔断接 health | 连续 3 天 tool 复活率 ≤2% |

## 9. 四问答案（采纳评审意见）

1. **S\***：先永不触发，纯观测；条数不是理由，冗余才是。
2. **摘要覆盖**：先修可核验 + 承载下限，再谈数量。
3. **utterance**：不加类别门槛；用证据门槛（可核验覆盖 + 承载）或 `r × 0.85`。
4. **ledger**：新表；`migrate()` 的 `CREATE TABLE IF NOT EXISTS` 对老库可行（已核）。

## 10. 仍未决

- `tokenizer.tokens()` 对中文的切分粒度（字/词）要实测；若是按字，命中率阈值要重标。
- `T_lo/T_hi` 先看 116 实测；若 p75/p90 差距 <0.05，直接宣布「信号不可用」，不开 117。
- 熔断恢复：自动熔断、人工恢复（待确认）。

## 11. 2026-11-16 晚的实测补充（重要）

在活库副本上跑 0.4.117 预演，并单独统计了「摘要自己声明覆盖的痕迹」：

- 5 条 episode 摘要的 `sourceIds` 并集 = **32 条**，而 active 有 **941 条** → 摘要声明覆盖率仅 **3.4%**；
- 这 32 条里，可核验覆盖 `r ≥ 0.25` 的只有 2 条，最高 0.33；
- 其余 909 条痕迹**从未被任何摘要选中**。

结论：**配额压缩的瓶颈不在评分器，也不在阈值，而在摘要的覆盖面本身。** 在覆盖率从 3.4% 提上来之前，任何「按覆盖归档」的方案都只能动极少数条目，或者被迫误伤。

因此 117/118 的顺序调整为：

1. 先让 episode 摘要更**广**（覆盖更多痕迹，哪怕每条更短）；
2. 再让摘要更**实**（可核验 token 覆盖）；
3. 最后才开灰区与配额。

`coverage2` 的统计口径也应改为**在 `sourceIds` 队列内评估**（「声明覆盖的是否真被装下」），而不是对全库 active 求覆盖——后者天然接近 0，会反复误报 `flat`。

## 12. 窗口补齐：操作口径（2026-11-16 晚定）

实现：`reflect.backfillEpisodes({ windowSize, maxWindows, dryRun, force })`，
工具入口 `cortex_consolidate action="backfill"`，**dryRun 默认 true**。

**口令：每段 40 条、跑 24 段。**

- 6 段是「走过 240 条」；每段真正写进 `sourceIds` 的是 `min(24, windowSize)` 条
  （24/40 = 60%），所以 6 段只声明 144 条 ≈15%，不是 60%；
- 要覆盖可压缩子集的 ~60%（约 576/949 条），需要 **24 段**；
- 窗口下限 32 条（32×25% 正好压在 `sourceBudgetFor` 的 min 8 上，更小会被静默过采样），
  上限 60 条；
- **幂等**：每个窗口先 `summaries.findPeriod()`，命中报 `already-reflected` 跳过；
  `force: true` 只用于「窗口真的变了要重算」；
- **同毫秒边界**：窗口会并入同一 `recordedAt` 的全部痕迹，`until` 取下一条不同的时间戳，
  避免批量写入时切在毫秒中间漏条目；
- episode 摘要是**抽取式**（不调 LLM），不存在摘要模型的 maxTokens 预算问题。

下一步（0.4.123）：真跑 24 段后，重新量 `declaredCoverage`（目标 ≥40%）与
`fidelity`（目标 ≥60%），再决定灰区是否开启。
