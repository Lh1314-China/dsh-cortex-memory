# Privacy notes

## Where data lives

Default data root:

```text
~/.dsh/cortex/
  cortex.sqlite
  backups/
  vector/
```

The exact paths are shown in the Settings tab. This data stays on the machine unless the user configures a remote provider or moves it.

## What is stored

- traces (episodic, semantic, reflective, derived)
- facts and graph edges
- working memory, goals, playbook rules
- audit events
- emotional appraisals and relationship state
- optional derived text from local OCR/ASR, with source URI and engine metadata

## What is not stored

- API keys inside `cortex.sqlite` (embedding/rerank keys live in
  `model-config.json` with best-effort mode `0600`, so they stay on disk but
  outside the memory database)
- raw model files
- the contents of arbitrary local files that were not explicitly passed to an extraction tool
- a copy of a deleted trace's body (delete cascades; the ledger keeps a content hash)

## Deletion and export

- `cortex_forget` archive keeps a trace recoverable; delete removes it and its derived data.
- `cortex_guard export` writes a Markdown mirror for inspection.
- `cortex_guard backup` creates a SQLite backup; validate a backup before restoring.
- Attachments are metadata references; the default attachment reader is disabled.

## OCR / ASR

- Extraction is explicit: a `file://` URI and a configured local engine.
- The extractor never downloads a model automatically.
- Extracted text is written as a **derived trace**; the target trace is unchanged.
- PaddleOCR/Tesseract/Whisper models are local files owned by the user.

## Cloud / network

Remote LLM, embedding and rerank calls are off unless explicitly enabled and configured. The local API is loopback-only by default. There is no automatic telemetry from Cortex itself.
