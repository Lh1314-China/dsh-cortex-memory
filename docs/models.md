# Optional models

## Default: hash

No model, no network. Uses a local lexical hash embedder.

## Local: Ollama bge-m3

```powershell
ollama pull bge-m3
```

Settings:

```text
mode: local
baseUrl: http://127.0.0.1:11434/v1
model: bge-m3
dim: 1024
key: (blank)
```

`bge-m3` supports Chinese and multilingual text. A smaller fallback is
`nomic-embed-text` (768 dimensions), but it is weaker on Chinese.

## Remote: OpenAI-compatible `/embeddings`

```text
mode: remote
baseUrl: https://your-provider.example/v1
model: your-embedding-model
dim: provider dimension
key: required
```

The remote mode refuses to save without a key. The key is stored locally and
redacted from API responses.

## Rerank (optional)

Any OpenAI-compatible `/rerank` service can be configured. If it is disabled or
fails, Cortex keeps the original fusion order.

## Security

- Do not paste keys into issues or chat logs.
- Local mode is the safest for private data.
- Remote mode sends memory text to the configured endpoint.
