# Changelog

## 0.4.13 鈥?2026-11-13

### Added
- `evolution` guard in Config schema (`autoActivate`, `maxPerDay`, `minIntervalMs`, `canaryTicks`, `rollbackOnError`).
- Persistent canaries: `policies.canary_json` survives restart and rehydrates on engine creation.
- `recallSharing` opt-in recall block sharing across sessions.
- Persona-aware first-person extraction; markdown-fragment rejection retained.
- Built-in Wikipedia/SearXNG fallback when `features.webSearch` is on and no host `web` service exists.

### Fixed
- Automatic rollback without a previous policy now retires the failed policy as `superseded`, instead of leaving it as `candidate`.
- Canary ticks are persisted, not just kept in memory.
- Schema version bumped to 7 for the additive `canary_json` column.

## 0.4.12 鈥?2026-11-13

### Fixed
- `promptBudget` is normalized instead of being silently dropped and falling back to 1600.
- Injection gate moved into retrieval: weak recency/soft-FTS candidates are filtered before consuming the result budget. Full search/API/CLI remain available.
- Guardian light check runs structural invariants + FTS counts; deep `integrity_check` and the event-chain walk stay on the six-hour/startup path.
- Identity traces surface as `L0` in search results.
- `npm test` / `npm run test:unit` use explicit test globs so Node 22 can run them.
- Package `files` now includes `docs`, `examples`, `bench`, `test` and `CHANGELOG.md`; README install points at 0.4.12.
- Security/privacy docs now match the code: no bearer token; model keys are plaintext in `model-config.json` mode 0600, outside `cortex.sqlite`.

### Added
- `recentImportanceFloor` config (default 0.8, preserving 0.4.11's importance exemption).
- `gated` count in the retrieval trace.
- Regression tests for the prompt gate, importance exposure, identity L0, per-session recall, light/deep guardian, and configurable `promptBudget`.

## 0.4.11 鈥?2026-11-12

- Life/date fixes, graph candidate labels, neutral public package surface.
- Recent timeline endpoint and incremental summon rebuild.

## 0.4.0 鈥?2026-11-12

### Fixed
- Prompt-only injection gate; full search/API/CLI remain available.
- Search items now expose `importance`, `confidence`, `match`, `kind`; perm tier works.
- Removed cross-session single-cache fallback.
- `autoGraphCandidates` is the canonical graph flag; old name is an alias.
- Guardian scheduler uses light checks per tick and full checks at startup/6h.
- Guard backup/restore/export/prune/sync are constrained to `dataRoot` by default.
- Tests and docs are included in the package; `npm test` works after install.

### Added
- `persona.selfName` / `persona.userAddress`; neutral public defaults (`鍔╂墜` / `浣?.
- `injectionGate`, `recentMinMatch`, `allowRestoreOutsideRoot` config.

### Compatibility
- Additive config only; no schema migration.
- Existing 0.3.x databases open in place.
- Local profiles can restore the 鏈哺 / 涓讳汉 persona through config.

## 0.3.1 鈥?026-11-12

- AI diary entries no longer append a 閳ユ粌寮懓鍐ｂ偓?footer; web sources still inform the model but are not stored in the diary body.
- Manual dream generation timeout raised from 4s to 20s; `aiOnlyLife` still fails closed instead of falling back to a template.
- No schema change; compatible with 0.3.0 databases and DSH `>=0.2.1-rc.2 <0.4.0`, Node `>=24`.
## 0.3.0 闁?2026-11-12

### Added

- Summon cards (L2): left-brain emotion cards and right-brain work cards with trigger words.
- Summon volumes (L3): side/category/day indexes with representative text.
- Summon book: independent daily page; read-only by default, owner-gated editing with audit.
- Runtime summon injection: at most 3 cards / 900 tokens, labelled as untrusted historical references.
- Explicit card feedback (`helpful` / `ignored`) writes back to source-trace DSR. Injection alone never changes strength.
- Diagnostics panel: health issues, disputed-fact confirm/dismiss, and candidate-only skill extraction.
- Graph entity labels use names instead of ids; bounded LLM renaming for clearly broken names with confidence gate and audit.

### Changed

- Scheduler review runs every 90 minutes and generates pending intentions.
- AI diary is limited to 12:00/22:00; idle hourly writing is a feeling, not a diary.
- Identity capacity is enforced (L0 default 360 tokens); today's additions are prepended so they survive truncation.

### Compatibility

- Additive SQLite schema; existing 0.2.x databases migrate in place.
- DSH `>=0.2.1-rc.2 <0.4.0`; Node `>=24`.
- No API keys, personal paths, or private data are shipped.

## 0.2.2 闁?2026-11-12

- Public README and install commands.
- License metadata and package metadata fixes.
- No memory-engine behavior change.

## 0.2.0 闁?2026-11-12

- First stable release of the rc line.
- Trace UI extraction with layout selection.
- Windows OCR / Tesseract layout-aware column ordering.
- Permission confirmations and restart requirement documented.













