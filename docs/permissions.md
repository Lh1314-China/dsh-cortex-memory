# Permissions and scopes

Cortex is local-first. The defaults are intentionally conservative.

## Local API

- The API is loopback-only by default.
- Requests carry a local token; cross-origin and unsafe POSTs are rejected.
- `POST /permissions` requires `confirm: true`; a permission change writes a local override and takes effect after a DSH restart.
- `POST /permissions/rollback` removes the override and also takes effect after restart.

## Scopes

- Every trace, fact, relation, goal and working item has a scope.
- The global scope is writable by default; shared scopes may be read-only.
- Scope resolution order is header, then query, then body, then the server default.
- A write to a read-only scope is refused; it is not silently redirected.

## Shared write grants

- Shared write grants are for API clients that send `x-cortex-agent`.
- A grant is a `scope:agent` pair, with an optional expiry.
- Revoke takes effect immediately; the tool path does not send an agent header.
- The grant list is visible in the Settings tab.

## Network permissions

- `llm`: allow the configured model service for QA, consolidation or extraction facts.
- `embed`: allow remote embedding; local embeddings remain available.
- `rerank`: allow remote reranking.
- `vector`: enable vector indexing/search.
- If a provider fails or a permission is off, Cortex falls back to non-vector or evidence-only paths instead of inventing data.

## Feature flags

Feature flags and metrics on the Settings page are a read-only snapshot. Permission buttons are the writable part; they always show a confirmation and a restart notice.

## Audit and rollback

- Writes, merges, forgets, permission changes and guardian operations append to the audit ledger.
- `cortex_guard` can back up, validate, export and restore.
- Delete is a privacy cascade; the event ledger keeps only a content hash.
- A bad permission override can be removed with the rollback button.

## What Cortex does not do

- It does not read arbitrary files just because they are on disk.
- It does not send memories to a model unless the corresponding permission and provider are configured.
- It does not store API keys or passwords in memory.
