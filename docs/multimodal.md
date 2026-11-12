# 多模态附件：只存引用，不存字节

> 当前实现是**元数据边界**，不是视觉/音频理解模型。

## 1. 写入

`cortex_write` / `POST /api/cortex/write` 支持 `attachments`：

```json
{
  "text": "用户发来一张示例图片。",
  "explicit": true,
  "attachments": [
    {
      "kind": "image",
      "uri": "https://example.test/rice.png",
      "name": "rice.png",
      "mime": "image/png",
      "bytes": 12345,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

约束：

- 最多 8 个
- `kind`: image / audio / video / file
- `uri` 必填，最长 2000
- `sha256` 必须是 64 位 hex
- `bytes` 0..1e9
- **不读取、不下载、不解析 URI**
- 不把二进制写进 SQLite

## 2. 存储

落在 `traces.metadata_json.attachments`：

```json
{
  "attachments": [
    {"kind": "image", "uri": "https://example.test/rice.png", "mime": "image/png", "bytes": 12345}
  ]
}
```

没有单独附件表，也没有内容寻址存储。旧库会通过 `ensureTraceColumns` 自动补 `metadata_json` 列，默认 `{}`。

## 3. 当前能做什么

- 记录“这条记忆关联了哪些附件”的引用
- 在 trace 读取时返回 metadata
- 在写入结果里报告附件数量
- 为未来的视觉/音频模型留出入口

## 4. 当前不能做什么

- 不能读取图片/音频内容
- 不能生成缩略图
- 不能做 OCR / 语音转写
- 不能校验 URI 指向的内容
- 不能防止恶意 URI（调用方自己负责）
- 不能自动下载模型

## 5. 安全边界

- 附件只是引用，不是可信内容
- 不要把私密 URL、token、签名参数写进 uri
- 隐私删除 trace 时，metadata 随 trace 一起离开；外部 URI 上的文件不在 cortex 控制内
- 导出 Markdown 是否包含附件元数据，后续再定

## 5.1 可选本地读取器（默认关）

```yaml
features:
  attachmentReader: true
```

```http
POST /api/cortex/attachments/inspect
{"uri":"file:///C:/path/rice.txt"}
```

- **只接受 `file://`**
- 只返回 name/bytes/mtime/sha256
- 不返回文件内容
- 最大 50MB
- 默认关；未开启 403
- 写入 audit：`attachment.inspect`

这不是 OCR/转写。它只做本地文件元数据与哈希校验，方便把附件引用和实际文件对上。

## 5.2 提取器联动（可选）

独立包 `dsh-cortex-extractors` 的 `cortex_extract_text` 支持显式 `traceId`：

```json
{"uri":"file:///C:/tmp/frame.png","mode":"ocr","traceId":"trc_target"}
```

- 主脑写入一条 **派生 trace**（不修改原 trace）
- metadata 保留 `derivedFrom`、URI、mode、engine
- 需要提取器与主脑同时启用
- 不传 `traceId` 时仍只返回文字，不写记忆

## 6. 下一步

1. 可选附件读取器接口（本地、显式开启）
2. 图片缩略图/OCR 作为独立可选包
3. 附件级删除/保留策略
4. 与 bge 一样：默认关，失败开放，不自动下载模型
