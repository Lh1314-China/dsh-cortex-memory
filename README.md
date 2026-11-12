# DSH Cortex

A local-first, layered memory engine for DeepSeek Harness.

Cortex gives an agent working memory, episodic traces, temporal facts, procedural
skills and reflective summaries, with calibrated forgetting instead of a flat
chat transcript. It runs locally on SQLite and has no native dependency in the
core engine.

## Status

- Stable package: `dsh-cortex-memory@0.2.0`
- Optional extractor: `dsh-cortex-extractors@0.3.3`
- DSH: `>=0.2.1-rc.2 <0.4.0`
- Node: `>=24`
- Tests: 406/406 (main), 12/12 (extractor)
- CI: GitHub Actions on Windows, Node 24

The npm package is named `dsh-cortex-memory` because `dsh-cortex` was already
taken; the installed bundle is still the Cortex memory engine.

## Install

```powershell
npm i dsh-cortex-memory
npm i dsh-cortex-extractors   # optional OCR/ASR
```

Or let DSH add the bundles:

```powershell
dsh plugin --profile desktop add dsh-cortex-memory
dsh plugin --profile desktop add dsh-cortex-extractors
```

Or use the Windows one-click zip from the GitHub Release. The installer
discovers a desktop DSH installation automatically; `-DshPath` remains available
for custom installs.

After installing, restart DSH or reload the plugin. The Cortex panel is in the
left sidebar by default.

## What it provides

| Layer | Contents |
|---|---|
| L0 identity | self-model, values, boundaries, stable traits |
| working | focus, pins, current goals, turn buffer |
| episodic | what happened, when, provenance, emotion |
| semantic | entities, facts with validity windows, preferences |
| procedural | skills, workflows, preconditions, success/failure stats |
| reflective | episode summaries, insights, narratives |
| archive | cold but searchable, wakeable until privacy deletion |

Key behavior:

- append-only, hash-chained event log
- temporal facts; old facts are invalidated, not silently overwritten
- FTS5 BM25 + optional vector + graph activation + recency/importance/feedback
- DSR/FSRS-inspired stability, difficulty and retrievability
- reflection, retention plans and explicit-approval evolution
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

- Local API: loopback-only, token and origin checks
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

