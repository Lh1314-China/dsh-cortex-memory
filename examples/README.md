# Cortex bge 可选 profile

默认 **不开启** bge。这个示例只给想要本地语义召回的人用：

- 需要本地 Ollama / OpenAI-compatible embedding 服务
- 需要 `bge-m3`（1024 维）
- 查询延迟会明显高于 FTS
- 没有服务时不要开；失败会退开放，不会假装成功

## 一键创建独立 profile

```powershell
powershell -ExecutionPolicy Bypass -File .\examples\setup-cortex-bge.ps1 `
  -Dsh "<DSH_HOME>\dsh.cmd" `
  -Profile cortex-bge `
  -Package "C:\path\to\dsh-cortex-memory-0.1.0.tgz"
```

首次先用 Ollama 启动模型服务：

```powershell
ollama serve
ollama pull bge-m3
```

脚本会：

1. 用 DSH 的 `web` 模板新建一个空 profile
2. 安装 cortex 包
3. 写独立的 `dataRoot/dbFile`
4. 写 `features.vector: true`
5. 写 `model-config.json`（local / bge-m3 / 1024）

它**不会**改 desktop，也不会自动启动服务。

## 启动

```powershell
& $Dsh --profile cortex-bge --port 0 --no-open
```

打开后到 Cortex 设置里确认：

```text
embedding mode: local
model: bge-m3
dim: 1024
```

## 关闭

移除 profile 或把 `features.vector` 改回 `false`。  
不想用语义模型时，FTS 仍是默认路径。

## 卸载 cortex

`dsh plugin remove` 不会删手写 patch。用：

```powershell
powershell -ExecutionPolicy Bypass -File .\examples\uninstall-cortex.ps1 `
  -Dsh "<DSH_HOME>\dsh.cmd" `
  -Profile cortex-bge
```

脚本会：

1. 若已安装则 `plugin remove`
2. 只删除 `- id: cortex` 段，保留其他 patch
3. 跑一次 `--dump-config`
4. **不删 dataRoot**

如果已经手动移除，脚本会跳过 remove，仍清理残留 patch。

