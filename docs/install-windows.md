# Windows 安装与回滚

> 目标：和本鲸一样的 Windows DSH 用户，能从 tgz 直接安装，不需要编译、不需要原生依赖。
> 前提：**Node >= 24**（`node:sqlite` 内置）、DSH `>=0.2.1-rc.2 <0.4.0`、Windows 10/11。

## 1. 先备份

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
Copy-Item -Recurse "$env:USERPROFILE\.dsh\profiles\desktop" "$env:USERPROFILE\Desktop\dsh-profile-backup-$stamp"
```

`dsh-cortex` 默认数据在 `~/.dsh/cortex`，**不读写 shiori 的 `D:\shiori-data`**。第一次安装没有旧数据，不需要迁移。

## 2. 生成/取得 tgz

在 `plugins/dsh-cortex`：

```powershell
npm pack
# 产出 dsh-cortex-0.2.0-dev.1.tgz
```

如果用本鲸打好的包，直接用 `dist/dsh-cortex-0.2.0-dev.1.tgz`。包是纯 JS + SQL，无 `node_modules` 依赖。

## 3. 安装到 desktop profile

```powershell
dsh plugin --profile desktop add "C:\完整路径\dsh-cortex-0.2.0-dev.1.tgz"
```

路径必须是**绝对路径**。装完重启 DSH。不要用 `link:` 去指向一个会被清理的目录。

## 4. 验收

重启后：

1. 模型工具列表出现 21 个 `cortex_*`（至少 `cortex_write` / `cortex_search` / `cortex_as_of` / `cortex_playbook` / `cortex_consolidate`）。
2. 侧栏/插件面板能看到 Cortex。
3. 写一条测试记忆：

```text
cortex_write({ text: "安装验收：主人喜欢白饭。", explicit: true })
cortex_search({ query: "白饭" })
cortex_self({})
cortex_guard({ action: "check" })
```

4. API（默认只回环）：

```powershell
curl.exe http://127.0.0.1:7430/api/cortex/health
```

期望 `{"ok":true,...}` 且没有 shiori 数据被写。

## 5. 可选：开 LLM 巩固

默认 `features.llm=false`，巩固会记录 `skipped` 且零改动。可以在面板「设置 → 权限」点按钮，确认后写入：

```text
<dataRoot>/feature-overrides.json
```

**重启 DSH 后生效**；同一页可以回滚上一次权限修改，审计记录在本地 `audit` 表。
也可以用配置：

```yaml
- id: cortex
  name: dsh-cortex
  config:
    features:
      llm: true
      consolidateOnSleep: true
```

开之前先确认当前 DSH 的模型路由可用。失败会跳过，不阻塞睡眠。

## 6. 回滚

```powershell
dsh plugin --profile desktop remove dsh-cortex
```

重启。`~/.dsh/cortex` 不会被自动删除；确认不要后再手动处理。要恢复 profile，拷回第 1 步的备份。

### 卸载后清理手写 patch

如果你在 `cordis.patch.yml` 里手写过 cortex 配置，`dsh plugin remove` **不会删这段**。残留块通常不影响 `--dump-config`，但会让 diff 变脏，重装时也可能踩到“entry not found”。

可以用脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\examples\uninstall-cortex.ps1 `
  -Dsh "D:\path\to\dsh.cmd" -Profile <profile>
```

脚本只删 `- id: cortex` 段，保留其他 patch，并跑一次 `--dump-config`；不删 dataRoot。已手动移除时也会跳过 remove、继续清 patch。

卸载后检查：

```powershell
notepad "$HOME\.dsh\profiles\<profile>\cordis.patch.yml"
```

删除整段：

```yaml
- id: cortex
  name: dsh-cortex
  config:
    ...
```

保留其他条目；如果文件只剩注释，写回：

```yaml
[]
```

然后再跑一次：

```powershell
dsh --profile <profile> --dump-config > $null
```

不要为了清理 patch 去删整个 profile 目录；dataRoot 可能不在 profile 内。

## 7. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 装完没有工具 | 插件条目没 active / 重启没做 | 看 profile 的 bundles，重启 DSH |
| `node:sqlite` 报错 | Node < 24 或运行时不带 SQLite | 升级 DSH/Node 到 24+ |
| 工具名冲突 | 另一个插件也注册同名工具 | 先停用旧插件，或改名后再装 |
| 数据目录不对 | 改过 `dataRoot` | 用绝对路径，不要指向 profile 内部 |
| 面板 403 | 非回环 Host / 跨源 | 用 `127.0.0.1`，同源打开 |

## 8. 兼容性说明

- 这是 **bundle 插件**：`dsh.bundle.patch` 指向 `cordis.patch.yml`，装完自动注册 Host 行。
- 零运行时 npm 依赖；SQLite 用 Node 内置。
- Windows 路径手写 `C:\...` 即可；包内没有 shell 脚本。
- 不修改全局 patch，不覆盖系统提示，不碰 shiori。
