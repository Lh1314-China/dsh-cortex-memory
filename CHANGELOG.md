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
- `persona.selfName` / `persona.userAddress`; neutral public defaults (`鍔╂墜` / `浣燻).
- `injectionGate`, `recentMinMatch`, `allowRestoreOutsideRoot` config.

### Compatibility
- Additive config only; no schema migration.
- Existing 0.3.x databases open in place.
- Local profiles can restore the 鏈哺 / 娑靛効 persona through config.

## 0.3.1 鈥?2026-11-12

- AI diary entries no longer append a 鈥滃弬鑰冣€?footer; web sources still inform the model but are not stored in the diary body.
- Manual dream generation timeout raised from 4s to 20s; `aiOnlyLife` still fails closed instead of falling back to a template.
- No schema change; compatible with 0.3.0 databases and DSH `>=0.2.1-rc.2 <0.4.0`, Node `>=24`.
# Changelog

## 0.3.0 閳?2026-11-12

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

## 0.2.2 閳?2026-11-12

- Public README and install commands.
- License metadata and package metadata fixes.
- No memory-engine behavior change.

## 0.2.0 閳?2026-11-12

- First stable release of the rc line.
- Trace UI extraction with layout selection.
- Windows OCR / Tesseract layout-aware column ordering.
- Permission confirmations and restart requirement documented.












