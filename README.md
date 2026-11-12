# DSH Cortex

A local-first, layered memory engine for DeepSeek Harness.

Cortex gives an agent working memory, episodic traces, temporal facts, procedural
skills and reflective summaries, with calibrated forgetting instead of a flat
chat transcript. It runs locally on SQLite and has no native dependency in the
core engine.

## Status

- Package: `dsh-cortex-memory@0.4.6`
- Optional extractor: `dsh-cortex-extractors@0.3.4`
- DSH: `>=0.2.1-rc.2 <0.4.0`
- Node: `>=24`
- Tests: 420/420 (main)
- CI: GitHub Actions on Windows, Node 24

### What 0.4.5 changes

- **Injection gate is prompt-only**: `cortex_search` / API / CLI still return the
  full memory; runtime recall filters weak recent candidates before injection.
  `injectionGate: false` restores the old all-recent behavior.
- **Permanent tier fixed**: search items keep `importance`, `confidence`,
  `match` and `kind`, so high-importance identity traces reach `perm`.
- **Per-session recall**: removed the 閳ユ笩ingle cached recall閳?fallback; sessions
  no longer share a recall block implicitly.
- **Persona is configurable and neutral by default**: the package defaults to
  `selfName: 閸斺晜澧渀 / `userAddress: 娴ｇ嚮; a local profile can set 閺堫剟鍝?濞戦潧鍔?
  Prompt, diary, dream and feeling templates read this config.
- **Graph feature flag fixed**: `autoGraphCandidates` is canonical; the old
  `graphCandidateAutoFacts` name remains accepted.
- **Guardian light/deep split**: scheduler runs a cheap check per tick and the
  full invariant/integrity walk at startup and every six hours; explicit
  `guardian.check()` still defaults to the full check.
- **Guard paths constrained**: backup/restore/export/prune/sync default to
  `dataRoot`; `allowRestoreOutsideRoot: true` is the explicit opt-out.
- **Tests and docs are in the npm tarball**, so `npm test` works after install.

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

## Install

```powershell
npm i dsh-cortex-memory@0.4.6
npm i dsh-cortex-extractors@0.3.4   # optional OCR/ASR
```

Or let DSH add the bundles:

```powershell
dsh plugin --profile desktop add dsh-cortex-memory@0.4.6
dsh plugin --profile desktop add dsh-cortex-extractors@0.3.4
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
  闁?L1 trace (source of truth)
  闁?appraisal + emotion + drives
  闁?L2 summon card (atomic, triggerable)
  闁?L3 summon volume (index + representatives)
  闁?explicit use / feedback 闁?DSR update
```

The per-turn order is:

```text
L0 identity and boundaries
  闁?working memory
  闁?recalled traces and summon cards
  闁?user message
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









