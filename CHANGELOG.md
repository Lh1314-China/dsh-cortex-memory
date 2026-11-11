
## 0.2.0-rc.12 — 2026-11-12

- Trace UI: added OCR layout selector (auto/single/two-column/handwriting), passed through the extractor boundary.
- `cortex_forget` / `cortex_get` validate ids before touching SQLite; Node 24 now returns readable sentinels instead of `ERR_INVALID_ARG_TYPE`.
- CI runs `node --test --test-isolation=none` with explicit test files and a Node version line.

## 0.2.0-rc.13 — 2026-11-12

- Layout selection is passed from the Trace UI through `/attachments/extract`.
- Node 24 CI compatible; id validation before SQLite.
