# Cortex Memory for DeepSeek Harness

A layered, temporal, self-developing memory engine for DeepSeek Harness (DSH).
It is designed for long-lived personal agents: memory that can be recalled,
audited, consolidated and changed **without silently rewriting identity**.

> Current public version: **0.1.0**
> Package: `dsh-cortex-memory` (the npm name `dsh-cortex` is already taken by another project)
> License: MIT

## Why

Most memory plugins stop at "store and recall". Cortex adds four things that are
hard to bolt on later:

1. **Layered memory** — L0 identity, L1 working, L1.5 playbook, L2 episodic,
   L3 semantic/temporal graph, L4 procedural, L5 reflection, archive.
2. **Temporal truth** — event ledger, bitemporal facts, `strict / historical /
   belief / associative` queries, DSR forgetting.
3. **Gated growth** — consolidation, reflection, playbook candidates, policy
   proposals; identity and core changes require approval and can be rolled back.
4. **Guardian** — health audit, budgets, circuit breaker, backup/validate/restore,
   privacy cascade, secret/injection scanning.

## Install

Requirements:

- Node.js **>= 24** (uses the built-in `node:sqlite`)
- DSH `>=0.2.1-rc.2 <0.4.0`

### From a GitHub release tgz

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-cortex-memory-0.1.0.tgz"
```

### From npm (after publishing)

```powershell
dsh plugin --profile desktop add dsh-cortex-memory
```

The plugin owns `~/.dsh/cortex` and does not read or write another memory
plugin's data.

## Models

Cortex works with **no model** by default:

| Mode | What it uses | Key |
|---|---|---|
| `hash` | local lexical fallback | no |
| `local` | OpenAI-compatible local service, default Ollama `bge-m3` | no |
| `remote` | OpenAI-compatible `/embeddings` | **required** |

For local semantic search:

```powershell
ollama pull bge-m3
```

Then in **Settings → Embedding / rerank models** choose `local`, keep
`http://127.0.0.1:11434/v1`, model `bge-m3`, dimension `1024`.

Remote mode refuses to save without an API key. Keys are stored in the local
data directory and are never returned by the settings API.

Optional rerank uses an OpenAI-compatible `/rerank` endpoint; if it is off or
fails, fusion order is kept.

## UI

The client panel includes:

- Self / working memory / search / timeline / graph
- Emotion and life views
- Guardian, evolution, audit, retention
- **Playbook** with candidate review before activation
- Settings: feature switches, embedding/rerank configuration, permission
  overrides and rollback

All settings changes that affect runtime take effect after a plugin reload or
DSH restart.

## CLI

```powershell
node bin/cortex.mjs --data C:\path\to\data health
node bin/cortex.mjs --data C:\path\to\data search --query "米食"
node bin/cortex.mjs --data C:\path\to\data export-md --dir C:\path\to\mirror
```

## Testing

```powershell
npm test
```

The repository includes unit and integration tests for storage, retrieval,
temporal facts, playbook, consolidation, guardian, API, client contract,
installation packaging and edge cases.

## Architecture

```text
Host events -> capture -> encode -> event ledger + trace + facts + FTS
                                      |
prompt <- budgets <- tiered recall <- hybrid retrieval (FTS + graph + vector)
                                      |
                     reflection / consolidation / playbook / growth
                                      |
                     identity versions / policies / guardian / audit
```

See [docs/install-windows.md](docs/install-windows.md) and
[docs/models.md](docs/models.md).

## Data and privacy

- Default data root: `~/.dsh/cortex`
- No telemetry and no network calls by default
- `hash` mode is fully offline
- `local` mode talks only to the configured local service
- `remote` mode sends text to the configured embedding endpoint
- Do not put API keys in prompts or issue reports

## License

MIT. See [LICENSE](LICENSE).
