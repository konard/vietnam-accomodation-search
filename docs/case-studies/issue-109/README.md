# Issues #102–#109: requirements, investigation, and acceptance

All work belongs to PR [#110](https://github.com/konard/vietnam-accomodation-search/pull/110).
This ledger distinguishes implemented fixes from acceptance that needs protected
operator inputs. Issue #109 and all seven child issues and their comments were
read; none had comments at the start of this investigation.

## Work plan

- [x] Verify the prepared branch and clean checkout; read contributing rules,
      every scoped issue, PR discussion/reviews, and recent merged work.
- [x] Enumerate every requirement and investigate affected paths across the repo.
- [x] Research primary documentation and existing components; record options.
- [x] Write minimal reproducing regressions before each fix.
- [x] Repair metrics/corpus and multilingual contract-term rent extraction.
- [x] Repair query-specific collection freshness, city selection, scheduling,
      and immediate cached bot responses.
- [x] Synchronize the SIGKILL fixture and verify alongside parallel tests.
- [x] Make deploy readiness configurable, shorten startup health intervals,
      correct existing-project recovery, and test a synthetic slow startup.
- [x] Reuse verified audit projections; measure source phases; support explicit
      source chunks with resumable, merged report evidence.
- [x] Check publisher/operator prerequisites without disclosing credentials.
- [x] Run all local tests, runtime/coverage/format/lint/duplication checks and
      retain verbose output outside tracked product files.
- [x] Preserve useful atomic steps with one release changeset and include
      latest main.

The publication checklist is tracked in PR #110's validation section: push only
the prepared branch, review the complete diff, update title/body and individual
closing references, preserve non-passing CI logs with timestamps/SHA, confirm
fresh CI, finish background work, verify a clean tree, and mark the PR ready
for review with incomplete live acceptance stated explicitly.

## Requirement inventory and solution options

| Issue | Every requested requirement                                                                                                                | Options and planned solution                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #102  | Correct extraction passes despite live USD/VND rate changes.                                                                               | Score native amount/currency/period, recompute with the run's rate, or use at most 2% VND tolerance. Prefer native-price scoring to avoid accepting extraction errors.                               |
| #102  | Fields with zero expected positives are **not evaluated**, never passing.                                                                  | Publish explicit evaluation status and nullable pass; keep aggregate success separate from coverage.                                                                                                 |
| #102  | Add availability labels, label every sold/rented/occupied case, include at least 20 unavailable cases across languages.                    | Review the retained anonymized corpus and add clearly identified multilingual supplemental regression cases; do not fabricate live provenance.                                                       |
| #102  | Include #103's contract-term rent pattern.                                                                                                 | Add reviewed anonymized term-option cases with native price and availability labels.                                                                                                                 |
| #103  | Recognize RU `Договор N–M месяцев`, `Договор от N месяцев`, EN `N–M months`, VI `hợp đồng N–M tháng` as rent; return the minimum or range. | Extend existing clause/token rent classification, preserving fee exclusion and the existing minimum/range policy.                                                                                    |
| #103  | Regression cases for every reported rent block in RU/EN/VI.                                                                                | Add table-driven parser cases, including fees, reversed option order, cheapest search/subscription filtering.                                                                                        |
| #103  | Optional suspicious apartment monthly-price floor.                                                                                         | Prefer fixing source classification; a global floor could suppress legitimate shared-room rents. Document whether a guard is warranted.                                                              |
| #104  | Fresh sources answer from cache in seconds; refresh only stale sources within budget or in background.                                     | Persist successful per-source/query collection timestamps, including empty results; retain partial cache without requiring an offer from every source.                                               |
| #104  | Exclude other-city sources or collect after matching sources.                                                                              | Identify city from query and source metadata; exclude explicit mismatches, retain national/unknown sources. Apply metadata to seeded city channels.                                                  |
| #104  | Prioritize previously uncollected sources; matching sources covered across two runs.                                                       | Persist outcomes and order never-attempted/pending before recently attempted sources; skip fresh successes. Test two bounded passes and process restart.                                             |
| #104  | Bot replies immediately with cache and names sources still refreshing.                                                                     | Add a cache-first search option and one shared refresh promise with completion/cleanup tracking; use it in bot search flows.                                                                         |
| #105  | SIGKILL escalation deterministic under load.                                                                                               | Synchronize fixture trap readiness with an injected monotonic clock; wait for child completion and escalation marker instead of a one-second startup race. Verify beside the full test suite.        |
| #106  | Configure NPM_TOKEN/DOCKERHUB_TOKEN secrets and DOCKERHUB_IMAGE/DOCKERHUB_USERNAME variables.                                              | Inspect prerequisites; configure only if actual authorized owner credentials are available. No invented or borrowed credentials.                                                                     |
| #106  | Rotate bot token; supply separate drill bot, driver account, numeric identity pins.                                                        | Requires operator-owned Telegram inputs and BotFather action; report exact missing inputs without leaking tokens/identities.                                                                         |
| #106  | Release Preflight passes and a release exists before claiming fixed.                                                                       | Run real preflight and inspect tags/releases; explicitly leave acceptance unmet if inputs are absent. Required closing reference is not an assertion that this gate passed.                          |
| #107  | Configurable readiness deadline (e.g. --ready-timeout, five-minute default) or health-derived deadline; optional direct /ready polling.    | Use elapsed-time deadline with injectable clock/sleep/status and early terminal failure; share it with deploy and rollback.                                                                          |
| #107  | Short startup health interval (e.g. 2 seconds).                                                                                            | Configure both Compose start_interval and Dockerfile --start-interval with a startup grace period consistent with the deadline.                                                                      |
| #107  | Seeded 3 GB or synthetic-equivalent deploy drill; record startup time/data size.                                                           | Reproduce 40-second readiness plus delayed Docker healthy transition with a virtual clock; provide a reusable protected-data startup measurement drill if a real large store is unavailable.         |
| #107  | Correct recovery message for an existing stopped project.                                                                                  | Restore its recorded current image/data directory rather than treating it as a first deployment; regression-test the state machine.                                                                  |
| #108  | Adopt verified existing projections on resume; first source within five minutes on retained store.                                         | Share app LinkCliMirror verification/reuse path; investigate inconsistent shard configuration and avoid redundant reads/projections. Synthetic verification cannot establish private-store timing.   |
| #108  | Projection proportional to new batch; per-source fetch/OCR/parse/store/project time split.                                                 | Reuse unchanged content-addressed chunks/shards, retain journals/checkpoints, aggregate phase timings without logging private content.                                                               |
| #108  | Forty sources within two hours or explicit source chunks merged into one report, completed twice as #73 requires.                          | Implement validated --sources ranges over a stable retained cohort, preserve per-source summaries and merge them into aggregate report; two protected complete runs still require credentials/store. |
| #109  | Implement all children in one PR; no deferred follow-up PRs.                                                                               | Keep all changes, tests, investigations, and remaining-input evidence in #110.                                                                                                                       |
| #109  | Separate closing keyword for #102–#108 plus #109; explain already resolved/non-reproducible items.                                         | Include the exact required closing block and honest acceptance status in final PR description.                                                                                                       |

## Evidence and remaining limits

### Root causes and codebase coverage

The historical native-price fixture froze a conversion rate while the product
used a live rate. Price scoring now compares amount, currency, and period in
both parser metrics and the product SearchService audit. The reviewed corpus
uses the same native schema; historical investigation reports retain their
original evidence. A field with no expected positives reports
`status: "not-evaluated", pass: null`, including when it has false positives.
The aggregate report permits unevaluated fields but no failing evaluated field.

Contract month labels obscured rent classification, and Vietnamese `đồng` in
`hợp đồng` could itself be mistaken for money. The parser now excludes the
contract span from money tokens and recognizes its associated rent. The
minimum of the rent options remains the policy. Monthly fees stay excluded,
and a contract's month count does not override a quoted nightly billing period.
These rules feed browser listings, Telegram parsing, cheapest ranking, and
subscription price filters through the shared parser. A global 1M VND floor
was deliberately omitted: a genuine 800k monthly shared-room rent must remain
searchable. Sold-out/location fixes reported already resolved in #103 were
preserved; those private 996 messages were not available for re-parsing here.

Offer-only freshness confused successfully empty sources with sources never
collected. `search-collections` now persists source/query success and attempt
timestamps through the store's atomic update path. City matching applies to
seed metadata and dynamic registry entries. Never-attempted sources precede
recent failures; fresh successes are skipped. The bot returns cache immediately,
shares refresh work for a query, names pending sources, observes background
failures, and drains that work on shutdown. Explicit refresh remains supported.

The SIGTERM-ignore fixture previously raced trap installation against its
one-second deadline. It now installs the trap before announcing readiness;
an injected elapsed clock advances only after readiness. The wrapper retains
real elapsed time by default and cleans up its child if an injected clock fails.

Deploy's fixed poll count is replaced with a configurable elapsed deadline in
both deployment and rollback. Compose and Dockerfile both get the shorter
startup probe interval and five-minute grace. Existing stopped projects read
their recorded image and recover the old image and state; failed directory
moves restore the snapshot to the original directory. The synthetic drill
records the issue's data-size reference and reproduces its health delay without
claiming an actual 3.5 GB startup measurement.

Audit resumes previously fetched completed sources again, discarded their
summaries, resolved all cohort entities before the first source, and scanned
the entire retained domain collection for a final sample. It now retains a
stable cohort, complete summaries and pass identity; skips completed sources;
resolves sources lazily; replays a durable parsed journal after a projection
interruption; and verifies storage on a bounded sample. The app's existing
LinkCliMirror and chunk/shard sizes are preserved so verified projections can
be reused. No storage format or projection verifier was weakened. Final report
totals merge all source checkpoints, with pending sources preventing success.
Projection/OCR timings are subtracted from their parent phases, and overlapping
projection jobs are counted by elapsed-time union rather than double-counted.

### Primary-source research and component choices

| Component / source                                                                                           | What it establishes                                               | Decision                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Docker Compose healthcheck](https://docs.docker.com/reference/compose-file/services/#healthcheck)           | `start_interval` is supported from Compose 2.20.2.                | Use two-second probes during the five-minute startup grace.                                                                                                     |
| [Docker run health options](https://docs.docker.com/reference/cli/docker/container/run/)                     | `--health-start-interval` needs Engine API 1.44.                  | Apply equivalent image health settings; document compatibility.                                                                                                 |
| [Node child processes](https://nodejs.org/api/child_process.html)                                            | Signal delivery and child completion are distinct events.         | Synchronize trap readiness and retain process-group cleanup instead of assuming startup time.                                                                   |
| [Node filesystem promises](https://nodejs.org/api/fs.html#promises-api)                                      | Concurrent modifications of one file are not synchronized.        | Queue the shared durable writer by resolved destination, retaining file and directory fsync.                                                                    |
| [Microsoft file sharing](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) | Rename requires compatible delete-sharing access.                 | Keep same-destination replacement transactions from overlapping on Windows.                                                                                     |
| [write-file-atomic](https://github.com/npm/write-file-atomic)                                                | Serializes same-file writes; independent files remain concurrent. | Its queue is a useful precedent. Preserve the existing application's directory-fsync semantics and avoid another dependency.                                    |
| [lru-cache](https://isaacs.github.io/node-lru-cache/)                                                        | TTL and `fetchMethod` support stale-result refresh.               | Useful alternative, but its memory cache would not retain successful empty collections across restart. Use existing LinksStore plus a small shared-promise map. |
| [p-limit](https://github.com/sindresorhus/p-limit)                                                           | Limits concurrent asynchronous tasks.                             | Existing source pool already supplies cancellation, budget, outcomes, and concurrency. Keep it and fix scheduling/freshness rather than add a second queue.     |
| [grammY scaling](https://grammy.dev/advanced/scaling)                                                        | Bot concurrency can overlap asynchronous middleware.              | Share refresh work and wait for cleanup within the existing bot/runtime lifecycle; a runner migration is unnecessary.                                           |
| [link-cli](https://github.com/link-foundation/link-cli)                                                      | Existing native links import/export component.                    | Retain the app's verified LinkCliMirror reuse path and content-addressed chunks; test with real clink 0.2.11.                                                   |
| [Telegram BotFather](https://core.telegram.org/bots/features#botfather)                                      | Bot ownership/token management is an operator action.             | Rotation and drill identities require the owner's actual Telegram access.                                                                                       |

No new production dependency is needed. The options for each individual
requirement and the chosen plan are listed in the inventory above.

### Reproduction and automated evidence

- `tests/issue-109-parser-metrics.test.js` reproduces all four reported Russian
  fee-as-rent blocks, English/Vietnamese variants, rate drift, unevaluated
  availability, and cheapest/max-price effects. The initial regressions failed
  before the parser/metrics changes. The retained 275 live-anonymized cases
  now include all nine unavailable labels, plus 12 clearly identified synthetic
  availability controls and 12 anonymized issue-derived term cases. The 299-case
  corpus has 21 unavailable positives across RU/EN/VI; supplemental cases are
  explicitly distinguished from the original live sample.
- `tests/issue-104-search-cache.test.js` reproduces freshness after empty
  collection, restart, query changes, new sources, expiry, all eight named
  foreign channels, two bounded passes, concurrent cached replies, background
  errors, and bot cleanup. Its original cache/rotation tests failed before fix.
- `tests/run-with-budget-warning.test.js` tests actual process-group escalation.
  The final parallel `npm test` passed the synchronized SIGKILL case in 1.18s;
  all 1,155 Node tests passed in 72.54s with real clink.
- `tests/issue-107-readiness.test.js` and
  [readiness-drill.json](readiness-drill.json) verify the former deadline fails
  while the new default becomes healthy at 60s. The stopped-project regression
  failed before extracting the recorded-image recovery path.
- `tests/issue-108-audit-progress.test.js` checks disjoint chunk aggregation,
  incomplete/previous-pass rejection, legacy checkpoint adoption, exclusive
  timings, completed-source reuse, interrupted projection replay without a
  second fetch, and fresh collection for the second pass. Existing storage
  tests continue to verify unchanged projection reuse with real clink.
- [field-metrics.json](field-metrics.json) is generated by
  `node experiments/field-corpus-metrics.mjs` and reports current corpus gates.

Validation uses the real installed `clink` 0.2.11, with
`REQUIRE_REAL_CLINK=1`. The complete parallel Node suite passed 1,155/1,155 in
72.54s. The final complete sequential coverage suite passed 1,155/1,155 in 244.73s
with 100% product line coverage; the new refresh helper also has 100% branch
and function coverage. Bun passed all 1,155 tests in 131.10s. Deno passed
1,050 tests and 19 steps in 42s, using the repository's existing runtime-specific
conditions for filesystem/process fixtures. Repository lint, formatting, and
duplication checks and strict repository-wide zero-warning ESLint passed;
18 parser/metrics regressions also passed in both Bun and Deno after the final
parser refactor. Compose configuration validated with explicit build
identity and environment resolution disabled. Detailed command output is retained in
`/tmp/issue-109-logs/`. Early simultaneous test/coverage/lint/compiler runs
caused unrelated existing performance/drain deadline failures; isolated final
runs passed without increasing their timeouts or changing their assertions.

### Resumable protected audit plan

Use the same protected state directory, source/window limits, and credentials
for every chunk. Source ordinals refer to the persisted public cohort; discovery
errors and folder resolution evidence are retained. Reports remain incomplete
until every selected-cohort source has completed. Each report includes
`chunks`, `sources[].timingsMs`, and `completedPasses`.

```bash
node experiments/audit-telegram-accommodations.mjs --state-directory /protected/audit --sources 1-10 --output /protected/pass-1.json
node experiments/audit-telegram-accommodations.mjs --state-directory /protected/audit --sources 11-20 --output /protected/pass-1.json
node experiments/audit-telegram-accommodations.mjs --state-directory /protected/audit --sources 21-30 --output /protected/pass-1.json
node experiments/audit-telegram-accommodations.mjs --state-directory /protected/audit --sources 31-40 --output /protected/pass-1.json
# Start a fresh pass only after the whole previous cohort completed.
node experiments/audit-telegram-accommodations.mjs --state-directory /protected/audit --new-pass --sources 1-10 --output /protected/pass-2.json
# Continue ordinals 11-20, 21-30, 31-40 without --new-pass.
```

The existing explicitly declared GramJS audit session requirement remains.
On the retained protected store, record resume-to-first-source under five
minutes, per-source phase splits, and both complete 40-source/two-month passes.
Those live acceptance measurements are **not established** by unit fixtures.

### Unmet owner-controlled acceptance (#106 and live #108 evidence)

On 2026-10-05 UTC, `gh secret list` and `gh variable list` returned no repository
entries; `gh release list` returned no releases. None of the required publishing
credentials, Telegram bot/session/identity inputs, driver session, or drill bot
token were present in the task environment. Real
`PREFLIGHT_MODE=release bash scripts/preflight-credentials.sh` exited 1, with
0 verified, 2 failed, 1 unknown: missing npm bootstrap authentication and
missing Docker Hub image/publisher configuration. Bot rotation cannot be
verified or performed without the owner's Telegram account.

**#106 remains unresolved.** No claim is made that Release Preflight passed,
a release exists, a token was rotated, or protected E2E/cutover acceptance ran.
The owner must supply the credentials and drill identities, rotate the token,
then pass the real release preflight and publish a verified release. The
protected retained store and session are also required to establish #108's
first-source deadline and its two complete live passes. These are missing
inputs, not tests that were silently counted as passing.

### CI investigation

The initial Checks run [37385822207](https://github.com/konard/vietnam-accomodation-search/actions/runs/37385822207)
was created at 2026-10-05T22:59:01Z on `351731e`. Its only underlying failure
was Check for Changesets; the pipeline status then failed. Real-clink tests
and 100% product coverage passed on that original commit. The downloaded
`ci-logs/checks-37385822207.log` preserves the run. Lines 163 and 165 also show
missing npm bootstrap authentication and missing `DOCKERHUB_IMAGE`; PR-mode
Release Preflight is advisory, so its green job is not evidence for #106.
This PR adds exactly one patch changeset. Fresh runs are checked against the
latest pushed SHA and timestamps before declaring CI complete.

### Windows/Bun CI repair (2026-10-06)

The subsequent [Checks run 37390996053](https://github.com/konard/vietnam-accomodation-search/actions/runs/37390996053)
was created at 2026-10-05T23:53:02Z on `ff1137d`, after that commit's
23:52:56Z timestamp. Its Bun/Windows failure was
`canonical associative storage > completes concurrent writes of one file within one millisecond`.
The full workflow log is preserved as `ci-logs/checks-37390996053.log`;
the focused log is `ci-logs/bun-windows-37390996053.log`. Focused lines
290–297 show two fulfilled writes and one rejected write; full-log lines
29625–29628 show that Pipeline Status correctly propagated the test failure.
No timeout, acceptance threshold, runtime exclusion, or status gate was relaxed.

Unique temporary names prevented staging collisions but did not serialize
replacement of one destination. The diagnostic regression repeats ten bounded
rounds, reports rejected filesystem errors, and checks for abandoned temporary
files. The shared durable writer now queues each complete staging/fsync/rename/
directory-fsync transaction by resolved path, with Windows case normalization.
Relative and absolute aliases use the same queue. A rejected operation releases
the next queued operation; completed queues are removed. Different destinations
remain independent. Existing cross-process LinksStore locking is preserved.
This applies to canonical offers, generic records, binary projection pointers
and manifests, Telegram sessions, audit journals, and release evidence through
their existing shared helper.

The diagnostic-only commit `702509f` reproduced the same failure in
[run 37391885375](https://github.com/konard/vietnam-accomodation-search/actions/runs/37391885375),
created at 2026-10-06T00:03:00Z after its 00:02:49Z commit.
`ci-logs/bun-windows-37391885375.log` line 290 identifies
`code: "EPERM", syscall: "rename"` at round 1 (the second bounded round).
This establishes the failing replacement operation before the implementation
change; the runtime's precise native handle-sharing behavior is inferred from
Microsoft's sharing rules. Every other runtime/platform test job passed on
that diagnostic commit.

The focused regression also verifies final call order, preservation of committed
contents after a failed write, temporary-file cleanup, and continued queued and
later writes. The complete Node suite with real clink passed 1,156 tests in
64.00s during this repair; sequential real-clink coverage passed all 1,156
tests in 228.93s with 100% product line coverage. Bun with real clink passed
all 1,156 tests in 118.35s. Field metrics, corpus preservation, and the
synthetic readiness drill were rerun successfully. Final Deno, static checks,
and fresh CI results are recorded in PR #110 after they complete.

The requirement inventory above was rechecked against every child issue and
the PR's conversation, inline comments, and reviews. Latest `main` remains
included. Repository secrets, variables, and releases were rechecked on
2026-10-06 and remain empty; real release preflight still exits 1 with
0 verified, 2 failed, and 1 unknown. The documented #106 and protected #108
acceptance limits therefore remain in effect.
