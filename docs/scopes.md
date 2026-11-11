# Scope 与只读共享

> 结论先说：`scope` 是**数据隔离边界**，`readOnlyScopes` 是**写保护**；
> 它们不是完整的身份认证/授权系统。能读 shared 的调用方仍然能读，只是不能改。

## 0. 默认行为

- 默认 scope：`global`
- 默认 `readOnlyScopes: []`
- 默认 dataRoot：`desktop` profile 仍是历史 `~/.dsh/cortex`；其他 profile 未显式配置时派生到 `~/.dsh/cortex/profiles/<profile>`（避免干净 profile 读到 desktop 库）
- 显式 `dataRoot` / `dbFile` / `CORTEX_HOME` 优先级更高
- 不配置 `readOnlyScopes` 时，写权限行为和以前一样

## 1. scope 怎么用

API 支持：

```http
x-cortex-scope: agent-a
```

或查询参数：

```text
?scope=agent-a
```

工具大多只操作当前配置的默认 scope；按 id 的写工具会先查记录所属 scope。

## 2. 只读共享示例

主配置：

```yaml
- id: cortex
  name: dsh-cortex
  config:
    scope: agent-a
    readOnlyScopes:
      - shared
```

含义：

- `agent-a` 可写自己的 scope
- `shared` 只能读
- 写 `shared` 的记忆、工作项、目标、准则、候选边、日记、情绪都会拒绝
- `forget` / compress / retention / consolidate / vector rebuild 也不会动 `shared`

API 返回：

```json
{"ok":false,"error":"scope-read-only","scopeId":"shared"}
```

状态码：**403**。

工具返回：

```text
未执行：该记录属于只读共享 scope。
```

## 2.1 显式写授权（可选）

默认只读 scope 谁都写不了。需要给某个 agent 开写时：

```yaml
- id: cortex
  name: dsh-cortex
  config:
    readOnlyScopes:
      - shared
    scopeWriteGrants:
      - shared:agent-a
      - grant: shared:agent-b
        until: '2026-12-31T00:00:00Z'
```

字符串是永久授权；对象形式到期自动失效。调用时带：

```http
x-cortex-agent: agent-a
```

未带 header / 未授权仍是 403。

### 运行时撤销/新增（不重启）

```text
GET  /api/cortex/security/grants
POST /api/cortex/security/grants  { "action": "add", "grant": "shared:agent-a" }
POST /api/cortex/security/grants  { "action": "revoke", "grant": "shared:agent-a" }
```

覆盖保存在 `<dataRoot>/scope-grants.json`，重启后仍生效。
撤销会写入 `revoked` 列表，优先于配置文件里的同名 grant。
这些改动会进 audit：`scope.grant.add` / `scope.grant.revoke`。

这不是登录或签名：header 是本地调用方自报的 agent id，只适合本机多 agent 协作。工具路径不带这个 header，因此工具仍按“默认 scope 只读”处理。

## 3. 多 agent 的两种隔离

### 同一 dataRoot，不同 scope

适合“一个进程里多个 agent / 会话共享一份库”。

- 各自读写自己的 scope
- `shared` 设为只读
- 谁有 API 访问权，谁就能读 `shared`

### 不同 dataRoot / profile

适合“完全不同的 agent，不共享数据库”。

- 每个 profile 独立 `dataRoot`
- 不会互相看到 traces/facts/graph
- 需要共享时，走导出/导入或单独的共享库

## 4. 这不是什么

- 不是多用户登录 / token 身份系统
- 不是按 agent 的细粒度 ACL
- 不会阻止能访问本地 API 的人读取 shared
- 不会自动把 desktop 数据迁到 shared
- 不会替调用方判断“这个 agent 该不该读”

## 5. 已验证的边界

- 两个 scope 的 facts / as-of 互不可见
- 两个 scope 的候选边互不混
- 只读 scope 的 write / working / goal / playbook / candidate / life / emotion / compress / forget 都会拒绝
- 候选边仍然要人工 approve 才进图

## 6. 还没做

- agent 身份与签名
- 显式 share grant / 到期时间
- 跨 agent 审计报表
- 多模态附件的共享边界

在这些完成前，文档里不要把它写成“多 agent 安全模型”，只能写“scope 隔离 + 写保护”。
