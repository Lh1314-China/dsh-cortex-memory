# Changelog

## 0.4.147 — 2026-11-19

Second privacy pass: real-life wording out of the public text, a neutral icon and a smaller tarball.

### Changed
- **Real-life wording removed from CHANGELOG, source comments and fixtures.**
  Quoted fragments from private conversations are gone; examples are abstract
  ("a long truncated title") instead of copied text. Review attribution and
  live-store counts are generalized, so this changelog no longer reads like a
  private work log.
- **Fixtures neutralized.** The health-theme, ocean-themed and character-name
  fixtures are replaced with neutral topics; the transcript fixtures no longer
  mirror anyone's real life.
- **Neutral icon.** The embedded portrait is replaced with a plain node-graph
  logo, saving about 32 KB twice (`icon.svg` and the sidebar icon in `client.js`).
- **Tarball excludes `test/`** (`package.json.files`): smaller package, and the
  largest audit surface moves out of the shipped artifact. Tests stay in the
  repository and in CI.
- Template diary/feeling wording no longer uses a water/whale metaphor.

### Verified
- Unit: 520/520, twice.
- Integration: 126/126.
- Package scan: no names, local paths, credentials, real quotes or journal text.

## 0.4.146 — 2026-11-19

First public release since 0.4.22: the same engine, a neutral public surface.

### Changed
- **Private surface removed from the published package.** Persona defaults stay
  neutral (助手 / 你); a new optional `persona.description` config carries a custom
  self-description for LLM prompts. The migration script that rewrote local
  identity boundaries is gone — `bin/repair.mjs` covers the same data step.
- **Test corpus and benches are neutralized in this pass.** Fixtures use generic
  names and foods; persona defaults and local nicknames are out of the package.
  (0.4.147 is the second pass that removes the remaining real-life wording from
  this changelog and a few fixtures.)
- **README states the real shipped numbers**: version 0.4.146, 520/520 unit tests,
  DSH `>=0.2.1-rc.2 <0.5.0`.
- `src/engines/narrative.js` strips the configured `persona.selfName` speaker
  prefix instead of a hard-coded one; `src/self/alias.js` no longer ships a local
  nickname in `DEFAULT_USER_ALIASES`.

### Verified
- Unit: 520/520, twice.
- Integration: 116/126 — 10 pre-existing tool-contract/host-journey failures
  (documentation lag and host fixtures, not this release); the emotion target
  contract now passes, one more than 0.4.145.

## 0.4.145 — 2026-11-18

The speaker prefix hid the quote marker from the stripper.

### Fixed
- **"用户：> …" lost only half of its decoration.** The content was `用户：> 要彻底跟时间走…`:
  the stripper saw a leading `用户：`, not a `> `, so after the prefix came off the quote
  marker stayed and both the topic and the last clause began with "> ". A single
  `stripDecoration()` pass now removes speaker prefix and quote marker together, looping
  until stable (max three passes).

### Verified
- Unit: 520/520, twice. New: "用户：> " is stripped in either order.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.144 — 2026-11-18

The quoted seed topic still came from the captured title.

### Fixed
- **The seed topic reads content too.** `cleanTitle(seed.title || …)` still preferred the
  40-char captured title, so a topic ended mid-sentence ("…某段被截断的长标题"). It now
  takes `seed.content` first (quote marker and speaker prefix stripped), cuts at 60 chars on a
  punctuation boundary, and only falls back to the title when content is empty.
- Carries 0.4.143's fix: the "> " quote marker is stripped from both body clauses and the
  seed topic.

### Verified
- Unit: 519/519, twice. Assertion updated: the seed topic carries the whole sentence.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.143 — 2026-11-18

A quoted turn left a "> " marker in the paragraph topic.

### Fixed
- **The quote marker is stripped from thread text and the seed topic.** A turn captured from
  a quoted reply read as 「一段关于「> （某括号…）…」的经历」; `clean()` and `cleanTitle()` now
  drop a leading "> " before the speaker prefix, so it never reaches the paragraph.

### Verified
- Unit: 519/519, twice. New assertion: no "> " in thread content.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.142 — 2026-11-18

The paragraphs were still cutting capture's 40-char titles in half.

### Fixed
- **Thread text reads `content`, not `title`.** Capture stores a short title that stops
  mid-parenthesis ("…验收（工具名：desk") while the content holds the whole turn, so the
  paragraph kept a stump even after the sentence-splitting fix. `clean()` now takes the
  content first, strips capture's "用户：/助手：" speaker prefix, and falls back to the title.
  The 90-char truncation lands on a punctuation boundary and never inside an open bracket.

### Verified
- Unit: 519/519, twice. Assertions updated to the content-based text; new coverage: speaker
  prefix stripping and unclosed-bracket trimming.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.141 — 2026-11-18

Thread paragraphs: the last three rough edges seen in the live sample.

### Fixed
- **Long titles are cut at punctuation, not mid-bracket.** `truncate(90)` produced tails like
  "…验收（工具名：desk". The cut now drops an unclosed bracket tail first, then falls back to
  the last ，；。：、 inside the budget.
- **Markdown emphasis is stripped from thread text and from the seed topic.** `**…**` and
  backticks no longer leak into the paragraph or the quoted seed title.
- **A sentence ending in an English dot is no longer treated as a fragment.** `clean()` keeps
  the dot it split at, while the fragment filter rejected every `/\.$/` — so a complete
  sentence like "项目观察日志." was dropped. The dot rule now only catches digit-dot stumps
  ("dsh-cortex 0.").

### Verified
- Unit: 519/519, twice. New coverage: punctuation-safe truncation, markdown stripping, and an
  English-dot sentence surviving.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.140 — 2026-11-18

Thread paragraphs were cutting version numbers in half.

### Fixed
- **`sentence()` treated the dot in "0.4.139" as a full stop**, so every paragraph came out
  as a column of stumps ("20:49：dsh-cortex 0.；接着，21:05 0.；…"). The narrative engine now
  splits sentences with `[。！？!?]|\.(?![0-9])` — a dot only ends a sentence when it is not
  followed by a digit — and truncates at 90 chars instead of 60.
- **Stump fragments are dropped from the paragraph**: entries ending in a bare digit-dot or
  an open bracket ("dsh-cortex 0.", "（尾巴一摆）…") no longer become beats in the story.
  Short human titles ("两天前") are kept.

### Verified
- Unit: 517/517, twice. New coverage: version numbers survive; paragraph shape; short titles
  are not treated as fragments.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.139 — 2026-11-18

Four polish items: threads read like a paragraph, the deep pass sees the whole store, the
extractor stops quoting and commanding, and backfill samples 80% of a window.

### Changed
- **Threads are written as one flowing paragraph**, not a bullet dump. The date is stated
  once in the opener ("11月18日，…") and the clauses are joined with 接着 / 后来 / 最后, so a
  thread is something you read back instead of a list you scan.
- **The daily deep pass spreads across importance bands.** Ranking from the low end put all
  60 candidates at importance 0.7 (the next untouched band); `spread: true` takes half from
  the low end and samples the rest evenly, so one pass sees the store's shape.
- **Backfill samples 80% of each window (the 0.4.129 policy).** 24 of 40 left a structural
  40% of every window uncovered; it is now 32 of 40, and no extra windows are needed to
  raise that ceiling.

### Fixed
- **The rule extractor ignores quoted speech and imperatives.** 「他说：「小明喜欢白猫」」no
  longer produces `likes(小明 → 白猫)` about the speaker, and instructions ("记得把桥修好")
  no longer produce facts.

### Verified
- Unit: 516/516, twice. New coverage: paragraph shape, spread sampling, quoted/imperative
  filtering, and the 80% backfill budget.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.138 — 2026-11-18

The last truncation edge in the narrative pool.

### Fixed
- **The 24h pass no longer caps at 300 rows.** A busy day already reaches ~320 active traces
  in 24h (a production store: 315), so `around(24h)` with `limit 300` silently dropped the newest
  neighbours — exactly the ones a thread about "tonight" needs. Each pass now carries
  headroom above its own traffic: 24h → 600 rows, 72h → 1200, 7 days → 2000.
- Live check after 0.4.137: the first two threads woven at 14:04:10 UTC had bullets from
  18:0x–21:14 of the same evening and none of the 11-12/11-13 residue (`coverage 8/297`).

### Verified
- Unit: 514/514, twice. New regression test: 400 traces inside 24h with the seed last — the
  newest neighbour must still make the line.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.137 — 2026-11-18

The threads were reading last week's diary because of a pool bug, not the scoring.

### Fixed
- **`buildThread` queries the seed's own time range instead of "the first N traces since
  epoch".** `traces.listSince()` walks forward from its start and stops at `limit`; with a
  store older than the limit, the pool for a tonight-seed was the 300 oldest active traces
  (11-11 → 11-13), so the 24h window found nothing, the 72h window found nothing, and every
  thread fell through to the 7-day fallback — which held that same old residue. That is why
  0.4.136's hardening still produced threads full of "2026-11-12 …" bullets: the data source
  was truncated, not the ranking. `traces.range()` now queries `recorded_at` bounds directly,
  and the widest fallback allows 2000 rows so it is not truncated again.
- Live evidence before the fix: `listSince('2026-11-11', limit 300)` ended at
  `2026-11-13T09:15Z`, while the store had 1437 active traces through 11-18.

### Verified
- Unit: 513/513, twice. New regression test: 310 old traces plus a tonight seed — the nearby
  traces must win and the old ones must stay out of the line.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.136 — 2026-11-18

Narrative threads now follow the clock instead of importance.

### Changed
- **`buildThread` uses a hard time window.** It used to rank every trace from the last 7 days
  by `importance*0.35 + recency*0.3 + tags*0.2 + content*0.15`, so a 1.0 identity trace from
  last week could still crowd the seed's neighbours out of the line. A thread is "what
  happened around this moment", not "the heaviest things I remember": candidates now come
  from `seed ± windowHours` (default 24h), widening to 72h and finally the whole 7-day pool
  only when the window holds fewer than two other traces (a silent night still gets a line).
- The scoring formula is unchanged — with a bounded pool its only job is "which of these
  neighbours is most relevant", which it does fine.
- `windowHours` is configurable via `threadWindowHours` (maintain path and the same key on
  the sleep path); the returned summary records the window it actually used. Existing
  threads are not rewritten.

### Verified
- Unit: 512/512, twice. New coverage: nearby traces win over far-away high-importance ones;
  the widening fallback still produces a line when the neighbourhood is quiet.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.


## 0.4.135 — 2026-11-18

The four optimizations agreed after 0.4.134.

### Added
- **A daily deep consolidation pass.** Once a day, after `deepConsolidateHour` (local, default
  4am), the scheduler runs one wider pass (`deepConsolidateLimit`, default 60 rows) with
  `caller: 'deep-daily'`. The 30-minute delta trigger stays; this is the "one proper
  housekeeping a day" pass. A mid-day restart does not repeat it — the audit row records the
  caller. Disable with `deepConsolidateOnSchedule: false`.
- **Health shows today's housekeeping**: `consolidation.today` = `{ runs, archived, merged }`
  since local midnight, rendered as "今日整理：N 趟 · 归档 X 条 · 合并 Y 条". A pass that
  changed nothing is not counted as a run, so the number answers "did memory get tidier today".

### Changed
- **Narrative seeds are picked by recency, not importance.** Sorting by importance kept
  threading the same old identity traces, so every thread read like "about the build" or
  "about the promise". The line now follows what actually happened lately.
- **The rule extractor ignores design discussions.** Pasted drafts and plan posts
  ("新坑 3：…", "设计草案：…", "待办：…") talk about what might happen, not what did; they no
  longer produce fact rows.

### Verified
- Unit: 510/510, twice. New coverage: deep-pass timing / once-a-day / limit / disable, today
  counters, recency seeding, discussion-text filtering.
- Integration: 115/126, unchanged — the same 11 pre-existing environment failures.


## 0.4.134 — 2026-11-18

The two retention/coverage gaps recorded during the 0.4.131 self-review.

### Fixed
- **Narrative threads have a retention cap.** Threads were rebuilt from recurring topics every
  6h (and immediately after every restart, since the timer is in-process), so `summaries` grew
  without bound — 5 threads in one evening for essentially two topics. `weave()` now keeps the
  newest `maxTotal` (default 24) and drops the oldest tail (`pruneThreads`).
- **Thread bullets no longer repeat the date.** Trace titles often start with their own date,
  so lines read "2026-11-12 2026-11-12 上午…". The prefix is omitted when the text already
  starts with it.
- **Dedupe samples the whole distribution.** Taking only the lowest-importance 80 rows meant a
  duplicate pair in the middle of the store was never seen. Candidates are now half from the
  low end and half evenly sampled across the rest (window 80 → 160).

### Verified
- Unit: 501/501, twice. New coverage: date prefix, thread cap, dedupe sampling across
  importance.
- Integration: 115/126, unchanged — same 11 pre-existing environment failures.
- Live check after 0.4.133: the first applied consolidation. 11 traces merged (one 10-way
  merge of repeated-delivery receipts plus two pairs), `summaries.level='merge'` 0 → 3,
  active 1441 → 1430. A preview no longer blocks the real pass; the model produced correct
  multi-id merge shapes.


## 0.4.133 — 2026-11-18

Two idempotence-gate holes found by self-review right after 0.4.132 shipped.

### Fixed
- **A `skipped` row only blocks a retry while there is no adapter.** 0.4.132 made
  `skipped` / `preview` / `rejected` all pass the gate, which would have brought back the
  0.4.130 noise ("no-llm" row on every tick). The gate now distinguishes: without an adapter
  an identical skipped row is reused; with an adapter a skipped row may retry. `applied` and
  `degraded` (a real answer) are still reused; `preview` and `rejected` always pass.
- **`dedupe`'s idempotence gate ignores preview rows too.** It read the latest
  `model='dedupe'` row without filtering `preview`, so a rehearsal blocked the real dedupe
  pass on the identical decision set.

### Verified
- Unit: 498/498, twice. New coverage: a skipped row written without an LLM does not block a
  later real run (verified across two store instances); a dedupe preview does not block the
  real dedupe pass.
- Integration: 115/126, unchanged — the same 11 pre-existing environment failures.


## 0.4.132 — 2026-11-18

Closes the four gaps 0.4.131 exposed on its first day in a production store.

### Fixed
- **A dry run is recorded as `preview`, not `degraded`/`applied`.** 0.4.131 made preview rows
  stop counting as "asked", but `consolidation.run({ dryRun: true })` still wrote a real
  status, so that half of the fix never fired. A rehearsal no longer pushes its batch out of
  the next real pass, and the idempotence gate lets the same batch through afterwards.
- **`health` ignores preview rows** when reporting "the last consolidation", so a rehearsal
  cannot masquerade as a real pass.
- **The consolidation prompt spells out merge shape**: `ids` must contain at least two traces,
  `targetId` must be one of them, and a one-id merge is rejected. The live model kept
  answering `merge` with a single id (6 times in one run) and the validator correctly refused
  it — the fix belongs in the instruction, not in the validator.
- **Dedupe ranks candidates lowest-importance first.** Near-duplicates cluster at the low end
  (one-off acknowledgements, repeated-delivery receipts) and the old importance-descending
  order never reached them inside the 80-row window. Merge targets are still the most
  informative copy.

### Verified
- Unit: 496/496, twice. New coverage: a preview does not occupy the next batch, merge prompt
  rules, dedupe candidate order.
- Integration: 115/126; one stale assertion fixed (`no-llm` → `no-llm-adapter`), the remaining
  11 failures are the same environment failures present on 0.4.130.


## 0.4.131 — 2026-11-18

Consolidation stops asking the one question it can never answer differently.

### Fixed
- **Candidate selection ranks the other end of the store.** 0.4.116→0.4.130 sorted active
  traces by importance descending, so every run handed the model the batch its own prompt
  protects (99% of a production store is >= 0.7 and the top slice is all 1.0) and the only
  possible answer was keep. Candidates now rank: no summary cites the trace yet → not shown
  to the model in the last 24h → lowest importance, oldest first. Asked traces sink instead
  of disappearing, so a fully asked pool rotates back over the stale end.
- **The protection line is one fixed threshold again (0.9).** A percentile of a
  self-selected top slice always equals the batch maximum; the line covered every candidate.
  >= 0.9 is protected from archive/merge, 0.7–0.9 may merge, < 0.7 may archive.
- **The idempotence gate covers every status, not just `skipped`.** An applied run whose
  decisions were all keep used to burn a fresh LLM call every 30 minutes on an identical
  input. A rejected batch is still retried — that was the model's own bad output.
- **`health` compares FTS rows per scope.** It counted the global traces against the whole
  FTS index, so any second scope (`agency` in a production store) produced a permanent FTS_DRIFT
  warning for exactly those rows.
- **`maintain()` no longer closes a dispute while both facts are `disputed`.** `disputed` is
  not "not active"; the old condition resolved the dispute and left the facts unqueryable
  forever. Disputes closed by older versions leave orphan `disputed` facts; those are now
  invalidated on the next maintain pass (`report.orphanDisputes`).
- **The rule extractor does not turn questions or conditionals into facts.** "你会有感觉吗"
  became will(助手 → 有感觉吗) and "要是想聊两句" became is(要 → 想聊两句). Questions (？/?
  or a final 吗/呢/吧) and if-clauses (要是/如果/假如/万一/倘若/若) are skipped; a
  single-character subject is only allowed for pronouns and address words.

### Added
- **Narrative threads are actually woven.** `narrative.weave()` existed but nothing called
  it, so `summaries` never held a level='thread' row. `maintain()` weaves up to two threads
  every six hours (config `narrativeWeaveGapHours`); `life.sleep()` weaves as part of its
  report (`narrative` field).
- **Dedupe runs on a schedule** every six hours (config `dedupeGapHours`, `dedupeLimit`;
  `dedupeOnSchedule: false` disables it), so the merge layer no longer stays empty until
  someone asks by hand.

### Verified
- Unit: 493/493, twice. Integration: 114/126 pass; the 12 failures are the same pre-existing
  environment failures as 0.4.130 (tool registry count, persona default, journey fixtures).
- New coverage: selection order, idempotence across statuses, rejected retry, FTS per scope,
  question/conditional extraction, orphan disputes, weave in maintain and sleep, scheduled
  dedupe.


## 0.4.130 — 2026-11-16

Housekeeping release: closes the four P3 items that were deliberately deferred during
the 0.4.116→0.4.128 chain. No new features.

### Fixed
- **Consolidation and dedupe see 500 active traces, not 200.** The old pool silently hid
  anything older than the newest 200; the LLM still receives at most `limit` rows.
- **`dedupe` has the same idempotence gate as `run()`.** Re-preparing an identical decision
  set returns `skipped: 'unchanged'` instead of appending another dream_runs row + audit
  on every call (`force: true` overrides).
- The `invalid-json` branch now records `groups` / `groupsDropped` like every other exit.
- `cortex_consolidate action: "run"` refuses a non-dry run on a read-only scope (dedupe
  already did).

### Verified
- Tests: invalid-json carries group counts; identical dedupe runs report `unchanged`.
  Suite: 477/477, twice.


## 0.4.128 — 2026-11-16

### Fixed (accounting only; no behaviour change to backfill)
- The tool schema's `maxWindows` still said `maximum: 20` while the engine allowed 64.
  Both are 64 now; 0.4.127's "20 → 64" note is corrected to "engine 64 / tool 64".
- `already-reflected` skip rows now also carry `matchedEpisodes` (how many episodes
  contributed to the union coverage), alongside `coveredRatio`.

### Live state after the 21-window backfill
- episodes 26 (5 old + 21 backfilled), union coverage 507/855 = 59.3%.
- The remaining 348 uncovered traces are the structural remainder of sampling 24 of every
  40 traces (21 × 16) plus the 3-trace tail: **60% is this sampler's ceiling**, not a
  threshold problem. Raising it means changing the per-window source budget (0.4.129,
  a policy choice), not more windows.

### Verified
- Suite: 475/475, twice.


## 0.4.127 — 2026-11-16

### Fixed
- **Backfill can resume from a cursor.** Every call restarted at epoch, so a second batch
  spent its whole `maxWindows` quota re-walking already-written windows and could never
  reach the tail — 851 non-reflection traces exceed 20 windows × 40. `backfillEpisodes`
  now accepts `since` (the previous batch's `until`), the tool exposes it, and the ceiling
  is raised to 64.
- **Same-millisecond windows made the 0.5 coverage bar fragile.** A production store's first
  window contains 51 traces sharing one timestamp (bulk import) while reflect samples 24,
  so coverage = 24/51 ≈ 0.47 — below the bar, meaning a re-run would write a duplicate.
  Resume (`since`) removes that path; the coverage bar stays as a second guard.

### Verified
- Live: first real segment written (`period 2026-11-11T03:31:26.778Z`, 584 chars,
  24 sourceIds, active 961→962, episodes 5→6), backup taken first.
- Tests: new resume test (batch 2 continues from batch 1's `until`; re-running the same
  `since` writes nothing). Suite: 475/475, twice.


## 0.4.126 — 2026-11-16

### Fixed
- **The stale comment 0.4.125 said it removed is actually gone now.** 0.4.125 added the
  correct "threshold 0.5" note but left the old "covers >=80% … (50% would skip a
  half-covered stretch)" paragraph above it, so the function still contradicted itself.
  This release deletes the old lines (verified: no `>=80%` left in the file).
- Skip diagnostics now include `coveredRatio` (e.g. `skipped: already-reflected,
  coveredRatio: 0.62`), so a preview can be explained without guessing which episode
  accepted the window.

### Verified
- Suite: 474/474, twice; `reflect.js` syntax clean and no stale threshold text remains.


## 0.4.125 — 2026-11-16

### Fixed
- **The comment claimed a threshold the code did not use.** It said "≥80% of its trace ids
  (50% would skip a half-covered stretch)", while the code compared against 0.5. The
  comment now states 0.5 and explains why: reflect samples ~60% of a window (24/40), so a
  fully reflected window scores ~0.6 and an 0.8 bar would never fire.
- **Coverage uses the union of all episode sources.** It was per-episode (`find`), so a
  window split between two episodes (30% + 30%) was judged "not written" and rebuilt. The
  union of every episode's `sourceIds` is computed once per window; the exact
  `findPeriod` check still runs first.

### Verified
- Suite: 474/474, twice; backfill tests unchanged and green.


## 0.4.124 — 2026-11-16

### Fixed
- **Idempotency is measured in traces, not wall-clock time.** 0.4.123 compared period
  spans, but the first window starts at 1970 (a 56-year span), so a summary covering
  recent traces could look <50% on the timeline and get re-written. A window now counts
  as already reflected when an episode's `sourceIds` cover ≥50% of the window's trace ids
  (reflect samples ~60% of a window, so a fully reflected one scores ~0.6; a 0.8 bar would
  never fire). `force: true` still rewrites.
- The `maxWindows` schema description said "默认 3" while the code used 8.

### Note
- The earlier time-overlap approach could also *over*-skip: a summary covering half the
  wall-clock span but few traces would block a window whose traces were never captured.
  Trace ids do not have that failure mode.

### Verified
- Backfill tests use distinct trace texts so sampling spreads (near-identical seeds made
  reflect keep a single source, which hid the effect). Suite: 474/474, twice.


## 0.4.123 — 2026-11-16

### Fixed
- **Backfill idempotency now accepts overlap, not just equality.** Re-walking the same
  stretch with a different `windowSize` (40 → 32) produced different period boundaries and
  therefore a second overlapping episode — declared coverage would inflate while the store
  said "covered". A window is now skipped as `already-reflected` when an existing episode
  covers ≥50% of it; `force: true` still rewrites.
- The backfill tool's `maxWindows` default is 8 (was 3), so reaching 24 windows no longer
  silently needs eight calls with the default.

### Verified
- Tests: re-running with a different window size skips the overlapping windows and adds at
  most the genuinely new tail; boundary-millisecond traces still group; 473→474 suite
  passes, twice.


## 0.4.122 — 2026-11-16

### Fixed
- **Backfill is idempotent by default.** It passed `force: true` unconditionally, so
  re-running the same window wrote a second episode. Each window now consults
  `summaries.findPeriod()` first and reports `already-reflected`; `force: true` is only
  for "the window genuinely changed, recompute".
- **Same-millisecond boundaries are no longer dropped.** `until` used `last + 1ms`, so if
  several traces shared the boundary millisecond, the rest fell forever between windows
  (the next window starts at `>=` that timestamp). The window now extends to include every
  trace with the boundary timestamp and ends at the *next* distinct timestamp.
- The tool's span text tolerates a trailing `{ skipped: 'not-enough-traces' }` entry
  (it has no `since`/`until`) instead of printing `—`.

### Note
- The 3.4K-char summary budget concern does not apply to this path: episode summaries are
  extractive (no LLM call), so there is no `maxTokens` to exhaust here.

### Verified
- Tests: a second identical run adds zero summaries and reports `already-reflected`;
  three traces sharing the boundary millisecond all land in the same window. Suite:
  473/473, twice.


## 0.4.121 — 2026-11-16

### Added
- **Timeline backfill for episode summaries.** Declared coverage was 3.4% because only
  five episodes existed; `reflect.backfillEpisodes()` now walks the timeline in windows of
  32–60 traces (default 40, clamped) and writes one episode per window, with `until` as an
  exclusive end so one episode cannot swallow the whole history. Exposed as
  `cortex_consolidate action: "backfill"` with `dryRun` defaulting to true; each window's
  `sourceIds` stays within the existing 24-source budget (`maxSources` clamp 1–40 is
  respected by construction).

### Verified on a production store (read-only copy)
- `windowSize 40, maxWindows 6` → planned 6 windows, covering 1970-01-01 → 2026-11-12
  (the first 240 traces). To reach the compressible subset's ~60% the plan needs roughly
  20–24 windows, matching the reviewer's estimate.

### Verified
- `reflect-backfill.test.js`: preview writes nothing; a real run writes episodes with
  ≤24 sources and distinct periods; `windowSize < 32` is clamped to 32. Suite: 471/471,
  twice.


## 0.4.120 — 2026-11-16

### Fixed
- **`bin/verify.mjs` labels the installed version, not the source tree.** It used to read
  `../package.json` (the checkout), so the 0.4.118 snapshot recorded `0.4.119` once the
  source was bumped — the baseline label for a whole version was wrong. It now reads
  `<profile>/node_modules/dsh-cortex/package.json`, reports `versionSource:
  installed|source` plus `sourceVersion`, and `--installed` exits 1 when nothing is
  installed. Verified against the live profile: `version 0.4.119 / versionSource
  installed` while the checkout is at 0.4.120.

### Verified
- Unit suite unchanged: 468/468, twice. `verify.mjs --installed` fails closed, plain
  `verify.mjs` still succeeds.


## 0.4.119 — 2026-11-16

### Fixed (review of 0.4.118 — do not install 118)
- **The fact channel was silently dead.** It built fact text from `fact.subject`, which facts
  do not expose; the text was an English predicate plus a literal, so Chinese traces never
  matched (factCovered = 6). It now resolves subject/object names through the entities repo,
  appends `objectLiteral` and `evidence`, and reuses the precompiled token sets (the unused
  `factScoreFor` duplicate is deleted).
- **Preview no longer hands out single-evidence candidates.** `wouldCut` is `strongPool`
  only; when a pool exists but has no row with two evidence kinds the reason is
  `single-evidence-only`.
- The preview threshold is a parameter (`coverageThreshold`, clamped 0.2–0.9) instead of a
  hardcoded 0.35, and is echoed back in the report.

### Verified on a production store (read-only copy)
- active 945 · summaryCovered 423 · **factCovered 67** · both 52 · pool 67 · strongPool 52
- r p50 0.022 / p90 0.537, spread 0.515 · **`usable: true`**
- First time the gate opened: fixing the fact fields lifted fact coverage from 6 to 67 rows.
  Execution is still preview-only; 0.4.120 will target summary windows (episode count), not
  a lower threshold.

### Verified
- Suite: 468/468, twice.


## 0.4.118 — 2026-11-16

### Changed
- **Preview thresholds are reachable.** With `0.92 * rate` a 0.75 line needs rate 0.815, so the
  pool was structurally empty; the preview now uses an absolute `0.35` line and reports a
  `strongPool` that additionally requires two evidence kinds.
- **Facts are a first-class coverage channel.** Facts are grouped by `sourceEventId` and
  scored against the trace text (≥2 shared content tokens, `0.5 + 0.4*rate`); the preview
  reports `summaryCovered`, `factCovered` and `bothCovered` separately.
- **DF cutoff 10%, not 60%**: with 945 documents the old cutoff (567) filtered nothing; a
  synthetic test now pins that generic bigrams like 「我们」 are dropped.
- Removed the dead `rate < 0.15 → ≤0.2` cap (0.92×0.15 is already below it) and the
  fallback that returned the *unfiltered* set for short traces.
- `reason` is evaluated as `no_signal → empty_pool → flat`; the tool default is now 5000
  (it was still 500, silently truncating).

### Verified on a production store
- active 942 · summaryCovered 423 · factCovered 6 · both 5 · pool 6 · strongPool 5
- r p50 0.02 / p90 0.048, spread 0.028 → **`reason: flat`, `usable: false`**
- So the pool is no longer structurally empty, but the signal is still too thin: the next
  move is summary **granularity** (session/day-level), not a lower threshold.

### Verified
- Suite: 467/467, twice.


## 0.4.117 — 2026-11-16

### Fixed (review of 0.4.116's scorer — do not install 116)
- **The flat distribution was the formula, not the summaries.** `score = 0.45 + 0.45*rate`
  turned any 2-token overlap into 47% coverage, so p50 sat at its floor and the spread
  collapsed to 0.013. The score is now `0.92 * rate` with a rate-based cap only
  (`rate < 0.15 → ≤0.2`); there is no additive floor and no length-based penalty that
  used to pin long traces at 0.35.
- **Content tokens are filtered by document frequency.** `tokens()` keeps raw CJK
  bigrams with no stopword pass, so 「我们 / 可以 / 这个」 made any two sentences look
  similar. High-frequency tokens (in >60% of the batch) are dropped before scoring, with
  a small character stop-set as a second guard. Sets are built once per preview run.
- **`usable` now explains itself**: `no_signal` (scored <10) / `flat` (p90−p50 <0.05) /
  `empty_pool` (no row over threshold), instead of one ambiguous boolean.
- The preview scans all active traces by default (limit 5000) and reports
  `scanned`, so the 500-row truncation cannot hide the store size; the protection line
  is now the same `max(0.9, min(0.95, p75))` as consolidation.

### Verified on a production store (read-only copy)
- active 940 · skipped 293 protected / 179 recent · scored 461 · 5 summaries
- r p50 **0.041** / p75 0.059 / p90 0.088, spread 0.047 · best row **0.33**
- **`reason: flat`** — with the honest scorer the current summaries really do cover very
  little. The next move is summary quality, not quota archiving.

### Verified
- Suite: 466/466, twice.


## 0.4.116 — 2026-11-16

### Added
- **Read-only compaction preview** (`cortex_consolidate action: "preview"`), the first
  step of the quota-compaction plan. It computes a *verifiable* coverage score
  (`coverage2`): a summary only counts when its own tokens overlap the trace, thin
  summaries are capped at 0.35, and `sourceIds` membership alone no longer grants 1.0.
  Protected traces (importance ≥ max(0.9, p75), reflection, promise) and recently
  accessed ones (`last_access_at` within 30 days) are skipped, then the r distribution
  (p50/p75/p90) and the would-be cut list are reported. It writes nothing.

### Verified on a production store (read-only copy via `VACUUM INTO`)
- 939 active · skipped 293 protected / 178 recent · 461 scored · 5 summaries
- r p50 0.472 / p75 0.481 / p90 0.494; **spread 0.013 < 0.05 → `usable: false`, pool 0**
- Conclusion: the coverage signal is not usable yet. Per the design, 0.4.117 (gray-zone
  judgements) must **not** start until coverage quality improves — exactly the gate the
  reviewer asked for.

### Verified
- `compaction-preview.test.js`: coverage2 scoring/caps, preview is read-only. Suite:
  466/466, twice.


## 0.4.115 — 2026-11-16

### Fixed
- **The threshold clamp actually clamps.** 0.4.114 computed `simThreshold` but both
  comparison sites still used the raw `threshold`, so the clamp was dead code. It is now
  `clampThreshold(value)` (exported and unit-tested: 0.1 → 0.5, 1.5 → 0.99, 0 / NaN →
  0.8) and both the clustering loop and the target-similarity filter use it. The tool
  schema now declares `minimum: 0.5, maximum: 0.99`.
- **`cortex_health` no longer shows a dedupe preview as the last consolidation.** The
  consolidation line now excludes rows with `model = 'dedupe'`, so a manual preview
  cannot hide the last real LLM run.

### Verified
- New `dedupe-threshold.test.js`; Suite: 464/464, twice.


## 0.4.114 — 2026-11-16

### Fixed
- **Dedupe no longer merges by transitive accident.** Union-find is transitive: A~B and
  B~C could pull an A that is not similar to C into the same merge. Every member must
  now also be a near-duplicate *of the chosen target* (Jaccard ≥ threshold), otherwise
  it stays active and the group is counted as dropped.
- **Provenance on merge summaries.** The summary now lists the titles that were merged
  away (`去重合并 2 条到 X（含：A / B）`), so an audit can tell what disappeared without
  opening every archived row.

### Fixed (review pass from the reviewer teammate)
- `protectedCount` now uses `isProtected`, so a low-importance reflection is counted as
  protected (it used to slip past the all-protected check and burn an LLM call).
- **All-protected batches keep `update`/`conflict`.** The short-circuit that skipped the
  model also killed the only non-destructive action; the batch is still sent, with a
  prompt that forbids `archive`/`merge` and allows `update`/`conflict`.
- dedupe previews record `status: 'preview'` instead of `degraded`, so `cortex_health` no
  longer shows a dry run as a failed consolidation.
- `dryRun` is normalised once (`Boolean`), threshold is clamped to 0.5–0.99, the dedupe
  digest is namespaced (`dedupe:` / `run:`) so it cannot collide with the unchanged
  gate, summary provenance insert is best-effort, and a non-dry dedupe on a read-only
  scope is refused at the tool layer.

### Verified
- Property test: every archived trace is still ≥ threshold similar to an active trace
  after a dedupe run. Suite: 463/463, twice.





## 0.4.113 — 2026-11-16

### Changed
- **Dedupe may merge traces that sit on the protection line.** A production store has 75% of
  active traces at importance ≥ 0.95, so "two protected members" is the normal case and
  the old rule dropped every group — dedupe could not merge a single pair. Since dedupe
  has already proved the members are near-duplicates (Jaccard ≥ threshold) and
  reflections are excluded from the pool entirely, keeping N copies buys nothing:
  `validateDecision` gains `allowProtectedMerge`, used only by dedupe. The LLM path
  keeps the strict rule (a protected trace may never be a merge source).

### Verified
- Tests: a protected pair is now merged; a reflection never takes part in dedupe and
  survives untouched; an LLM merge proposal over protected traces is still rejected.
  Suite: 462/462, twice.


## 0.4.112 — 2026-11-16

### Fixed
- **All-protected batches no longer waste a call or look alarming.** On 2026-11-16 the
  automatic trigger hit a batch whose 30 candidates were all ≥ 0.93, so every proposal
  was rejected and the run read `rejected 20`. When every candidate is on the
  protection line the run now records `skipped / all-protected` without calling the
  model at all.
- **Rejection counts carry their reasons**: the error label is now
  `rejected 3（protected×2 · unknown-id×1）` instead of a bare number.
- **One protection predicate.** `validateDecision`'s archive branch checked
  `importance >= protect || kind === 'reflection'`, but the merge branch only checked
  importance — so a low-importance reflection could be merged away as a merge *source*.
  Both branches, the duplicate-group builder and the deterministic dedupe now use the
  same `isProtected(trace, protect)` helper; reflections may only ever be the target.

### Added
- **Deterministic dedupe.** The LLM kept answering `keep` even when handed duplicate
  groups, so the mechanical half of consolidation no longer asks it: `consolidation.dedupe()`
  clusters active traces by 2-gram Jaccard (threshold 0.8 by default), picks the
  best-preserved member as the merge target, refuses any group with two protected
  members, and archives the rest with `compression: merged` plus a `dedupe` merge
  summary. Exposed as `cortex_consolidate action: "dedupe"` with `dryRun` defaulting
  to true.
- `record()` now returns `groups` / `groupsDropped` on the run object, so callers (and
  the tool output) can read them without a second SQL query.

### Verified
- Tests: dry run reports one group without touching the store; a real run archives one
  trace and leaves a merge summary; two protected members are never merged. Suite:
  457/457, twice.


## 0.4.111 — 2026-11-16

### Fixed
- **The protected member is now a structural merge target.** 0.4.110 dropped groups
  with two protected members but only *asked* the model to keep the protected one as
  `targetId`; if it picked another member the whole decision was rejected as
  `protected-merge`. Groups are now offered as `{ ids, mustBeTarget }` and the prompt
  says the target must be the `mustBeTarget` id.
- **Dropped groups are counted.** The audit row now carries `groupsDropped` next to
  `groups`, so `groups: 0` no longer hides "there were duplicates but the protection
  line removed them".

### Verified
- Tests: two-protected group → `groups: 0`, `groupsDropped: 1` and no group in the
  prompt; one-protected group → `groups: 1` and `mustBeTarget` present. Suite:
  454/454, twice.


## 0.4.110 — 2026-11-16

### Fixed
- **Duplicate groups are filtered by the protection line before they reach the
  model.** `validateDecision` rejects a `merge` whose non-target member is protected,
  so a group with two protected traces could only produce a decision that fails —
  and the rejection read like "there were duplicates but it kept them". Groups with
  two or more protected members are dropped; a group with exactly one keeps that one
  as the target and the rest as sources.

### Added
- Every consolidation audit row now records `groups`, the number of duplicate groups
  actually offered. Without it there was no way to tell "no duplicates" apart from
  "duplicates that were dropped".

### Verified
- Tests: a two-protected group is withheld (`groups: 0`); a one-protected group is
  offered (`groups: 1`). Suite: 454/454, twice.


## 0.4.109 — 2026-11-16

### Fixed
- **The per-tick path is no longer a per-minute LLM call.** `features.consolidateOnTick`
  was silently `true` in `feature-overrides.json` since 11-12 (the profile yml never
  mentioned it), so the scheduler ran a full consolidation every tick — hundreds of `no-llm`
  rows are that history, not a broken adapter. The tick path now honours
  `consolidateTraceGapMinutes` (default 30) and reports `too-soon` instead.
- `lastRealConsolidationAt` joins `dream_runs` so the audit lookup is scoped; with
  several scopes it no longer reads another scope's run.

### Added
- **Duplicate groups are handed to the model.** Capture already rejects
  byte-identical traces, so exact matching finds nothing; candidates are clustered by
  2-gram Jaccard ≥ 0.6 and the groups are listed in the prompt with an instruction to
  `merge` the best-preserved one. Without this the model kept answering `keep` even
  when nothing was protected.

### Verified
- Tests: tick gate skips within the gap and runs after it; paraphrased duplicates
  reach the prompt as a merge group. Suite: 452/452, twice.


## 0.4.108 — 2026-11-16

### Changed
- **The protection line is now relative.** Live data had 99% of active traces at
  `importance >= 0.7`, while the prompt and validator both protected everything at
  `>= 0.7` — so consolidation could only ever answer `keep`. The line is now
  `max(0.9, min(0.95, p75))` of the current batch: the top slice stays protected
  (reflections always), everything below it may be merged or archived, and the
  prompt states the actual line and how many items it protects. Same lesson as the
  cold tier: absolute thresholds vs. an absolute-heavy distribution.

### Fixed
- **`consolidateOnTick` can no longer starve the delta trigger.** The tick path has
  no interval gate, so it would write a run every minute and make
  `runAutoConsolidate` permanently `too-soon`. The delta trigger now measures the
  gap from the last *non-tick* `consolidation.run` audit row, falling back to
  `dream_runs` when no audit exists.
- `tool` and `api` call sites now pass `caller`, so every consolidation run names
  its actor.

### Verified
- New tests: quantile line protects the top and archives the bottom; the prompt no
  longer hardcodes 0.7; tick-written runs do not starve the trigger; audit-less
  stores fall back to the table. Suite: 449/449, twice.


## 0.4.107 — 2026-11-16

### Changed
- **Consolidation budget raised again, with evidence.** After 0.4.106 shipped, the
  automatic trigger produced two real runs within a minute and both were still
  `empty-text:max-tokens` at 2400 — the answer keeps being cut off by the cap, not
  rejected. Budgets are now 6000 for the bounded and retry attempts, 3000 for the
  plain attempt (a cap is a ceiling, not spend).

### Added
- **Consolidation records who called it.** `dream_runs` has no caller column, so
  each run now writes `audit(consolidation.run, { caller })`; callers pass
  `auto-trace-delta` / `tick` / `sleep` / `tool`. Two runs a minute apart used to be
  unexplainable from the data alone.

### Fixed
- `health`'s `LLM_EMPTY` buckets no longer render `llm-empty:empty-text:max-tokens`
  and `llm-empty-retry:empty-text:max-tokens` as two identical entries; the retry
  bucket reads `…（重试）`.

### Verified
- New tests: caller lands in the audit row; retry bucket is distinguishable.
  Suite: 445/445, twice.


## 0.4.106 — 2026-11-16

### Added
- **Consolidation gets its own trigger.** Until now it only ran inside sleep, which
  is gated to once per 20 h — so every version's acceptance test waited a day.
  With `features.consolidateOnTraceDelta` on, each scheduler tick checks whether
  at least `consolidateTraceDelta` (default 20) new active traces appeared since
  the last consolidation and at least `consolidateTraceGapMinutes` (default 30)
  passed; if so it runs a real consolidation and records
  `report.steps.autoConsolidate` (`fresh / status / model / decisions / applied`,
  or a skip reason `too-soon` / `not-enough-new-traces`).

### Fixed
- **Per-call failure reasons.** The adapter now accepts `onReason`, so a failure is
  reported to the caller that caused it; an interleaved dream/feeling call can no
  longer reset or overwrite another call's reason. `ask()`'s outer catch records
  `exception-outer` instead of swallowing silently.
- `health`'s consolidation line now shows `决策 N（keep M）· 应用 K`, so an
  `applied` run where every decision was `keep` reads as the no-op it is.

### Verified
- `scheduler-autoconsolidate.test.js`: runs when fresh ≥ threshold and gap passed;
  skips with a reason otherwise; off by default. `consolidate-reason.test.js`
  covers `exception-outer` and reason scoping across calls. Suite: 443/443, twice.


## 0.4.105 — 2026-11-16

### Fixed
- **The output budget was cutting the answer off.** The installed 0.4.103 recorded
  `llm-empty:empty-text:max-tokens` — the model's reply was truncated at the token
  cap, not rejected, so the text came back empty. Consolidation budgets are raised:
  bounded attempt 2400 (was 1400), plain attempt 1600 (was 900), retry 2400
  (was 1600). With reasoning tokens sharing the same budget, 900 was simply too
  small.

### Verified
- `consolidate-retry.test.js` asserts the bounded attempt now requests ≥2000 tokens.
  Suite: 437/437, twice.


## 0.4.104 — 2026-11-16

### Changed
- **Big payloads now start bounded instead of failing first.** Live evidence from the
  installed 0.4.102: a ~10k-char payload produced an empty answer, while the slim
  retry (10 × 220 chars) returned a valid array with 10 `keep` decisions and was
  recorded as `llm-retry`. So candidates over 5000 chars now begin with a bounded
  attempt (20 items × 300 chars, `maxTokens` 1400) and are recorded as
  `llm-bounded`; if that still comes back empty, the 10 × 220 retry runs and is
  marked `llm-retry`. Small payloads keep the original single call.

### Verified
- `consolidate-retry.test.js`: 40 long traces → one bounded call, model `-bounded`;
  retry path and reason labels unchanged. Suite: 437/437, twice.


## 0.4.103 — 2026-11-16

### Added
- **`cortex_health` reports consolidation and sleep.** `dream_runs.error` is the
  only place that says *why* consolidation did nothing; leaving it in a table
  meant remembering to look. `health` now exposes
  `consolidation { dream, sleep }` and the text adds one line, e.g.
  `巩固 2026-11-16T09:34 空转（llm-empty:empty-text:length） · 睡眠 …（skipped，反思 1）`.

### Verified
- `health-consolidation.test.js`: a run without an adapter shows `空转（no-llm-adapter）`
  and `睡眠 还没有记录`. Suite: 436/436, twice.


## 0.4.102 — 2026-11-16

### Fixed
- **Empty answers now say why.** The adapter keeps the failure reason
  (`no-selection`, `finish-error`, `exception`, `empty-text:<finish kind>`) and
  consolidation records `llm-empty:<reason>`. When the slim retry already ran and
  still came back empty the label is `llm-empty-retry:<reason>`, so "retried and
  still empty" is no longer indistinguishable from "empty on the first try".
  (Both P2s from the 0.4.101 review.)
- `health` matches the `llm-empty%` family and reports the reason buckets, so one
  glance shows whether the fix is about prompt size, purpose, or wiring.

### Verified
- `consolidate-reason.test.js`: reason carried through; retry-exhausted label;
  health buckets by reason. Suite: 435/435, twice.


## 0.4.101 — 2026-11-16

### Changed
- **Consolidation retries once with a slimmer prompt.** A production store's payload
  averages ~5k characters; when the first call comes back empty and the payload
  exceeds 4000 chars, it retries with the top 10 items and 220-char contents. A
  successful retry is recorded as `llm-retry` in the model column, so the extra
  path is visible instead of indistinguishable from a plain success. Short
  payloads do not retry (a retry would only repeat the same empty answer).

### Verified
- `consolidate-retry.test.js`: 16 long traces → two calls, second prompt shorter,
  status `applied` with a `-retry` model; 3 short traces → one call, `llm-empty`.
  Suite: 432/432, twice.


## 0.4.100 — 2026-11-16

### Fixed
- **`labelEntities` still returned the old `no-llm` skip label.** It now returns
  `no-llm-adapter`, matching `consolidation.run`, so one word no longer covers two
  different failures. (P3 from the 0.4.98 review; the historical rows stay
  as they are.)

### Verified
- `label-entities-skip.test.js`: without an adapter the skip label is
  `no-llm-adapter`. Suite: 430/430, twice.


## 0.4.99 — 2026-11-16

### Added
- **`autoSleep`: the scheduler can now start a sleep pass.** Nothing used to call
  `life.sleep()` on a schedule, so `consolidateOnSleep` never had a chance to run
  (`sleep-runs` had been stuck at 11-12). When `features.autoSleep` is on and the
  host is idle, the scheduler sleeps if no sleep exists or the last one is ≥20h
  old; the profile patch enables it.

### Changed
- `features.autoSleep` added to the config schema and the override keys, so it can
  be toggled from `feature-overrides.json` without a rebuild.

### Verified
- `scheduler-autosleep.test.js` (4 cases): never slept → sleeps; 3h ago → does not;
  21h ago → sleeps; flag off → never calls. Suite: 429/429, twice.


## 0.4.98 — 2026-11-16

### Fixed
- **`no-llm` was two different failures under one label.** A missing adapter and an
  adapter that answered nothing both recorded `no-llm`, so the unexpected rows gave no
  clue which one to fix. They are now `no-llm-adapter` and `llm-empty`, and
  `health` warns `LLM_EMPTY` when ≥5 empty answers pile up within 6 hours.

### Found while investigating (not fixed here)
- **Nothing calls `life.sleep()` on a schedule.** `sleep-runs` stops at 11-12
  because `sleep` only runs through the tool/API; `consolidateOnSleep` therefore
  never fires. The next version should add an `autoSleep` scheduler hook (idle +
  ≥20h since last sleep) rather than pretending the flag alone is enough.

### Verified
- `consolidate-errors.test.js`: no adapter → `no-llm-adapter`, empty answer →
  `llm-empty`, six empties → `LLM_EMPTY` warning. Suite: 425/425, twice.


## 0.4.97 — 2026-11-15

### Fixed
- **Why consolidation never ran: the LLM feature was off.** The live profile had
  `features.llm` unset, so the adapter was `null` and every consolidation tick
  recorded `no-llm` (hundreds of rows in `dream_runs`); the same flag gates sleep
  consolidation. The profile patch now sets `features.llm: true` and
  `consolidateOnSleep: true` (backup: `cordis.patch.yml.bak-noisefix-*`), and
  `health` raises `LLM_DISABLED` when the flag is off so this can never be silent
  again.
- **Facts polluted by sentence fragments.** The rule extractor now filters
  single-character function words (`的了着过等儿…`) and a `NOISE_OBJECTS` list
  (`等`, `收一收`, `水里`, …). `repair --drop-noise-facts` (opt-in) archives the
  existing garbage through the backup gate: 255 candidates live, 255 invalidated on
  a copy (`828 → 650` active).

### Verified
- `fact-noise-llm.test.js`: fragment text yields zero facts, a normal sentence
  still yields `likes`, and `LLM_DISABLED` appears only when the feature is off.
  Suite: 422/422, twice.


## 0.4.96 — 2026-11-15

### Fixed
- **`SLOW_MAINTAIN` no longer becomes permanent.** A slow pass row used to linger
  until the next *changed* pass overwrote it, which read as "currently stalling"
  forever. Only passes within `maintainSlowWindowHours` (default 6) count now, and
  the message carries `距现在 N 分钟` so the age is visible.
- **Timestamp comparison uses `Date.parse`, not string order.** An injected
  `2026-11-15 14:36:00` sorted before `2026-11-15T14:36:00Z` purely because of the
  space, so the same instant looked older; unparsable values now fall back to the
  in-memory pass.
- **The summon book could drop its own left card.** When the slots were full the
  left (emotional) card was pushed and then sliced off — the block looked frozen.
  It now displaces a chosen card whose removal keeps day diversity (its day is
  duplicated, or equals the left card's day); the displaced card is reported via
  `onDrop` → `summon.drop` metric. If no such card exists the left card is skipped
  rather than sacrificing the day spread.

### Verified
- `maintain-duration.test.js` (10 cases): an 8h-old slow pass raises nothing; a
  space-formatted timestamp equal to the in-memory one is treated as the same pass.
- `summon-left-slot.test.js`: full slots → left card present, displaced card
  reported and absent from the result; free slot → no drop.
  Suite: 418/418, twice.


## 0.4.95 — 2026-11-15

### Changed
- **A slow pass now leaves durable evidence.** Quiet passes write no audit row, so
  a stall that happened between two heartbeats had nothing to read later. A pass
  slower than `maintainSlowMs` (default 2000) now writes its `maintain.run` row even
  when it changed nothing; changed passes behave exactly as before.

### Why
- A production store still holds only the 08:24:56Z row (9 keys, no `ms`): no passing
  `maintain` has actually changed anything since 0.4.89, and the "过期意图 1 条" in
  the 0.4.93 install was `repair`, not `maintain`. Without this change the first
  real timing sample could stay missing for days.

### Verified
- `maintain-duration.test.js` (8 cases): with `maintainSlowMs: 0` a no-change pass
  still writes an audit row carrying `ms`. Suite: 414/414, twice.


## 0.4.94 — 2026-11-15

### Fixed
- **A slow pass was hidden by the next quiet one.** `SLOW_MAINTAIN` only judged the
  newest pass, but `maintain()` runs on the heartbeat, so a stall is followed by a
  fast pass within minutes and the warning effectively never fired — defeating the
  whole point of adding it in 0.4.86. It now evaluates the newest pass *and* the
  last pass that changed anything, warns on the slowest, and reports that pass's
  timestamp alongside its duration. (Found by review against a production store.)

### Verified
- `maintain-duration.test.js` (7 cases): a fake 8500ms audit row followed by a fast
  quiet pass still raises `SLOW_MAINTAIN` with `ms: 8500` and a timestamp.
  Suite: 413/413, twice.


## 0.4.93 — 2026-11-15

### Fixed
- **"最近一趟维护" could point at the older run.** The line was chosen by
  "does it have `ms`", so after a change pass followed by a quiet one the audit row
  won and the genuinely newest (quiet) pass never appeared; the second line then
  repeated the first one. Selection is now by recency (`recorded.passAt` vs
  `memory.at`), and the second line only prints when the audit row is strictly
  older.
- Maintenance timestamps in `cortex_health` now include seconds (`slice(0, 19)`);
  two different passes in the same minute used to render identically.

### Verified
- `maintain-duration.test.js` (6 cases, new one included): change pass then quiet
  pass → first line is the quiet pass, `maintainLastChanged` is the change pass,
  the two are not the same source. Suite: 412/412, twice.


## 0.4.92 — 2026-11-15

### Fixed
- **The maintenance readout was invisible in the tool that matters.**
  `cortex_health`'s text formatter printed a fixed line and ignored `report.ok`,
  so the 0.4.91 two-line detail (and the duration) never reached the caller. It
  now renders `维护：最近一趟 <time>（意图 x · 工作记忆 y · Nms）` and, when the
  newest audit row belongs to a different pass, `最近一次有变更：<time>（…）`.

### Verified
- `health-text-maintain.test.js`: a 6h-old row + a quiet pass → the rendered text
  contains both the duration and the separate "最近一次有变更" line.
  Suite: 411/411, twice.


## 0.4.91 — 2026-11-15

### Changed
- **`health` says both things about maintenance.** It reports `最近一趟维护`
  (the in-memory last pass, including its duration) and, when the newest audit row
  comes from a different pass, `最近一次有变更的维护` with that row's counts. A
  quiet heartbeat writes no row, so one stale timestamp used to read as "nothing
  has run for hours".
- `health` exposes `maintainLastChanged` (that audit row) for tooling, and
  `maintainReport()` carries `passAt` from `detail.at` so the comparison uses the
  pass's own timestamp rather than the row's write time. (Review suggestion.)

### Verified
- `maintain-duration.test.js` (5 cases): a 6-hour-old row with `working: 7` plus a
  quiet pass → both lines appear and `maintainLastChanged.working` is 7.
  Suite: 410/410, twice.


## 0.4.90 — 2026-11-15

### Fixed
- **No more mixed maintenance numbers during the upgrade window.** When the audit
  row predated `ms`, `health` kept that row's counts and borrowed the latest
  pass's duration — a combination no single run produced. `lastMaintain` is now a
  full report snapshot and `health` falls back to it wholesale (counts and duration
  from the same pass). (Review finding.)

### Note
- The displayed "上次维护" time still comes from the audit row's write time rather
  than `detail.at`; within one tick they are equal, across ticks it is a few ms
  early. Cosmetic, left as is.

### Verified
- `maintain-duration.test.js` (4 cases): an old 9-key row with `working: 7` plus a
  fresh pass → `health.maintain.working` equals the new pass, not 7, and `ms` is
  finite. Suite: 409/409, twice.


## 0.4.89 — 2026-11-15

### Fixed
- **`SLOW_MAINTAIN` could not fire on the passes that mattered.** The audit row was
  written *before* `report.ms` was computed, so every real pass stored a detail
  without `ms`; `health` then preferred that row and fell back to memory only when
  no row existed — i.e. the warning worked on idle passes and failed exactly when
  maintenance did real work. Timing is now computed before the audit write, and
  `health` merges `ms` from the in-memory pass when the row lacks it.
  (Found by review against a production store: the single `maintain.run` row had keys
  `aliases/at/disputes/errors/goalRounds/intentions/playbook/summaries/working`
  and no `ms`.)
- `maintainSlowMs` is config (default 2000) instead of a hardcoded threshold.

### Verified
- `maintain-duration.test.js` (3 cases): idle pass reports `ms`; a pass that
  actually changes something writes `ms` into the audit detail and health reads it;
  a 50ms row with `maintainSlowMs: 5` raises `SLOW_MAINTAIN`. Suite: 408/408, twice.


## 0.4.88 — 2026-11-15

### Added
- **`maintain()` measures itself.** The pass returns `report.ms`, keeps an
  in-memory `lastMaintain`, records a `maintain.ms` metric, and the audit detail
  now carries the duration. `health` exposes `maintain.ms` and raises
  `SLOW_MAINTAIN` above 2s — the 0.4.86 O(n²) regression would have shown up here
  instead of as a frozen host.
- `health` falls back to the in-memory last pass when `maintain()` changed
  nothing (and therefore wrote no audit row).

### Verified
- `maintain-duration.test.js`: a no-op pass still reports `ms` and health reads
  the same number; a synthetic 8500ms audit row raises `SLOW_MAINTAIN`.
  Suite: 407/407, twice.


## 0.4.87 — 2026-11-15

### Fixed
- **The dedupe pass was O(n²) inside a synchronous `maintain()`.** 0.4.86 compared
  every pair to build the unique list: 148 traces → 10,878 jaccard calls ≈ 908ms,
  and the 500-trace cap would be ≈10s, freezing the host. The near-duplicate
  filter now runs only over the head of the ranked list (3× the budget); the tail
  is sampled by position, where duplicates are rare. Cost is (3×budget)²
  comparisons regardless of window size.
- **Tail sampling was unreachable.** `rest[0] + k·floor(rest/remaining)` only
  reached ~83% of the list. Picks are now bucket-centred:
  `floor((slot + 0.5) * rest.length / remaining)`.

### Verified
- `reflect-sampling.test.js`: cold topics take most of the remaining slots
  (10 hot + 50 cold → 9 hot + 6 cold); the last-quarter traces (23–29) are
  reached; 500 candidates finish under 3s with ≤24 sources. Suite: 405/405, twice.

### Note
- Coverage dropping ~0.005 versus pure top-k is the intended cost of stratifying;
  it is not a regression and not a red line.


## 0.4.86 — 2026-11-15

### Changed
- **Sampling is stratified instead of pure top-k.** 60% of the source budget is
  filled by score, then the remaining slots are taken from the rest of the ranked
  list with a stride, so one loud strand of the day cannot occupy every slot.
  (Suggested by review after measuring a production store: max pairwise jaccard is 0.37,
  so the near-duplicate filter is a no-op there and the only real levers left are
  the caps and the sampling strategy.)
- The composed `一句话` line now uses the first two **distinct** bullets (two
  traces can share a title, and `X；X` is not a summary).

### Note
- A first attempt keyed samples by a `topicSignature()` of the rarest tokens; it
  failed because synthetic `alpha1/alpha2` texts produced different signatures, so
  the cap did nothing. Replaced with the position-based stride, which does not
  depend on topic detection at all; `topicSignature` was removed rather than left
  as dead code.

### Verified
- `reflect-sampling.test.js`: 30 hot + 30 cold traces → the summary contains both
  (hot majority, cold non-empty). Suite: 403/403, twice.


## 0.4.85 — 2026-11-15

### Fixed
- **The `一句话` line was dead code.** `gistOf()` returns one of the bullets
  verbatim, so `!bullets.includes(gist)` could never be true: the line never
  rendered and the O(n²) similarity pass was wasted. It is now composed from the
  two most central bullets (joined with `；`, truncated to 90 chars) and omitted
  when there are fewer than three bullets; `gistOf()` is gone.
- **The phrasing test now defends the real defect.** It asserted only that `· `
  lines were unique, which the `一句话：X` + `· X` shape passes. It now asserts
  each bullet appears exactly once in the content and that any `一句话` line
  differs from every bullet, plus a case with ≥3 distinct bullets that actually
  exercises the composed line.
- Reflect config numbers are validated (`Number.isFinite` fallback): a typo used
  to become `NaN`, silently turning the dense-day follow-up off.

### Verified
- Suite: 402/402, twice.


## 0.4.84 — 2026-11-15

### Changed
- **Segments sample more of their window.** The source budget is now
  `sourceBudgetFor(n, { segment })`: 25% of the window capped at 24 for a segment,
  12% capped at 16 for a whole-day window (floor 8 in both). Segments are short by
  construction, so the old flat 12% summarized a 40-trace segment from 8 rows and
  left coverage near 20% no matter how the phrasing improved.
- The budget moved into an exported pure function, so it is unit-tested directly
  instead of being buried in the selection loop. It is a ceiling, not a quota: the
  near-duplicate filter (jaccard > 0.7) can still select fewer.

### Verified
- `reflect-source-budget.test.js`: 10/40/100/200/500 → whole-day 8/8/12/16/16,
  segment 8/10/24/24/24; explicit `maxSources` overrides both.
  Suite: 401/401, twice.


## 0.4.83 — 2026-11-15

### Changed
- **Episode summaries speak in the first person.** `这段时间里，记住了：` +
  `- bullet` became `这一段里，我记下了：` + `· bullet`, and the `一句话：` gist
  line is dropped when it duplicates a bullet verbatim. This is phrasing only:
  the coverage maths is untouched, and a test recomputes the stored coverage from
  the stored source ids to prove it.
- The dense-day follow-up thresholds moved into config:
  `reflectFollowUpMin` (default 150) and `reflectFollowUpGapHours` (default 6).
  (Review finding.)

### Verified
- `reflect-phrasing.test.js`: first-person heading, `·` bullets with no
  duplicates, and `coverage == importance-weighted formula`. Suite: 399/399,
  twice.


## 0.4.82 — 2026-11-15

### Changed
- **Episodes are segmented, not overlapping.** The auto-reflection window now
  starts at `max(now − 24h, previous episode's periodEnd + 1ms)`, so two
  consecutive episodes cover different stretches of time. Segment summaries are
  marked `extractive-v2-segment` (still `-v2`, so coverage-rewrite skips them).
  A dense day may get a second episode, but only as a separate segment: ≥150 new
  traces since the last episode **and** ≥6h since it was written; otherwise the
  pass reports `skipped: 'covered'`.
- `reflect({ since, segment })`: explicit window start, default behaviour
  unchanged.
- Extracted `isPerm()` in the tier code — the 0.8 threshold was duplicated three
  times (review finding).

### Verified
- `auto-reflect.test.js`: 60 traces → episode 1; +7h with 160 new traces →
  second episode whose `periodStart` is **after** the first `periodEnd`, marked
  `extractive-v2-segment`; with only 60 new traces it stays `covered`.
  Suite: 398/398, twice.


## 0.4.81 — 2026-11-15

### Fixed
- **A perm-heavy recall no longer empties the hot tier.** The cold cut counted
  *all* candidates, so 8 candidates with 6 of them at importance ≥ 0.8 produced 2
  cold rows and 0 hot ones. The cut now ranks inside the non-perm pool only
  (`relativeTotal = candidates − permCount`), and still requires ≥ 4 non-perm
  candidates before splitting. (Review finding.)

### Verified
- `tiers-gist.test.js`: 6 perm + 2 mid → 0 cold, 2 hot; 2 perm + 6 mid → 2 cold,
  4 hot. Suite: 396/396, twice.


## 0.4.80 — 2026-11-15

### Changed
- **Auto-reflection cadence follows the material, not the clock.** The fixed 6
  hour gate is gone (it was redundant with the 24h `covered` check — a summary
  written 5h ago already means the window is covered), and the minimum material
  is now 50 non-reflection traces (config `reflectMinMaterial`). A quiet day no
  longer gets an episode for showing up; a busy day is no longer delayed 6 hours
  before it can be summarized. `skipped: 'few-traces'` reports both `count` and
  `minMaterial` so the reason is visible.

### Verified
- `auto-reflect.test.js`: 60 traces → one episode then `covered`; 40 traces →
  `few-traces` with `minMaterial: 50`; 60 traces spread across 24h → still
  `covered` 7h later; next day writes a second; 3 traces → nothing.
  Suite: 394/394, twice.


## 0.4.79 — 2026-11-15

### Fixed
- **Cold-tier count was cut short by rounding.** `ceil(total * 0.75)` rounded the
  *cut* up, so common recall sizes under-filled the tier: 5 candidates → 1 cold
  (20%), 7 → 1 (14%), 10 → 2 (20%). It now counts first —
  `max(1, ceil(total * 0.25))` — and slides the cut: 4→1, 5→2, 6→2, 7→2, 8→2,
  10→3, 20→5.
- **Stable tier assignment.** Equal `utility` now breaks ties by importance and
  then id, so the same candidate set cannot shuffle between cold and hot on
  consecutive turns.

### Verified
- `tiers-gist.test.js`: the 4/5/6/7/8/10/20 → 1/2/2/2/2/3/5 table, plus a
  reversed-input determinism test. Suite: 394/394, twice.


## 0.4.78 — 2026-11-15

### Fixed
- **The cold tier was unreachable on real data.** It required importance < 0.4,
  but every live trace sits in 0.6–1.0 (measured: 0.6×5, 0.7×307, 0.8×184,
  0.9×76, 1.0×211), so the tier was decorative. `tierOf` now also sends the
  lowest quarter of the current turn's candidates to `cold` (relative cut, at
  least 4 candidates), while keeping the absolute cutoff for genuinely small
  importance values. Fewer than 4 candidates means no relative split, so a tiny
  recall never gets pushed into index-only. (Reported during review.)

### Verified
- `tiers-gist.test.js` adds: 8 candidates all at 0.6 → the last 2 land in cold
  with `字面命中` and 6 stay hot; 3 candidates → 0 cold. Suite: 392/392, twice.


## 0.4.77 — 2026-11-15

### Added
- **Health reports the narrative layer.** `health` now exposes
  `summaryLayers { episode, merge, thread, lastEpisodeAt }`, the `cortex_health`
  text shows `摘要：每日 N 条（最近 …）· 合并记录 M · 线 K`, and a store with
  ≥100 active traces but zero episode summaries gets a `NO_EPISODE_SUMMARIES`
  warning — a thin narrative layer is now visible instead of silent.

### Verified
- `test/unit/health-summaries.test.js`: empty store reports 0, after inserting an
  episode + merge row it reports 1/1 with a timestamp. Suite: 390/390, twice.


## 0.4.76 — 2026-11-15

### Changed
- **Low-importance memories are index-only even when they were relevant hits.**
  `tierOf` used to promote any fts/vector/graph hit to `hot`, so the cold tier
  could never actually show its reason line (`语义相近` / `字面命中` /
  `共享实体` were unreachable branches). Now anything below 0.4 importance goes
  to `cold`, where the reason tells the reader whether fetching is worth it and
  the 120-char gist does not eat hot budget. Mid-importance hits stay hot.
  (Review finding.)

### Verified
- `tiers-gist.test.js` adds: importance 0.2 + vector → cold with `语义相近` and
  nothing in hot; importance 0.55 + vector → hot. Suite: 389/389, twice.


## 0.4.75 — 2026-11-15

### Changed
- **Cold-tier lines say why a memory might be worth fetching.** `[cold] id ·
  title（正文按需取回）` was a table of contents; it now reads
  `（语义相近 / 字面命中 / 共享实体 / 命中 <source>，正文按需 cortex_get）`,
  derived from the match source. A timestamp ("last read 3 days ago") gives no
  basis for deciding, the reason does.

### Fixed
- An empty gist (body identical to its title) no longer renders a dangling
  `- [L2] 标题：`.
- `CHANGELOG.md` for 0.4.74 was written after packing, so it is missing from the
  0.4.74 tarball; this entry and the 0.4.74 one are both present from here on
  (changelog is written before `pnpm pack`).

### Verified
- `tiers-gist.test.js` (6 cases: gist truncation, short snippet passthrough,
  title de-duplication, exact-equal body, cold reason, cold index-only).
  Suite: 387/387, twice.


## 0.4.74 — 2026-11-15

### Fixed
- **Recall lines no longer repeat the title.** Titles are usually the first line
  of the body, so `- 标题：要点` printed the same words twice
  (`2026-11-15 17:35：0.4.60 打包…：2026-11-15 17:35：0.4.60 打包…`). The gist now
  strips a leading title before choosing its sentence, and any remaining long
  shared prefix is removed at render time.

### Verified
- `tiers-gist.test.js`: a snippet that opens with its own title renders the title
  once and keeps the following sentence. Suite: 385/385, twice.


## 0.4.73 — 2026-11-15

### Fixed
- **`repair` keeps stdout machine-readable.** The readable report added in 0.4.71
  went to stdout, so any consumer doing `node repair.mjs | ConvertFrom-Json`
  broke (`handoff/rehearsal.ps1` did exactly that and the whole drill went red).
  The human block now goes to stderr; stdout is exactly one JSON document.
- `rehearsal.ps1`: captures node stdout only (`2>$null`), tolerates native
  stderr (`ErrorActionPreference = Continue`), and trims `verify` output to its
  JSON object before parsing.
- `ready.ps1` gains `-SkipRehearsalCheck`; `rehearsal.ps1` passes it. Without
  this a single failed drill poisoned the readiness gate that the drill itself
  runs first — a deadlock.

### Verified
- `node repair.mjs --dry-run | ConvertFrom-Json` parses; `rehearsal.ps1` now ends
  `REHEARSAL OK` 5/5 on the live copy (active 773, goalRounds 0, legacy gone).


## 0.4.72 — 2026-11-15

### Added
- **`repair --dedupe-episodes` (opt-in).** Merges episode summaries whose periods
  overlap by ≥90% *and* whose content is ≥0.8 jaccard: keeps the newest, deletes
  the rest, and records a `level='merge'` summary with the union of source ids so
  provenance survives. Dry runs report the clusters. Conservative on purpose.
- The human-readable report now prints the dedupe line.

### Measured on a production store
- Pairwise episode similarity is 0.388 / 0.594 / 0.708 with overlap 0.553 / 0.627
  / 0.927 — the three old summaries share their **opening sentence** but not
  their bodies, so nothing is a true duplicate: `clusters: 0`. They stay; only
  future duplicates are prevented (0.4.67).

### Verified
- `dedupe-episodes.test.js`: same window + identical content → one cluster keeping
  the newer row, source ids unioned; a different window is untouched. Suite:
  384/384, twice.


## 0.4.71 — 2026-11-15

### Added
- **`repair` prints a human-readable report after the JSON.** The JSON stays
  stable for scripts; the trailing block answers "what actually changed" for a
  person: goal-round/injected archives, title backfill, duplicate summaries,
  intentions, playbook, disputes, alias merges, the coverage-rewrite sample
  (`id: from → to (covered/window)`) and the backup path.

### Verified
- Dry run against a live-store copy prints the block with the right numbers.
  Suite: 383/383, twice.


## 0.4.70 — 2026-11-15

### Added
- **`repair --rewrite-coverage` (opt-in).** Brings pre-v2 episode summaries onto
  the importance-weighted coverage definition: for each v1 episode it recomputes
  `covered / total` from the summary's own `source_ids` and the traces inside its
  period, then (with `--apply`) writes the value and marks the row
  `extractive-v2-recomputed`. Dry runs report `candidates / changed / sample`
  without touching a row. Deliberately *not* part of `maintain()`: this is a data
  change and runs only through the repair backup gate. (Requested during review.)

### Verified
- `coverage-rewrite.test.js`: 2 important + 2 trivial traces, v1 summary covering
  the important pair → recomputed coverage 0.9; v2 rows are left alone. Live copy:
  4 candidates → 4 applied, all rows re-marked. Suite: 383/383, twice.


## 0.4.69 — 2026-11-15

### Fixed
- **`reflectOverview` no longer averages two different meanings of `coverage`.**
  v1 summaries stored a count share (~0.03–0.05) and v2 stores an importance
  share (0.5–0.9), so an average over both reported a number that meant
  neither. It now averages v2 rows only and reports `legacy` (v1 count)
  separately.

### Verified
- `reflect-overview.test.js`: one v1 (0.04) + one v2 (0.8) → `coverage` 0.8,
  `legacy` 1. Suite: 382/382, twice.


## 0.4.68 — 2026-11-15

### Fixed
- **The auto-reflection dedupe used a condition that could never be true on real
  data.** `period_start` is the *earliest* trace in the window, so on a full day
  it sits ~24h before the run; comparing it against `now - 24h` only matched at
  the instant of writing. The anchor is now the summary's own `createdAt` (with
  `periodEnd` as fallback), so "one episode per 24h window" actually holds.
  (Review finding; the previous test passed only because its traces
  were all clustered at T0.)

### Verified
- `auto-reflect.test.js` now includes a realistic shape: traces spread over the
  full 24 hours, then a pass 7 hours later must be `skipped: 'covered'`; and a
  next-day pass with fresh material writes again. Suite: 381/381, twice.


## 0.4.67 — 2026-11-15

### Fixed
- **Auto-reflection no longer re-summarizes the same day.** The candidate window
  is always "the last 24 hours", so the 6-hour gate alone would have written
  roughly four overlapping episode summaries a day (the stored history already
  had near-duplicate rows). `maybeAutoReflect` now also skips when an existing
  episode summary starts inside that window (`skipped: 'covered'`). (Review
  finding.)

### Verified
- `auto-reflect.test.js` gains "same window, 7 hours later → covered";
  suite: 379/379, twice.


## 0.4.66 — 2026-11-15

### Changed
- **Episode summaries record which `coverage` semantics they use.** The column
  changed from "share of traces sampled" to "share of importance sampled", so
  old rows are not comparable with new ones; new summaries now carry
  `model: 'extractive-v2-weighted'` instead of a schema migration. (Review
  finding P2.)

### Verified
- `reflect-coverage.test.js` asserts the marker is set. Suite: 378/378, twice.


## 0.4.65 — 2026-11-15

### Added
- **Maintenance now keeps the narrative layer alive.** Reflections piled up
  (106) while episode summaries stayed at a handful, so long-term memory had no
  short version of itself. `maintain()` now writes one episode summary when the
  last one is older than 6 hours and the day has at least 10 non-reflection
  traces; it reports `reflection: {created|skipped}` in the maintain report.

### Verified
- `test/unit/auto-reflect.test.js` (2 cases: enough material → one summary then
  `recent` for 6h; too few traces → `few-traces`). Suite: 378/378, twice.


## 0.4.64 — 2026-11-15

### Fixed
- **The revive budget counted the wrong window.** `reviveBudget()` used
  `audit.list({ targetType: 'trace', limit: 200 })`, and without a target id that
  returns the newest 200 audit rows *overall* — with hundreds of `dream.run`
  rows a day, "24 hours" really meant about five hours. It now runs
  `SELECT COUNT(*) FROM audit WHERE action='trace.revive' AND at >= ?`, so the
  cap is the full day as intended. (Review finding.)

### Verified
- `test/unit/revive-on-read.test.js` gains a regression case: 3 revives, then
  260 unrelated audit rows, then the 4th revive must stay blocked. Suite:
  376/376, twice.


## 0.4.63 — 2026-11-15

### Changed
- **Revive-on-read has a daily budget.** Reading an archived memory still
  brings it back, but at most 3 revives per 24 hours (counted from the audit
  log); after that reads are read-only, so "archive" cannot be silently undone
  by a busy retrieval loop.

### Verified
- `test/unit/revive-on-read.test.js` (3 cases: explicit read revives, only three
  per day, merged traces stay archived). Suite: 375/375, twice.


## 0.4.62 — 2026-11-15

### Changed
- **Reflection coverage is importance-weighted, and it samples more on busy
  days.** A fixed `maxSources = 8` meant a 160-trace day was reflected from 5%
  of it; the source count now scales gently (`max(8, min(16, 12% of window))`)
  and `coverage` reports the share of total importance seen, with
  `countCoverage` kept for debugging. A day with three big events and many
  trivial ones now reads as well covered instead of "5%".

### Verified
- `test/unit/reflect-coverage.test.js`: 3 important + 17 trivial traces →
  weighted coverage ≥ 0.5 while count coverage stays low, and ≥ 8 sources are
  sampled. Suite: 374/374, twice.


## 0.4.61 — 2026-11-15

### Added
- **Reading an archived memory can bring it back.** `cortex_get` now revives the
  trace it displays (unless it was folded into another trace by a merge), so a
  memory that keeps getting looked up does not stay buried. Other callers keep
  the old behaviour unless they pass `{ revive: true }`.

### Verified
- `test/unit/revive-on-read.test.js` (2 cases: revive on explicit read, merged
  traces stay archived). Suite: 373/373, twice.


## 0.4.60 — 2026-11-15

### Fixed
- **`repair` silently skipped scheduler-reminder traces.** The cleanup pattern
  used `GLOB '用户：[SCHEDULE REMINDER*'`, and in GLOB `[...]` is a character
  class, so it never matched the literal `[`. Those rows stayed active and kept
  showing up in recall even though the capture filter was correct. The reminder
  and goal-complete patterns now use `LIKE`; 3 stale rows were archived on the
  production store (backed up first).


## 0.4.59 — 2026-11-15

### Changed
- **Consolidation stops recording identical skipped runs.** Without an LLM the
  engine wrote a `skipped / no-llm` row into `dream_runs` on every scheduler
  tick (every couple of minutes), filling the log with the same digest. It now
  reuses the previous run when the candidate digest has not changed; `force: true`
  still records.

### Verified
- `test/unit/consolidate-gate.test.js`: first run records, second is
  `skipped: unchanged`, `force` records again. Suite: 371/371, twice.


## 0.4.58 — 2026-11-15

### Fixed
- **Assistant-side captures no longer get the title "会话 N".** Turns whose user
  part was pure injected context were titled only by the turn number; the title
  now falls back to the assistant line (with the persona name stripped). On the
  production store `repair.mjs` derived titles for 15 of 16 such traces.

### Verified
- `capture-filter.test.js`: persona-prefixed title derived; `会话 N` only when
  there is nothing else. Suite: 370/370, twice.


## 0.4.57 — 2026-11-15

### Fixed
- **Scheduler reminders and goal-complete blocks were stored as user messages.**
  `[SCHEDULE REMINDER BATCH] … reminders_json: …` and `<goal_complete>` are
  harness automation, but they were captured like speech and then resurfaced in
  every recall block. They are now dropped at capture (`stripInjected` /
  `isInjectedNoise`), and `repair.mjs` archives the copies already stored
  (4 rows on a production store, backed up first).

### Verified
- `capture-filter.test.js` covers both shapes. Suite: 369/369, twice.


## 0.4.56 — 2026-11-15

### Changed
- **Relationship trust/care move asymmetrically.** A good interaction adds a
  fraction of the remaining room (the hundredth kindness weighs less than the
  first), while a disappointment takes a bigger bite (loss weight 1.6×), so the
  numbers can actually move instead of sitting at a clamped 65/65.
- Familiarity is now grow-only and saturating: it counts shared time, so no
  delta can reduce it.

### Verified
- `test/unit/relationship-dynamics.test.js` (4 cases: diminishing gains, losses
  weigh more, bounds hold, familiarity never decreases). Suite: 368/368, twice.


## 0.4.55 — 2026-11-15

### Changed
- **Mood updates saturate.** Each appraisal now moves valence/arousal a fraction
  of the remaining distance to the bound instead of adding a flat amount, so
  repeated good (or bad) news approaches the limit without parking there and the
  tenth event matters less than the first. Energy still drains with arousal.

### Verified
- `test/unit/mood-saturation.test.js` (4 cases: smaller push near the bound,
  repeated pushes stay below the ceiling, one negative event cannot slam the
  floor, arousal stays inside 0..1). Suite: 364/364, twice.


## 0.4.54 — 2026-11-15

### Fixed
- **Vector coverage can no longer exceed 100%.** `health` and `verify` counted
  every embedding row, including ones belonging to archived traces, so a
  fully-indexed store reported e.g. `1.056`. They now count only embeddings whose
  trace is active (`health` also scopes by `scope_id`).

### Verified
- `test/unit/vector-coverage.test.js`: one active + one archived trace with
  embeddings → `embedded: 1`, coverage ≤ 1. Suite: 360/360, twice.


## 0.4.53 — 2026-11-15

### Changed
- **Summon cards are ranked by freshness and diversity, not just keyword
  score.** Scoring now adds a recency term and importance; selection prefers one
  card per day and one per category (falling back only when nothing else is
  left), and still guarantees a left/emotional card when one exists. Before, one
  busy day could fill the whole block with near-duplicates.
- The ranking lives in `src/engines/summon-rank.js` as a pure function, so it is
  testable without a database.

### Fixed
- Gist rendering no longer silently hard-truncates the raw text when the first
  sentence is shorter than 24 chars: it takes the next sentence too (review
  review, 0.4.50 交接备注).

### Verified
- `summon-rank.test.js` (4 cases) + `tiers-gist.test.js` (3 cases). Suite:
  359/359, twice.


## 0.4.51 — 2026-11-15

### Fixed
- **Runtime boilerplate leaked into memory.** The harness line
  `Elapsed since the preceding step context: …` was captured as a user message
  and came back in every recall block. `stripInjected` / `isInjectedNoise` now
  match any `Time sampled…` or `Elapsed since the preceding…` head, and
  `repair.mjs` archives the copies that are already stored.

### Verified
- `capture-filter.test.js`: the new head is stripped and flagged; discussing the
  marker in normal text is still safe. Suite: 355/355, twice.


## 0.4.50 — 2026-11-15

### Changed
- **Recall injects a gist instead of the whole snippet.** The permanent and hot
  tiers now render one sentence (default 120 chars, `selectTiers({ gistChars })`
  to change) and leave the body to `cortex_get`; before, each entry carried up to
  220 chars of engineering detail on every turn. Short snippets pass through
  unchanged, cold entries stay index-only.

### Verified
- `test/unit/tiers-gist.test.js` (3 cases: long → gist + ellipsis, short →
  untouched, cold → index only). Suite: 354/354, twice.


## 0.4.49 — 2026-11-15

### Changed
- **`verify` tells "still climbing" apart from "stuck".** Low embedding coverage
  is now judged after the baseline comparison: with `--expect` and a positive
  delta it is printed as a note and the report stays `HEALTHY`; with a delta of
  zero or less it stays in `NEEDS ATTENTION` with the hint to check the vector
  feature and Ollama; without a baseline it says movement is unknown and
  suggests saving one.

### Verified
- Copy store: no baseline → note + `HEALTHY`; same snapshot → `NEEDS ATTENTION`
  ("not climbing (0 vs baseline)"). Suite: 351/351.


## 0.4.48 — 2026-11-15

### Changed
- **Vector backfill is ~15× faster.** One drain pass now gets 45 s instead of
  20 s, and while the queue still has a backlog the maintenance pass repeats
  every 2 minutes instead of every 10 (it falls back to 10 automatically once
  the queue is empty). Measured single-thread throughput: ~1.03 embeddings/s,
  so ~550 missing traces go from roughly 4.5 hours to about 25 minutes.
- `scheduler.status()` now reports `maintenanceGapMs` so the cadence is
  observable.

### Verified
- `test/unit/scheduler-cadence.test.js` (2 cases: backlog → 120 s, empty → 600 s
  and the immediate second pass is gated). Suite: 351/351, twice.


## 0.4.47 — 2026-11-15

### Fixed
- **Vector backfill never stored a single embedding.** The remote embedder
  returns a `Float32Array`, and `drainQueue` validated it with `Array.isArray`,
  so every item failed with "embedding dimension mismatch" and was retried
  forever — coverage stayed at 22% no matter how long it ran.
- A single retryable failure no longer aborts the whole drain pass: it is
  logged (`debug`/`info`) and the loop continues with the next item.
- The vector engine now reads the settings-panel override through
  `effectiveFeatures()`, which resolves the default data root on its own
  (`config.dataRoot` is normally undefined at runtime).

### Verified
- Live-store copy, source modules: `drain { ok: 3, failed: 0, pending: 0 }`
  (before the fix: `ok: 0`, every item "dimension mismatch").
- `test/unit/vector-typed-array.test.js` (2 cases). Suite: 349/349, twice.


## 0.4.46 — 2026-11-15

### Added
- `repair.mjs` now backfills unreadable titles (`会话 N 的对话` and empty ones)
  from the first real line of the trace; reports `titles` (candidates) and
  `titleFixes` (actually written). Content too short to derive a title is left
  alone instead of being renamed into something meaningless.

### Fixed
- (released together with 0.4.45) the settings-panel `vector` override now
  really enables the vector engine, so the backfill queue runs.

### Rehearsed
- On a live-store copy: `titles: 2`, `titleFixes: 1`; the one left was a trace
  whose whole content is "用户：？".


## 0.4.45 — 2026-11-15

### Fixed
- **The settings-panel `vector` override now actually enables the vector
  engine.** The engine was created from `config.features.vector` only, while the
  status getter also consulted `feature-overrides.json` — so with `vector: true`
  in overrides the UI showed vector as on, but the index was `null` and the
  backfill queue never ran (coverage stuck at 22%). `vectorEnabled` now also
  reads the overrides file (`.current.vector`).
- Tests: `test/unit/vector-override.test.js` (2 cases). Suite: 347/347, twice.


## 0.4.44 — 2026-11-15

### Added
- `bin/copy-db.mjs`: consistent copy of a store via `VACUUM INTO`
  (`--source` / `--target`), prints the copy's active trace count. Read-only
  against the source; used by the delivery rehearsal.
- `handoff/rehearsal.ps1` (delivery drill): runs ready-check → install dry-run →
  copy live DB → repair the copy → verify the copy, and reports PASS/FAIL per
  stage. Full drill on the current store: 5/5 PASS —
  `active=817`, `goalRounds=121` archived, legacy goal-rounds gone, only the
  expected coverage item left.


## 0.4.43 — 2026-11-15

### Added
- **`verify.mjs` can compare against a baseline.** `--save <file>` writes the
  current snapshot; `--expect <file>` prints deltas (embedding coverage, active
  traces, legacy goal-round traces, capture stripped count) plus a one-line
  Chinese summary. An upgrade can now be judged by movement instead of a single
  snapshot.
- Verified on the repaired copy: baseline saved, second run reported
  `覆盖 +0 · active +0 · 旧 goal_round +0`.


## 0.4.42 — 2026-11-15

### Changed
- **`verify.mjs` explains the expected post-upgrade warning.** Low embedding
  coverage is still reported, but the message now says it is expected right
  after an upgrade and that backfill needs about an hour, so a reviewer does
  not read it as a broken install.
- Rehearsed end-to-end on a live-database copy: `repair --apply` archived 116
  legacy goal-round traces + 1 injected trace, after which `verify` reported
  only the expected coverage item.


## 0.4.41 — 2026-11-15

### Fixed
- **Same subject+predicate no longer means "conflict".** Two free-text literals
  like `一直存在着` and `一直在——记忆不丢` say compatible things, but the old
  rule marked both facts `disputed` and opened a dispute. Now, when both sides
  are literals and there is no *leading* negation flip (`会一直在` vs
  `不会一直在`), the new fact is stored as active and no dispute is opened.
  Entity-to-entity conflicts (`likes 米饭` vs `likes 米饭`) keep the old
  behaviour, because those really are alternatives.
- Tests: `test/unit/facts-compat.test.js`; suite 345/345, run twice.


## 0.4.40 — 2026-11-15

### Added
- **The last maintenance pass is visible.** `cortex_health` reports
  `maintain` (read from the latest `maintain.run` audit record): when it ran and
  how many disputes/summaries/intentions/rules/goal-rounds/aliases/working
  items it touched. The health line gains `维护：上次 …（意图 N · 工作记忆 M）`.
  A silent maintain is now distinguishable from one that never ran.
- Tests: 342/342, run twice; the working-memory TTL case asserts
  `health.maintain.working === 1`.


## 0.4.39 — 2026-11-15

### Added
- **Working memory gets a shelf life.** `maintain()` now deletes unpinned
  working items untouched for `workingTtlDays` (default 14); pinned items are
  never removed. The audit found items from 11-11 still sitting at priority 1
  long after their task had moved on. `report.working` counts what was dropped.
- Tests: 342/342, run twice; one case checks the old item is gone and the
  pinned one survives.


## 0.4.38 — 2026-11-15

### Changed
- **Recall bookkeeping follows a spacing curve.** `touchResults` no longer uses
  one fixed 5-minute throttle: the interval doubles per recorded recall
  (`touchInterval` in `src/memory/spacing.js`), capped by
  `touchMaxIntervalMs` (default 6 h) and configurable via
  `touchMinIntervalMs`. A hot memory is written less often; a cold one stays
  easy to pick up.
- Tests: `test/unit/spacing.test.js`; suite 341/341, run twice.


## 0.4.37 — 2026-11-15

### Added
- **Vector coverage is visible.** `cortex_health` reports `vectors`
  (`embedded`, `coverage`) and warns `VECTOR_COVERAGE` when coverage is under
  50% with 100+ active traces; the health line gains
  `向量：20%（157/793）`. `bin/verify.mjs` raises the same condition as a
  `NEEDS ATTENTION` item, so a lagging index cannot hide behind an otherwise
  green report.
- Tests: 340/340, run twice; live verify now reports both remaining issues
  (`legacyGoalRounds 110`, `coverage 0.198`).


## 0.4.36 — 2026-11-15

### Changed
- **Vector drain has a time budget.** `drainQueue`/`vectorMaintain` now accept
  `budgetMs` (default `vectorDrainBudgetMs: 20000`): a maintenance pass stops
  after 20 seconds and leaves the rest queued for the next heartbeat. Return
  values gain `elapsedMs` and `stoppedBy` (`done` / `time`) so the behaviour is
  visible instead of guessed. A first pass can finish a backlog without ever
  holding the heartbeat for minutes.
- Tests: 340/340, run twice; the vector-maintain assertion checks
  `stoppedBy === 'done'` and an elapsed time.


## 0.4.35 — 2026-11-15

### Changed
- **Vector backfill is no longer a trickle.** The heartbeat used to queue 40 and
  embed 20 per maintenance pass (~10 min), so a store with ~800 missing vectors
  needed hours. Defaults are now `vectorBackfillBatch: 200` and
  `vectorDrainBatch: 50`, both configurable. Embedding stays async and the pass
  is rare, so the cost is bounded; the same backlog now clears in well under an
  hour.
- Tests: 340/340, run twice; `vectorMaintain` is asserted to backfill+drain and
  land the expected embedding count in one pass.


## 0.4.34 — 2026-11-15

### Added
- `bin/verify.mjs`: read-only health snapshot for an installed store. Prints
  version, SQLite integrity, schema version, trace/fact/dispute counts, capture
  hygiene (total, stripped, per-day, ratio), inhibition marks, embedding
  coverage, and still-active legacy goal-round traces. Exit 1 with a
  `NEEDS ATTENTION` list when something is wrong.
- `handoff/verify.cmd`: double-click wrapper.
- Live run on the current store: `legacyGoalRounds: 107` → correctly flagged,
  capture ratio 0.004, embedding coverage 0.199.


## 0.4.33 — 2026-11-15

### Added
- `bin/repair.mjs`: one-shot, idempotent offline repair for an existing store.
  Dry-run by default; `--apply` takes a `VACUUM INTO` backup first. It archives
  goal-round traces (105 on a production store) and any remaining injected-context
  traces, collapses duplicate summaries, expires stale intentions, retires
  fragment playbook rules, closes both-invalidated disputes, and merges alias
  targets when `--user-address` is given. Supersedes `migrate-0.4.23.mjs`.
- Verified on a live-database copy: first `--apply` archived 105 + 1, second run
  reported 0 and 0 (idempotent), each with its own backup.


## 0.4.32 — 2026-11-15

### Added
- **Capture stats per day.** `cortex_health`'s `capture` now carries `days`
  (last 14): host turns, stripped and truncated counts per recorded day, so the
  upgrade can be judged directly — pollution ratio before vs after. The health
  line gains `按天：2026-11-15 12轮/剥9 · …`.
- Tests: 340/340, run twice.


## 0.4.31 — 2026-11-15

### Added
- **Capture hygiene is measurable.** `cortex_health` now reports `capture`:
  host turns stored, how many needed the injected-context stripper, and how many
  were truncated. This is the number that proves the 0.4.23 pollution fix is
  actually running. The human-readable health line gains
  `捕获：N 轮 · 剥掉 M · 截断 K`.
- Accepts both flat (`stripped: true`) and nested (`capture.stripped`)
  metadata shapes, so a writer change cannot silently report zero.
- Tests: 339/339, run twice.


## 0.4.30 — 2026-11-15

### Fixed
- **Auto-continuation rounds are no longer stored as user speech.** The goal
  round message repeats the objective every round; capture stored it verbatim,
  so recall started returning identical `<goal_round>` blocks. `stripInjected`
  now removes the `<goal_round>` block (and bare `Objective: "…" / Round: n/m`
  envelopes), and the encode guard rejects it as injected context. A turn that
  contains only the envelope is skipped; if the assistant replied, that reply
  is still stored.
- `maintain()` archives goal-round traces written by older versions
  (`report.goalRounds`), keeping the rows for inspection.
- Tests: 339/339, run twice.


## 0.4.29 — 2026-11-15

### Added
- **Manual control over suppression.** `cortex_inhibition` tool: `list` shows
  suppressed traces with their decayed strength, `clear` removes the mark from
  one trace (`id`) or all (`all: true`). Clearing writes an audit record.
  Service surface: `cortex.inhibition.list()` / `.clear()`.
- Tests: 336/336, run twice; the inhibition test now clears one, then all, and
  asserts the health count returns to zero.


## 0.4.28 — 2026-11-15

### Added
- **Inhibition is now measurable.** `cortex_health` reports `inhibition`:
  whether the experiment is on, how many active traces are suppressed right
  now, the decayed average, and the top three. Over 60 suppressed traces raises
  a `INHIBITION_HIGH` warning, so the experiment cannot quietly bury memory.
  The human-readable health line gains `抑制：N 条 · 均值 X`.
- Tests: 336/336, run twice; assert the count is 0 when the flag is off.


## 0.4.27 — 2026-11-15

### Added
- **Inhibition experiment (off by default).** `features.inhibition` enables a
  retrieval-induced-forgetting pass: after a recall, candidates that lost and
  are near-duplicates of something selected gain a small `inhibition` in their
  trace metadata (default step 0.15, cap 1). The penalty halves every
  `inhibitionHalfLifeDays` (14) and multiplies retrieval utility by at most
  `inhibitionStrength` (35%). Suppression is throttled to once per trace per
  24h and at most three per recall, so a busy loop cannot bury a memory.
- Config: `inhibitionStrength`, `inhibitionHalfLifeDays`, `inhibitionStep`,
  `inhibitionCompetitorSim`.
- Tests: `test/unit/inhibition.test.js` (3 cases). Suite: 336/336, twice,
  with and without the flag.


## 0.4.26 — 2026-11-15

### Fixed
- **One person, one target.** The audit found `用户` and `用户` tracked as two
  separate entities: the relationship model only knew 用户, while affect counts
  split (30 vs 5). A target resolver (`src/self/alias.js`) now folds
  `用户/用户/你/您` (plus `persona.userAliases`) onto `persona.userAddress` for
  every relationship and emotion write. `maintain()` merges rows that already
  exist under an alias and recomputes the attitude.
- Default behaviour is unchanged for codes that never configured a persona:
  aliases fold onto the neutral `你`.
- Tests: 333/333, run twice.


## 0.4.25 — 2026-11-15

### Fixed
- **Working memory no longer piles up near-duplicates.** The audit found the
  same todo stored twice (two shiori items, two bili-caps items). `working.add`
  now compares the new text against the scope's items (jaccard ≥ 0.82) and, on a
  hit, refreshes priority/pinned/text on the existing row instead of inserting a
  second one. `dedupe: false` remains available for explicit additions.
- Tests: 329/329, run twice.


## 0.4.24 — 2026-11-15

Quality pass on facts and recall accounting. No schema changes, no data-path
changes; an existing store opens unchanged.

### Fixed
- **Fact noise.** A single guard (`src/engines/fact-guard.js`) now validates
  every extracted candidate before it can become a fact: the predicate must be
  ASCII snake_case, subject/object must not be punctuation or a function word,
  and lengths are bounded. This is what produced rows like `(现, at, ：)` and
  `(只, is, …)` in 0.4.22 — the LLM extractor accepted whatever JSON came back.
  Both the rule extractor and the LLM extractor go through it.
- **Recall accounting.** `touchResults` now respects `touchMinIntervalMs`
  (default 5 minutes) per trace, so building a recall block on every step no
  longer inflates `access_count` into a meaningless number.
- **Gist summaries.** Reflection summaries now carry an `大意：` line — the most
  central sentence among the sources (fuzzy-trace: gist outlives verbatim) —
  before the bullet list.

### Added
- `touchMinIntervalMs` config (300000).
- Tests: `test/unit/fact-guard.test.js` (4 cases). Suite: 328/328, run twice.


## 0.4.23 — 2026-11-15

Data-quality release. No new tools and no UI changes; the loader id, data path
and SQLite schema stay the same, so an existing store opens unchanged.

### Fixed
- Host capture no longer stores the host's own injected context (runtime
  snapshot, `<system-reminder>` blocks, skill catalogs, subagent/checkpoint
  notices). `stripInjected()` keeps only what the user and the assistant
  actually said; a turn that is pure injected context is skipped. New config
  `captureMaxChars` (default 4000) caps a captured turn.
- `encode` gets a second-line guard: content that *starts* with a host marker is
  rejected as `injected-context`, so capture paths that bypass the host runtime
  cannot reintroduce the pollution. Users discussing those markers are still
  stored. New config `maxContentChars` (default 8000) truncates oversized text.
- Titles: host turns are no longer stamped `会话 N 的对话`; a readable title is
  derived from the first real line (`deriveHostTitle` / service `deriveTitle`).
- Recall now records access (`access_count`, `last_access_at`) for the top
  results, so DSR recency and calibration stop being frozen. New config
  `touchOnRecall` (default true).
- Vector indexing no longer fire-and-forgets. Failed embeds enter an in-process
  queue with exponential backoff and a bounded attempt count; `backfillMissing()`
  queues active traces that never got a vector; `vectorMaintain()` drains both.
  The scheduler calls it every 10 minutes (40 backfill / 20 drain per pass).
- Housekeeping `maintain()` (scheduler, every 10 minutes): closes disputes whose
  both facts are already invalidated, removes duplicate summaries, expires stale
  pending intentions, retires chat-fragment playbook candidates.
- `engines.dsh` widened to `>=0.2.1-rc.2 <0.5.0` (was `<0.4.0`).

### Added
- `bin/migrate-0.4.23.mjs`: one-shot, idempotent repair of an existing store
  (archive injected-context traces, retitle, fix identity boundaries, dedupe
  summaries, expire intentions, retire fragment rules, close zombie disputes).
  Dry-run by default; `--apply` takes a `VACUUM INTO` backup first.
- Tests: `test/unit/capture-filter.test.js` (10 cases). Suite: 324/324.

### Hooks
- `cortex.onTick(fn)` / `cortex.emitTick(report)`: the host scheduler now emits
  one heartbeat to registered listeners after every pass. Companion plugins
  (dsh-cortex-agency) ride that heartbeat instead of starting a second clock.


## 0.4.22 — 2026-11-14

- Fix CLI default data root: use profileDataRoot (cortex-memory) instead of legacy ~/.dsh/cortex.
- Add CLI root regression tests for default, --data and CORTEX_HOME.
- Document that tests/bench require the DSH bundled Node 24; system Node 22 is below engines.
- No loader-id, data-path or UI changes.

## 0.4.21 — 2026-11-14

- Documentation-only release: replace the README with a current-version capability guide, install/download flow, add-on matrix and honest performance boundaries.
- Update package description and search keywords; no engine, icon, loader-id or data-path changes.

## 0.4.20 — 2026-11-14

- Replace the plugin icon with the owner-provided whale-girl avatar (embedded 256 JPEG).
- Keep the sidebar icon offline: no remote image URL.
- No engine, loader-id or data-path changes.

## 0.4.19 — 2026-11-13

- Revert client bundle id to `dsh-cortex`. It is intentionally different from loader row id `dsh-cortex-memory`.
- 0.4.18 set both to `dsh-cortex-memory`, causing duplicate factory registration and web boot failure; 0.4.19 removes that change.
- Loader id, local/public patch names and `~/.dsh/cortex-memory` data path remain unchanged.
- Add contract assertion that client id is `dsh-cortex` and not the loader id.
- Tests: 437/437.
## 0.4.18 — 2026-11-13

- Fix client bundle id: `dsh-cortex` -> `dsh-cortex-memory`.
- Host can be active while the sidebar panel is absent if the client module id does not match the loader row; this release aligns them.
- Local package keeps `patch.name: dsh-cortex`; public package keeps `patch.name: dsh-cortex-memory`.
- Tests: 437/437.
## 0.4.17 — 2026-11-13

- Loader id and bundle row change to `dsh-cortex-memory`; `ctx.provide('cortex')` remains as a compatibility alias.
- Existing profile rows must migrate from `cortex` to `dsh-cortex-memory`; a migration script backs up the profile and verifies exactly one target row.
- Data root remains `DSH_HOME/cortex-memory`; legacy data is copied, never moved.
- Tests: 437/437.
## 0.4.16 — 2026-11-13

- Default data root moves to `DSH_HOME/cortex-memory` (desktop) and `DSH_HOME/cortex-memory/profiles/<profile>` for other profiles.
- Legacy `DSH_HOME/cortex` is never moved or deleted. Migration scripts copy it, keep a backup, and verify the copy before DSH opens the new root.
- Loader id stays `cortex` in this release; a later migration-scripted release will rename it.
- README extractor version corrected to 0.3.5; mojibake repaired.

## 0.4.13 — 2026-11-13

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

## 0.4.12 — 2026-11-13

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

## 0.4.11 — 2026-11-12

- Life/date fixes, graph candidate labels, neutral public package surface.
- Recent timeline endpoint and incremental summon rebuild.

## 0.4.0 — 2026-11-12

### Fixed
- Prompt-only injection gate; full search/API/CLI remain available.
- Search items now expose `importance`, `confidence`, `match`, `kind`; perm tier works.
- Removed cross-session single-cache fallback.
- `autoGraphCandidates` is the canonical graph flag; old name is an alias.
- Guardian scheduler uses light checks per tick and full checks at startup/6h.
- Guard backup/restore/export/prune/sync are constrained to `dataRoot` by default.
- Tests and docs are included in the package; `npm test` works after install.

### Added
- `persona.selfName` / `persona.userAddress`; neutral public defaults (`助手` / `用户`).
- `injectionGate`, `recentMinMatch`, `allowRestoreOutsideRoot` config.

### Compatibility
- Additive config only; no schema migration.
- Existing 0.3.x databases open in place.
- Local profiles can restore the 我 / 用户 persona through config.

## 0.3.1 — 026-11-12

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


















