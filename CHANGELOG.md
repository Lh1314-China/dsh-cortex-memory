
## 0.2.0-rc.12 — 2026-11-12

- Trace UI: added OCR layout selector (auto/single/two-column/handwriting), passed through the extractor boundary.
- `cortex_forget` / `cortex_get` validate ids before touching SQLite; Node 24 now returns readable sentinels instead of `ERR_INVALID_ARG_TYPE`.
- CI runs `node --test --test-isolation=none` with explicit test files and a Node version line.

## 0.2.0-rc.13 — 2026-11-12

- Layout selection is passed from the Trace UI through `/attachments/extract`.
- Node 24 CI compatible; id validation before SQLite.

## 0.2.0 — 2026-11-12

- First stable release of the rc line.
- Trace UI: target trace + layout selector (auto/single/two-column/handwriting); extracts into a derived memory.
- Windows OCR and Tesseract layout-aware column ordering.
- Stable npm install no longer requires `@next`.
- Permission toggles show a confirmation, persist locally, and require a restart; settings copies now state that clearly.

## 0.2.1 — 2026-11-12

- Rewrote the public README: install, stable status, UI extraction, permissions, privacy, compatibility and extractor usage.
- No memory-engine behavior change.

## 0.2.2 — 2026-11-12

- Fixed the public LICENSE copyright line encoding.
- Added author/homepage/repository/bugs metadata.
- Added `dsh plugin ... add` install commands to the README.
- No memory-engine behavior change.

## 0.2.3 — 2026-11-12

- Dream generation now deduplicates identical dream text inside a 10-minute window.
- Life UI disables dream/sleep/diary actions while a request is in flight and collapses consecutive duplicate dream rows.
- Tests: 407/407.
