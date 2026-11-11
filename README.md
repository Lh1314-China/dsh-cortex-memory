# dsh-cortex

> 鏈哺鐨勬柊澶ц剳銆傚垎灞傘€佹椂搴忋€佸彲鑷垜宸╁浐鐨勮蹇嗗紩鎿庛€?> 鐘舵€侊細**鍙墦鍖呫€佸彲瀹夎**锛涙湰鏈哄紑鍙戝壇鏈粛鏈畨瑁咃紝涔熸病鏈夋帴 profile銆?> Windows 鐩存帴瀹夎/鍥炴粴瑙?[docs/install-windows.md](docs/install-windows.md)銆?
`dsh-cortex` is a local-first memory engine for DeepSeek Harness. It is designed
as a successor to the `dsh-shiori` + `dsh-shiori-companion` pair, not a patch on
top of them.

## Why another memory plugin

The shiori stack is good at four things: a stable persona, a compact core,
triggered spark cards and on-demand topics. It is weaker at temporal facts,
episodic provenance, procedural learning, consolidation and calibrated
forgetting. `dsh-cortex` keeps the good parts and adds the missing layers:

| Layer | What it holds | Lifetime |
|---|---|---|
| L0 identity | self-model, values, boundaries, stable traits | long, explicit promotion |
| L1 working | current goals, focus, pinned context, recent turn buffer | minutes鈥揾ours |
| L2 episodic | what happened, when, with whom, provenance, emotion | days鈥搚ears |
| L3 semantic | entities, facts with validity windows, preferences | until invalidated |
| L4 procedural | skills, workflows, preconditions, success/failure stats | until superseded |
| L5 reflective | episode summaries, insights, narratives | derived, regenerable |
| archive | cold but searchable, wake-word recall | until privacy deletion |

## Engines

- **event log** 鈥?append-only, hash-chained, `event_id` / `operation_id`; the
  only source of truth.
- **write pipeline** 鈥?scan secrets/injection 鈫?classify 鈫?dedupe 鈫?  conflict-resolve 鈫?link 鈫?persist; async jobs with idempotent operation IDs.
- **temporal graph** 鈥?entities, facts and edges with `valid_from` /
  `valid_to`; old facts are invalidated, never silently overwritten.
- **hybrid retrieval** 鈥?FTS5 BM25 + optional vector + graph activation +
  recency / importance / feedback, fused with RRF, diversified with a greedy
  MMR-style marginal-gain pass; query filters (`kind:`, `tag:`, `after:`,
  `importance:>`, 鈥?.
- **DSR forgetting** 鈥?FSRS-inspired stability / difficulty / retrievability;
  archive instead of delete, revive on successful recall.
- **compression / retention** 鈥?archive only when a derived model covers the
  trace, or when a reviewed retention plan says it is old/low-value; important
  memories are never auto-archived.
- **reflection** 鈥?episode segmentation, summaries, narrative threads,
  duplicate/contradiction detection, optional LLM dream/summary.
- **self model** 鈥?drives, mood, attention, appraisal, relationships,
  initiatives, 24-category emotion/affect, identity versions.
- **development** 鈥?maturity/stage from memory depth, feedback, calibration,
  skills, narrative and relationships.
- **evolution** 鈥?policy proposals 鈫?replay evaluation 鈫?explicit approval 鈫?  rollback; identity changes are separate and approval-only.
- **guardian** 鈥?invariants, circuit breaker, budget, backup/validate/offline
  restore, FTS repair, privacy cascade, secret/injection scanner.
- **host runtime** 鈥?`session/event` turn capture + `user/message` /
  `agent/pre-step` recall prefetch into the systemPrompt section.
- **API/UI/CLI** 鈥?loopback-only HTTP API, sidebar panel, `bin/cortex.mjs`.

## Status

This is a source-only development tree. `npm test` uses `node:test` and the
built-in `node:sqlite`; no native dependency and no network are required for
the core suite. Profiles install a built tgz explicitly; this tree is not
auto-linked into them.

- **395** tests passing (unit + integration).
- 21 model-facing tools.
- **`cortex_as_of`**锛歴trict / historical / belief / associative銆?- **`cortex_playbook`**锛歀1.5 宸ヤ綔鍑嗗垯锛屽甫 helpful/harmful銆乿alidTo銆佽繃鏈熶笉娉ㄥ叆銆?- **`cortex_consolidate`**锛歀LM 鍐崇瓥娓呭崟 + 鏍￠獙 + `dream_runs` 鍙洖鏀捐褰曪紱鏃?LLM 鏃惰褰?skipped 骞堕浂鏀瑰姩銆?- **`cortex_search({tiered:true})`**锛歱erm/hot/cold 鍒嗗眰棰勭畻锛宑old 鍙粰绱㈠紩銆?- **寮傛娣峰悎妫€绱?*锛歚GET /search?async=true` / QA 璧?`searchAsync`锛涜繙绋?embedder 鍙储寮曪紝涓嶉樆濉炲啓銆?- 5k synthetic benchmark (needle, vector off): ~2.6-2.8k writes/s, p50 ~20-35ms; 100k migration ~2.3s. These are local numbers, not an official score.
- Source/tests/docs 鈮?33k lines (includes `docs/book/`); source-only, not installed here.
- Windows tgz: `dist/dsh-cortex-0.2.0-rc.11.tgz` (zero runtime deps; Node >= 24).

## Design docs

- [research notes](docs/research/README.md)
- [architecture](docs/architecture.md)
- [Anima: from memory engine to a growing individual](docs/anima.md)
- [modules and invariants](docs/modules.md)
- [operations / CLI / backup](docs/operations.md)
- [security and privacy](docs/security.md)
- [scope isolation and read-only sharing](docs/scopes.md)
- [multimodal attachment metadata](docs/multimodal.md)
- [benchmark](docs/benchmark.md)
- [OpenAPI 3.1](docs/openapi.yaml)
- [API client](src/api/client.js)
- [UI guide](docs/ui.md)
- [design book](docs/book/README.md)
- [four-plugin comparison](docs/comparison-2026-11-11.md)
- [Windows install and rollback](docs/install-windows.md)
- [optional models](docs/models.md)
- [shiori companion review](docs/companion-feature-review.md)
- [ecosystem comparison 2026-11-11](docs/ecosystem-comparison-2026-11-11.md)
- [roadmap](docs/roadmap.md)

## License

MIT. External ideas are cited in the research notes; no third-party source
code is copied into this package.

