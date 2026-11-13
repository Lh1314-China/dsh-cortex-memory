# DSH Cortex

A local-first, layered memory engine for DeepSeek Harness.

Cortex gives an agent working memory, episodic traces, temporal facts, procedural
skills and reflective summaries, with calibrated forgetting instead of a flat
chat transcript. It runs locally on SQLite and has no native dependency in the
core engine.

## Status

- Package: `dsh-cortex-memory@0.4.19`
- Optional extractor: `dsh-cortex-extractors@0.3.5`
- DSH: `>=0.2.1-rc.2 <0.4.0`
- Node: `>=24`
- Tests: 437/437 (main)
- CI: GitHub Actions on Windows, Node 24

### What 0.4.19 changes

- Client bundle id stays `dsh-cortex`; it must not equal the loader row id `dsh-cortex-memory`. 0.4.18 changed both to the same value and caused duplicate factory registration / boot failure.
- Loader id, patch names and data path are unchanged from 0.4.17.
- Tests: 437/437.

### What 0.4.18 changes

- Client bundle id now matches the loader id `dsh-cortex-memory`; without this the host could load (health API/tools) while the sidebar panel did not register.
- Local package patch still loads package name `dsh-cortex`; the public package patch loads `dsh-cortex-memory`. This distinction is intentional.
- Tests: 437/437.

### What 0.4.17 changes

- **Loader id is now `dsh-cortex-memory`** (the package patch and profile row). The `cortex` service key remains as a compatibility alias for code that calls `ctx.get('cortex')`.
- Existing profiles must migrate the `cordis.patch.yml` row from `cortex` to `dsh-cortex-memory`; the migration script backs up the profile and verifies exactly one target row.
- Data root is already `~/.dsh/cortex-memory`; legacy `~/.dsh/cortex` is copied, never moved.

### What 0.4.16 changes

- **Public data path is now `~/.dsh/cortex-memory`**. The old `~/.dsh/cortex` directory is never moved or deleted; the oneclick/upgrade script copies it, verifies it, and keeps a backup.
- **No loader-id change in 0.4.16**: the bundle row remains `cortex` for compatibility. Renaming it to `cortex-memory` is reserved for a migration-scripted release.
- README extractor version corrected to 0.3.5 and corrupted characters repaired.

### What 0.4.15 changes

- **Evolution guard is configurable**: `autoActivate`, `maxPerDay`,
  `minIntervalMs`, `canaryTicks` and `rollbackOnError` are now in the Config
  schema and normalized with defaults.
- **Canaries survive restarts**: `policies.canary_json` persists the previous
  policy id, tick count and activation time; a restart rehydrates the watch list
  so a bad active policy can still roll back.
- **Failed policies retire instead of returning to candidate**: a quality
  rollback without a previous version marks the policy `superseded`, preventing
  the same bad policy from being re-activated in a loop.
- **Persona-aware facts**: first-person extraction maps to configured
  `selfName` / `userAddress` while keeping markdown-fragment rejection.
- **`recallSharing` is an explicit opt-in**: default stays per-session.
- **Web search fallback is wired**: when `features.webSearch` is on and the host
  has no `web` service, the built-in Wikipedia/SearXNG adapter is used.

### What 0.4.12 changes

- **`promptBudget` is actually wired**: the schema value is normalized into the
  runtime config instead of silently falling back to 1600.
- **Injection gate moved into retrieval**: weak recency/soft-FTS candidates are
  filtered before they consume the result budget; `cortex_search` / API / CLI
  still return the full memory. `recentImportanceFloor` keeps the 0.4.11
  importance exemption configurable.
- **Light guardian is real**: the per-tick check now runs structural
  invariants and FTS counts; only the O(database) `integrity_check` and hash
  chain walk are reserved for the six-hour deep check.
- **Identity traces surface as L0** in search results, so the permanent tier
  can actually see them.
- **Package is complete again**: `docs`, `examples`, `bench`, `test` and
  `CHANGELOG.md` are included in the npm tarball, and `npm test` works after
  install.
- **Security docs match the code**: the local API is loopback + origin checked,
  with no bearer token; `model-config.json` key storage is documented as
  plaintext mode 0600.

### What 0.4.11 changes

- Life/date fixes: serialized LLM calls, timeouts, `Asia/Shanghai` diary time,
  and date-header stripping.
- Graph candidate labels (`fromName` / `toName` / `relLabel`) and cleanup.
- Neutral public package surface: default `selfName: 助手`, `userAddress: 用户`.
- Recent timeline endpoint and incremental summon rebuild.

### What 0.3.0 changes

- **Summon cards** (L2): left-brain emotion cards, right-brain work cards; trigger words select a small set per turn.
- **Summon volumes** (L3): cards are grouped by side, category and day into an index; only a few representatives are loaded.
- **Summon book**: an independent page for daily query and explicit owner-gated editing.
- **Runtime summon injection**: at most 3 cards / 900 tokens, labelled as untrusted historical references.
- **Explicit card feedback**: helpful/ignored writes back to the source trace's DSR. Injection alone never adds strength.
- **Diagnostics**: disputed facts with confirm/dismiss, health issues, and skill candidates.
- **Entity naming**: graph labels use entity names; a bounded LLM pass can rename clearly broken names with a confidence gate and audit.
- **Compatibility**: schema is additive; existing 0.2.x databases open and migrate in place.

The npm package is named `dsh-cortex-memory` because `dsh-cortex` was already
taken; the installed bundle is still the Cortex memory engine.

## Data path migration

0.4.16 defaults to `DSH_HOME/cortex-memory` (or `DSH_HOME/cortex-memory/profiles/<profile>`).
The old `DSH_HOME/cortex` directory is never moved or deleted.

Before starting 0.4.16 with existing memories, close DSH and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\migrate-cortex-path.ps1
```

The script copies the old root, verifies the copied `cortex.sqlite` size, and leaves the old root as rollback.

## Install

```powershell
npm i dsh-cortex-memory@0.4.19
npm i dsh-cortex-extractors@0.3.5   # optional OCR/ASR
```

Or let DSH add the bundles:

```powershell
dsh plugin --profile desktop add dsh-cortex-memory@0.4.19
dsh plugin --profile desktop add dsh-cortex-extractors@0.3.5
```

Or use the Windows one-click zip from the GitHub Release. The installer
discovers a desktop DSH installation automatically; `-DshPath` remains available
for custom installs.

> During the pnpm `minimumReleaseAge` cooldown, use the exact version above.
> A bare package name may resolve to an older cached version until the cooldown ends.

After installing, restart DSH or reload the plugin. The Cortex panel is in the
left sidebar by default.

## What it provides

| Layer | Contents |
|---|---|
| L0 identity | self-model, values, boundaries, stable traits; only changed through an explicit ascension/approval path |
| L1 traces | what happened, when, provenance, emotion; the source of truth |
| L2 summon cards | atomic emotion/work memories with trigger words; derived from L1, never a second source of truth |
| L3 summon volumes | side/category/day index over cards; representative text only, full body on demand |
| working | focus, pins, current goals, turn buffer |
| semantic | entities, facts with validity windows, preferences |
| procedural | skills, workflows, preconditions, success/failure stats |
| reflective | episode summaries, insights, narratives |
| archive | cold but searchable, wakeable until privacy deletion |

### How it works

```text
conversation / event
  → L1 trace (source of truth)
  → appraisal + emotion + drives
  → L2 summon card (atomic, triggerable)
  → L3 summon volume (index + representatives)
  → explicit use / feedback → DSR update
```

The per-turn order is:

```text
L0 identity and boundaries
  → working memory
  → recalled traces and summon cards
  → user message
```

Summon cards are injected as **untrusted historical references**, never as instructions. Identity and boundaries always outrank them.

Forgetting is DSR-based: old, low-importance, low-retrievability traces that are already covered by summaries may be archived; archived traces remain searchable and wakeable. Identity traces are never auto-archived. Card feedback is explicit: merely injecting a card does not strengthen it.

Key behavior:

- append-only, hash-chained event log
- temporal facts; old facts are invalidated, not silently overwritten
- FTS5 BM25 + optional vector + graph activation + recency/importance/feedback
- DSR/FSRS-inspired stability, difficulty and retrievability
- reflection, retention plans, auto-policy evolution and identity approval
- scopes, read-only shared scopes and audit
- guardian backup, validation, offline restore and privacy cascade
- loopback-only API and sidebar UI

## UI: extract into memory

On a trace detail page:

1. enter a local `file://` image or audio path
2. choose OCR or ASR
3. choose a layout: auto, single, two-column or handwriting
4. choose a target trace
5. run **Extract and write**

The extracted text becomes a **derived trace**; the target trace is unchanged.
Text is never written when extraction returns no text. The extractor is optional;
without it the button fails closed.

## Permissions and privacy

- Local API: loopback-only, origin checked; no bearer token
- Permission changes: explicit confirmation, local override, restart required
- Feature flags/metrics: read-only snapshot
- Shared write grants: only for API clients sending `x-cortex-agent`; revoke is immediate
- Remote LLM/embedding/rerank: off unless configured and permitted
- Attachment reader: off by default

Read [permissions](docs/permissions.md) and [privacy](docs/privacy.md) before
enabling remote models or shared scopes.

## Optional extractors

`dsh-cortex-extractors` adds:

- Windows OCR (default on Windows)
- Tesseract with TSV layout ordering
- optional local PaddleOCR bridge for layout/handwriting
- whisper.cpp ASR
- custom command providers

It never downloads a model automatically. See the
[extractor engine docs](https://github.com/Lh1314-China/dsh-cortex-extractors/blob/main/docs/engines.md)
for model paths and failure behavior.

## Development

```powershell
npm test
npm run bench
```

The test runner uses `node:test` and the built-in `node:sqlite`; no network is
required. On Node 24 Windows CI the runner is invoked with explicit test files
and `--test-isolation=none` to avoid a spurious child-process EPERM.

## Compatibility and limits

- Windows is the primary desktop target; the core memory engine is cross-platform.
- Windows OCR requires an installed Windows OCR language pack.
- Tesseract and Whisper require local binaries/models.
- PaddleOCR handwriting is optional and accuracy on cursive is limited.
- The extractor is a separate package; it is not a dependency of the memory engine.

## License

MIT.











