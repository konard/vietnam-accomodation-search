# Product requirement traceability

This is the durable checklist for requirements originating in
[Issue #1](https://github.com/konard/vietnam-accomodation-search/issues/1) and
implemented by umbrella Issue #10 and extended by
[Issue #20](https://github.com/konard/vietnam-accomodation-search/issues/20).
The previous version described the pre-implementation handoff; PR #11
completed the original production contracts, while PR #21 implemented the
focused contracts from Issues #12–#19. Post-merge live verification found the
release-blocking gaps originally tracked by Issues #22–#27. Those issues were
closed after implementation work, but corrected live verification and the
failed release created successor acceptance batches in Issues #31–#36 and,
after the 2026-09-24 full rerun, [Issues #39–#43](case-studies/revalidation-2026-09-24/README.md).
The [2026-09-25 candidate rerun](case-studies/revalidation-2026-09-25/README.md)
reopened the still-unmet live gates after PR #45.
The [2026-09-26 post-PR #47 rerun](case-studies/revalidation-2026-09-26/README.md)
confirmed partial checkpoint and deployment progress, but also reproduced the
unmet release, browser, native Telegram, and projection gates after PR #47
automatically closed their issues.
The [Issue #48 acceptance inventory](case-studies/issue-48/README.md) tracks the
single-PR plan for all six reopened issues and the release staging repair.
The [Issue #50 requirement and acceptance ledger](case-studies/issue-50/README.md)
updates that plan with the current packaging, publication preflight, browser
replacement, and remaining live/immutable gates in PR #51.
The [`0.12.3` candidate rerun](case-studies/revalidation-2026-09-27/README.md)
found that npm publication, the complete browser cohort, the local Docker argv
regression, native Telegram modes, and first-source binary projection remained
failed or unproved at that commit. The [Issue #50 ledger](case-studies/issue-50/README.md)
records current candidate repairs and the release gates still open in PR #51.
PR #49 closed Issues #16 and #39–#43 before acceptance.
[The 2026-09-28 post-PR #51 rerun](case-studies/revalidation-2026-09-28/README.md)
supersedes the 2026-09-27 candidate observations: both complete ten-route
browser passes succeeded, bot-only E2E and host-bind durability passed again,
and an instrumented same-bind redeploy observed a 3,691 ms maximum sampled
readiness interruption. PR #51 nevertheless closed Issues #16, #39–#43, #48,
and #50 without completing publication, native Telegram, full source audit,
or immutable-release acceptance. The latest release preflight failed because
the first-publish `NPM_TOKEN` was absent. Historical audits below remain
evidence at their recorded commits, including failures, not current passing
claims.
The [Issue #52 ledger](case-studies/issue-52/README.md) records PR #53: it
traces the projection timeout to quadratic `clink` import and a 10 MiB parser
limit, adds verified content-defined shard projection and linear decoding, and
repairs the Docker-argv fixture; the live and published gates remain open.
[The 2026-09-29 post-PR #53 rerun](case-studies/revalidation-2026-09-29/README.md)
tested the retained private corpus and exposed a new offer-shard verification
mismatch after the large domain-record and trace projections completed. It
also confirmed a green local suite, full browser cohort, bot-only E2E, and
local production-image smoke test. PR #53 closed the previous issues despite
the release and live gates remaining unmet. Per the operator's instruction,
the new successor batch is [#54](https://github.com/konard/vietnam-accomodation-search/issues/54)–[#58](https://github.com/konard/vietnam-accomodation-search/issues/58);
closed issues are not reopened.
The [Issue #59 ledger](case-studies/issue-59/README.md) records PR #60 for
that batch. It traces the offer-shard mismatch to `clink` name trimming and
writes schema v3, fails the release closed on the committed OCI policy,
restores the pre-cutover state with the prior image, adds identity-pinned
native capability and message-level cutover harnesses, and fixes the missing
user fallback for a Bot API `chat not found`. The credentialed, private-corpus,
and published-release runs remain owner actions.
[The post-PR #60 live revalidation](case-studies/revalidation-2026-09-29-pr60/README.md)
tested a protected copy of the retained private corpus. The schema-v3 fix
passed the previous offer-shard name-rewrite mismatch, but a later source
failed at a new 1.29-billion-character offer serialization boundary before a
final report. The browser cohort and local image passed, while publication,
native identity-pinned E2E, and message-level cutover remain unaccepted. PR
#60 closed #54–#59 before those gates passed. In accordance with the operator
request, the successor batch is [#61](https://github.com/konard/vietnam-accomodation-search/issues/61)–[#65](https://github.com/konard/vietnam-accomodation-search/issues/65);
closed issues were not reopened.

[The Issue #66 acceptance ledger](case-studies/issue-66/README.md) tracks the
successor #61–#65 batch. It records the bounded offer-chunk implementation and
synthetic regression, and keeps the private-corpus, publication, native
Telegram, immutable Docker, and exact-release gates open until live evidence
exists. The deployment data schema is now version 3 to prevent old images
from ignoring an indexed offer collection.

[The 2026-09-30 post-PR #67 revalidation](case-studies/revalidation-2026-09-30-pr67/README.md)
supersedes the Issue #66 candidate-only status. The bounded-offer focused suite
passes, and a new local Docker image preserves synthetic data after container
removal. The current polite browser cohort passes 10/10 routes and accounts for
all 1,617 observed segments. However, the full suite with the real `clink`
binary fails an indexed-offer order regression (860/861 tests), the protected
40-source Telegram audit is not yet complete and emits a negative-timeout
warning, Release Preflight still fails two missing credential groups, and the
native Telegram and immutable message-level cutover gates remain unaccepted.
The expanded dependency audit also found one high-severity root development
advisory and three high plus one moderate advisory in the desktop example;
the shipped root runtime dependency audit was clear. Four high-severity
Electron Dependabot alerts remain open for the example's pinned `43.4.0`.
PR #67 auto-closed #61–#66 despite its own pending-gate ledger; new successor
issues, not reopened historical issues, track the current blockers:
[#68 offer order and mandatory real-clink CI](https://github.com/konard/vietnam-accomodation-search/issues/68),
[#69 bounded complete Telegram audit](https://github.com/konard/vietnam-accomodation-search/issues/69),
[#70 immutable publication](https://github.com/konard/vietnam-accomodation-search/issues/70),
[#71 native Telegram E2E](https://github.com/konard/vietnam-accomodation-search/issues/71),
[#72 message-level Docker cutover](https://github.com/konard/vietnam-accomodation-search/issues/72),
[#73 exact-release acceptance](https://github.com/konard/vietnam-accomodation-search/issues/73),
and [#74 dependency advisories](https://github.com/konard/vietnam-accomodation-search/issues/74).

[The 2026-10-03 post-PR #76 revalidation](case-studies/revalidation-2026-10-03-pr76/README.md)
supersedes the post-PR #67 status. With real `clink` 0.2.11 the suite passes
868/868, so the #68 order regression is fixed. The root audit is clean and the
browser cohort passes 10/10. A local deploy drill measured a 2.8 s readiness
handoff and verified failed-candidate restore, rollback, and host-bind
persistence. PR #76 closed #68–#75 without live evidence for #69–#73. The new
successor issues are
[#77 data-directory change on redeploy](https://github.com/konard/vietnam-accomodation-search/issues/77),
[#78 duplicate-poller crash loop](https://github.com/konard/vietnam-accomodation-search/issues/78),
[#79 unpatched example advisory](https://github.com/konard/vietnam-accomodation-search/issues/79),
[#80 owner inputs for release and live Telegram](https://github.com/konard/vietnam-accomodation-search/issues/80),
[#81 deploy UX and docs](https://github.com/konard/vietnam-accomodation-search/issues/81),
and [#82 raw media objects persisted per offer](https://github.com/konard/vietnam-accomodation-search/issues/82).
#82 is the root cause of the unfinished 40-source audit.

[The post-PR #84 revalidation](case-studies/revalidation-2026-10-03-pr84/README.md)
confirms the fixes for #77, #78, and #79 (927/927 tests with real `clink`,
Security green, deploy guards verified with a real token) and partial fixes for
#81 and #82. Successors are
[#85 bound offers on write and audit throughput](https://github.com/konard/vietnam-accomodation-search/issues/85),
[#86 deploy and tooling leftovers](https://github.com/konard/vietnam-accomodation-search/issues/86),
and [#87 owner inputs](https://github.com/konard/vietnam-accomodation-search/issues/87).

[The post-PR #89 revalidation](case-studies/revalidation-2026-10-04-pr89/README.md)
confirms #85 and #86 fixed (951/951 tests with real `clink`). The real audit
now crashes at source 8 of 40 on the monolithic `domain-records` collection,
tracked by [#90](https://github.com/konard/vietnam-accomodation-search/issues/90).
The owner inputs are carried over to [#91](https://github.com/konard/vietnam-accomodation-search/issues/91).

[The post-PR #93 revalidation](case-studies/revalidation-2026-10-04-pr93/README.md)
confirms #90 fixed, but end-to-end product and field-accuracy checks found false
negatives in search and false positives in acceptance:
[#94 search returns nothing](https://github.com/konard/vietnam-accomodation-search/issues/94),
[#95 Docker browser sandbox](https://github.com/konard/vietnam-accomodation-search/issues/95),
[#96 serial, unpersisted, leaking search](https://github.com/konard/vietnam-accomodation-search/issues/96),
[#97 live extraction accuracy](https://github.com/konard/vietnam-accomodation-search/issues/97),
[#98 open warnings](https://github.com/konard/vietnam-accomodation-search/issues/98),
and [#99 owner inputs](https://github.com/konard/vietnam-accomodation-search/issues/99).

[Issue #92](case-studies/issue-92/README.md) addresses #90 and #91 in PR #93.
Every non-offer collection that outgrows one chunk is stored as bounded,
content-defined, indexed LiNo chunks, and an oversized single file is streamed
into chunks one record at a time, so no text passed to `parseNotation` exceeds
a quarter of its bound. `appendRecords` evicts by record count and bytes and
rewrites only the chunks it changes; Telegram domain records, events, traces
and the live audit use it, and the audit verifies storage on a bounded sample.
Two gates are still open: the protected 40-source audit rerun (90.4) and the
owner inputs in #91, which only the repository owner can provide.

[Issue #88](case-studies/issue-88/README.md) addresses #85–#87 in PR #89.
Every offer write path persists bounded offers, so replayed pre-#82 batches no
longer commit per-byte links. A small collection prunes orphan chunks. A save
restages only the chunks that changed, and those adopt verified sub-shard
projections, so `clink` imports only new content: one edited listing took 37
imports on main and takes 1 here. Variants and price history are capped per
offer. Streamed deploy failures keep their cause, the failed step is named apart
from the recovery, a failed first deploy removes what it created, and linters
skip runtime data. Two gates are still open: the protected 40-source audit rerun
(85.4) and the owner inputs in #87.

[Issue #83](case-studies/issue-83/README.md) addresses #77–#82 in PR #84.
Deploy now refuses an unrecorded data-directory change, a bot token another
project deploys, and a taken host port. It also watches a 30 s settle window
after cutover. A Telegram polling conflict makes the instance unready and
starts a backoff instead of a crash loop. Offers persist only scalar media IDs
and a bounded `raw`, and the example lock no longer contains
`http-cache-semantics`. Two gates are still open: the protected 40-source audit
rerun (82.5) and the owner inputs listed in #80.

## Latest acceptance delta — Issue #66 candidate

| Requirement group                     | Current observation                                                                                                                                             | Remaining gate                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRC-2, PARSE-1, PARSE-3, LINK-1, QA-2 | A bounded schema-v3 offer index and chunk path passes synthetic, corruption, and interrupted-stage regressions. The private 398-offer merge has not been rerun. | [#61](https://github.com/konard/vietnam-accomodation-search/issues/61): complete and repeat the protected 40-source audit; investigate the timeout warning. |
| DEP-1, REL-1                          | npm remains unpublished; required Docker Hub configuration and immutable artifacts are absent.                                                                  | [#62](https://github.com/konard/vietnam-accomodation-search/issues/62): owner bootstrap, trusted publishing, multiarch digests, and one release identity.   |
| TG-1, TG-2, QA-4                      | Independent pins and native mtcute session are unavailable.                                                                                                     | [#63](https://github.com/konard/vietnam-accomodation-search/issues/63): run every live capability/conversation mode and cleanup.                            |
| DEP-2, DEP-4                          | Message-level drill is waiting on published digests and pinned identities.                                                                                      | [#64](https://github.com/konard/vietnam-accomodation-search/issues/64): complete both architecture cutovers and restoration.                                |
| WEB-2, FINAL-1                        | A prior candidate browser pass exists, but no exact-release double audit or complete requirement matrix.                                                        | [#65](https://github.com/konard/vietnam-accomodation-search/issues/65): perform all live gates twice where specified and commit sanitized results.          |

## Latest acceptance delta — 2026-09-29, post-PR #60

| Requirement group                              | Latest observation                                                                                                                                                                                                                                                                                                                              | Open successor gate                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRC-2, PARSE-1, PARSE-3, PARSE-5, LINK-1, QA-2 | The retained shard is classified as clink name rewriting and schema v3 advances past it. A protected 40-source resume then fails with `RangeError: Invalid string length` at `serializeOffers`, before budget enforcement or a final report. The pending 398-offer merge expands to about 1.295 billion individually formatted LiNo characters. | [#61](https://github.com/konard/vietnam-accomodation-search/issues/61) bounds/streams serialization without weakening typed links or verification, then completes and repeats the private corpus audit. |
| DEP-1, REL-1                                   | Local Node 849/849 and exact local image labels/CLI/UID/`clink`/Chromium pass. Release preflight fails for absent bootstrap `NPM_TOKEN` and required Docker Hub configuration; no immutable artifact exists.                                                                                                                                    | [#62](https://github.com/konard/vietnam-accomodation-search/issues/62) publishes one cross-checked npm/GitHub/multiarch OCI release.                                                                    |
| WEB-2                                          | A current polite candidate run passes 10/10 VI/EN/RU routes, 224 cards, 1,609/1,609 segments, zero incomplete cards or missing semantic checks.                                                                                                                                                                                                 | [#65](https://github.com/konard/vietnam-accomodation-search/issues/65) repeats the full cohort twice on the exact immutable release.                                                                    |
| TG-1, TG-2, QA-4                               | The updated real conversation harness correctly fails closed before network use because independent numeric bot/driver pins are absent; no native mtcute runtime session was exercised.                                                                                                                                                         | [#63](https://github.com/konard/vietnam-accomodation-search/issues/63) provisions protected independent identities/session and runs all real modes and safe cleanup.                                    |
| DEP-2, DEP-4                                   | The exact local image passes smoke, but the new message-level cutover and unhealthy-candidate drill have not run on published digests or with pinned identities.                                                                                                                                                                                | [#64](https://github.com/konard/vietnam-accomodation-search/issues/64) proves one poller, no lost/duplicate messages, restoration, and host-bind survival.                                              |
| FINAL-1                                        | Passing candidate checks and failing private audit are documented, but no immutable target exists for a complete comparison.                                                                                                                                                                                                                    | [#65](https://github.com/konard/vietnam-accomodation-search/issues/65) performs the exact-release acceptance twice and links sanitized evidence.                                                        |

The older deltas and detailed matrix below retain historical contracts and
observations. This post-PR #60 section supersedes their candidate statuses
where they differ; closure by PR syntax is never live acceptance evidence.

## Latest acceptance delta — 2026-09-29

| Requirement group                      | Latest candidate observation                                                                                                                                                                                                                                          | Remaining new issue                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEP-1, REL-1                           | The exact local production image builds and passes labels/CLI/UID/`clink`/Chromium smoke. Local Node passes 817/817 and package dry run includes the CLI. Release preflight still fails with empty `NPM_TOKEN`; npm returns E404, and Docker Hub publishing is unset. | [#54](https://github.com/konard/vietnam-accomodation-search/issues/54) publishes and verifies one immutable identity.                                                                   |
| SRC-2, PARSE-1, PARSE-3, PARSE-5, QA-2 | The retained audit resumed; 881 domain-record and 122 trace shards completed, then one offers shard failed exact `clink` export verification (73 canonical/100 exported links; 1 missing/2 unexpected). No complete 40-source report exists.                          | [#55](https://github.com/konard/vietnam-accomodation-search/issues/55) fixes the mismatch without weakening LiNo authority, then completes/repeats human-reviewed 40-source acceptance. |
| WEB-2                                  | One current polite live run passed 10/10 VI/EN/RU routes with 224 cards, 1,607/1,607 segments consumed, zero incomplete cards, and zero missing semantic checks.                                                                                                      | [#58](https://github.com/konard/vietnam-accomodation-search/issues/58) repeats the complete cohort twice on the immutable release.                                                      |
| TG-1, TG-2, QA-4                       | Real bot-only preset/subscription/fresh delivery/restart/search/cleanup passed; pre/post scans found zero test messages. Native mtcute and independent identity pins remain unavailable.                                                                              | [#56](https://github.com/konard/vietnam-accomodation-search/issues/56) runs the protected user-only/combined/fallback matrix.                                                           |
| DEP-2, DEP-4                           | The exact local image passed smoke. The previous candidate passed host-bind durability but measured a 3,691 ms sampled readiness gap; `getMe` was not message-continuity evidence. No current-commit failed-candidate drill was run.                                  | [#57](https://github.com/konard/vietnam-accomodation-search/issues/57) proves message-level single-poller handoff, automatic restoration, and retained data on the published target.    |
| FINAL-1                                | Candidate successes and failures are recorded with sanitized aggregates; no immutable target or complete privacy-safe comparison exists.                                                                                                                              | [#58](https://github.com/konard/vietnam-accomodation-search/issues/58) performs the exact-release acceptance audit after #54–#57.                                                       |

The 2026-09-28 delta and detailed matrix below preserve earlier candidate
observations and contracts. This 2026-09-29 section is the current status where
those historical cells differ; a green synthetic test never substitutes for
the failed real corpus or an unpublished release.

## Latest acceptance delta — 2026-09-28

| Requirement group             | Latest candidate observation                                                                                                                                                                                                                                                          | Remaining gate                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEP-1, REL-1, FINAL-1         | Local package dry run includes the CLI; CI release preflight failed with empty `NPM_TOKEN`; no npm package, Git tag, GitHub Release, or OCI digest.                                                                                                                                   | Bootstrap publication and retest one immutable identity under [#39](https://github.com/konard/vietnam-accomodation-search/issues/39) and [#16](https://github.com/konard/vietnam-accomodation-search/issues/16).                                               |
| DEP-2, DEP-4                  | First deploy, same-bind redeploy, exact rollback, and fresh-container host-bind recovery passed. A 48-sample probe observed two failed `/ready` samples and a 3,691 ms maximum interruption. `getMe` stayed available but is not app-message continuity evidence.                     | The macOS login-shell fake-Docker fixture is repaired in PR #53; prove one poller/no lost or duplicated update, failed-candidate automatic restore, and immutable image behavior under [#41](https://github.com/konard/vietnam-accomodation-search/issues/41). |
| WEB-2, PARSE-5                | Two consecutive live Browser Commander passes each achieved 10/10 VI/EN/RU routes, 224 cards, 1,607/1,607 consumed segments, and zero incomplete cards.                                                                                                                               | Repeat on the exact immutable release under [#40](https://github.com/konard/vietnam-accomodation-search/issues/40); Telegram parsing remains separately open.                                                                                                  |
| TG-1, TG-2, QA-4              | Real bot-only conversation, fresh delivery, restart deduplication, and cleanup passed with zero leftover test messages.                                                                                                                                                               | Native mtcute user-only/combined/degraded modes, independent pins, and capability fallback under [#42](https://github.com/konard/vietnam-accomodation-search/issues/42).                                                                                       |
| SRC-2, PARSE-1, PARSE-3, QA-2 | Retained private source journal/checkpoint resumed, but binary projection timed out at 600 seconds without a report. PR #53 shards the projection (synthetic 42,001 links: 76.7 s cold, 9.9 s after one edit) and lifts the 10 MiB parser limit; not yet rerun on the private corpus. | Complete and review the 40-source/two-month audit, typed-link binary mirror, and second run under [#43](https://github.com/konard/vietnam-accomodation-search/issues/43).                                                                                      |

The matrix below preserves detailed contracts and earlier observations; where
an earlier candidate result conflicts with this delta, the linked 2026-09-28
case study is the latest evidence. None of these candidate checks substitutes
for an immutable-release acceptance run.

Status meanings:

- **Verified** — current code, automated regression evidence, and documentation
  exist; a live observation is also linked where the requirement needs one.
- **Verified (degraded)** — the implemented contract and tests pass, and the
  current environment demonstrated the documented no-credential or mutable-site
  behavior rather than fabricating an unavailable live result.
- **Implemented; live/release pending** — the production contract and automated
  checks exist, but the explicitly required credentialed or immutable-release
  acceptance gate has not passed.
- **Open gap** — current source or live evidence fails the requirement; the
  linked issue is required work, not optional hardening.
- **Historical gap** — a preserved live baseline found source/content behavior
  that cannot honestly be rewritten as a post-change success.

## Requirement matrix

| ID       | Requirement                                                                                                                       | Status                                                | Current contract and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEP-1    | Reproducible Node 22+ local/production image with Docker-managed external persistence and runtime secrets                         | Open gap                                              | The `0.12.3` image at `606ffa9` had correct OCI identity, Tini, UID/GID 1000, Rust `clink` 0.2.10, and a working browser. PR #51 passes the real Docker label Go-template argument with both locked and newer `command-stream`; the historical local failure is not reproduced on this branch. A published immutable image and exact-target drill remain [#41](https://github.com/konard/vietnam-accomodation-search/issues/41).                                                                                                                                                        |
| DEP-2    | Serialized candidate preflight, shortest non-overlap handoff, readiness, exact-image rollback                                     | Open gap                                              | The 2026-09-27 isolated first deploy, same-bind redeploy, readiness, and exact-image rollback passed with real bot preflight. Continuous `/ready` plus Bot API interruption measurement, failed-candidate restoration, and immutable-digest repetition remain [#41](https://github.com/konard/vietnam-accomodation-search/issues/41).                                                                                                                                                                                                                                                   |
| DEP-3    | Drain commands/subscriptions and close Bot API, MTProto, browsers, storage, health                                                | Verified                                              | Deadline and signal suites exercise polling settlement, middleware drain, resource order, timeouts, and aggregated cleanup errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| DEP-4    | Operator-owned host/application data directory survives container, volume, Compose, and Docker removal                            | Verified on candidate                                 | The 2026-09-27 `0.12.3` drill again preserved LiNo/binary state, media, preset, subscription, delivery, and update cursors through version upgrade, redeploy, rollback, and removal of the isolated Compose container/network while retaining the host bind. Immutable released-image recovery remains [#39](https://github.com/konard/vietnam-accomodation-search/issues/39) and [#41](https://github.com/konard/vietnam-accomodation-search/issues/41).                                                                                                                               |
| TG-1     | Bot-only, user-only background/CLI, combined bot-first safe fallback                                                              | Implemented; live pending                             | The corrected real bot-only conversation passes. User-only, native combined, degraded combined, and capability-by-capability fallback evidence remains in [#42](https://github.com/konard/vietnam-accomodation-search/issues/42).                                                                                                                                                                                                                                                                                                                                                       |
| TG-2     | Independent no-poll identity preflight and numeric principal pins                                                                 | Implemented; live pending                             | Bot/user pin logic passes automated tests, but local credentials lack independent expected identity pins and the available user session is GramJS, not native mtcute. [#42](https://github.com/konard/vietnam-accomodation-search/issues/42) owns live acceptance.                                                                                                                                                                                                                                                                                                                      |
| TG-3     | Secure login/session lifecycle, hidden 2FA, QR/injection, explicit destination, `0600`, atomic writes, rotation/logout, redaction | Verified                                              | Auth/session/redaction/storage/no-argv-secret suites and `telegram.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TG-4     | Numeric authorization, fail-closed privilege, public/private modes, limits                                                        | Verified                                              | Central access middleware, privilege matrix, and per-user/chat rate-limit tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| TG-5     | Typed failures, bounded retry, no ambiguous replay, update/edit dedup, redacted logs, health                                      | Verified                                              | Telegram error/retry/dedup/runtime suites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| SRC-1    | 20 ranked web, 20 ranked nationwide Telegram, independent Nha Trang cohort                                                        | Verified (degraded)                                   | Seed/ranking suites plus preserved timestamped live cohort; popularity is intentionally treated as volatile. The 2026-10-05 product-path cohort disabled 21 of 29 web seeds that returned no offers in every run (empty, landing, consent wall, challenge, collection failure), so 8 web sources are enabled; see [issue 100](case-studies/issue-100/README.md).                                                                                                                                                                                                                        |
| SRC-2    | Up to 40 deduplicated multilingual Nha Trang communities with popularity evidence                                                 | Open gap                                              | Historical evidence found 44 candidates and selected 40. The 2026-09-27 `0.12.3` credentialed resume reused its journal but again failed during the first source's binary projection and emitted no final source count, so current complete-cohort evidence remains [#43](https://github.com/konard/vietnam-accomodation-search/issues/43).                                                                                                                                                                                                                                             |
| SRC-3    | Seed from `Нячанг жильё`; unconditionally exclude one-to-one/private-message dialogs                                              | Verified                                              | Preserved live audit ignored all returned `User` dialogs; current filter regression pins the rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| SRC-4    | `/update_sources` persists multilingual metric/value/evidence URL/time; never auto-joins private sources                          | Verified (degraded)                                   | Handler/storage/policy tests pass; live refresh requires operator credentials and current network sources.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| PARSE-1  | Strict two-month history plus continuous topics/albums/media/edit/delete/migration/pin/service events                             | Open gap                                              | The 2026-09-27 `0.12.3` run reused the retained private journal/checkpoint without recollecting its window. Projection still timed out at 600 seconds before completing the first source, so complete restartable ingestion remains [#43](https://github.com/konard/vietnam-accomodation-search/issues/43).                                                                                                                                                                                                                                                                             |
| PARSE-2  | Exclude unrelated/request/sale/out-of-location posts                                                                              | Verified (degraded)                                   | Reviewed multilingual classification/corpus regressions cover current rules. The preserved pre-change false-positive audit remains a historical non-success, and the post-change credentialed rerun is pending.                                                                                                                                                                                                                                                                                                                                                                         |
| PARSE-3  | Parse every human-confirmed offer/useful detail, retaining unknowns                                                               | Open gap                                              | Corpus tests pass, but no fresh complete-window result exists because the real audit did not finish. The required human-reviewed 40-source acceptance and anonymized misses remain in [#43](https://github.com/konard/vietnam-accomodation-search/issues/43).                                                                                                                                                                                                                                                                                                                           |
| PARSE-4  | Albums as one offer, up to ten photos, media-only bounded OCR or degraded status                                                  | Verified                                              | Album/media grouping, ten-photo delivery, and explicit degraded-media suites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PARSE-5  | Every meaningful segment consumed, retained unknown, or actionable error                                                          | Open gap                                              | PR #51 candidate Browser Commander runs account for all segments across ten VI/EN/RU sources with zero incomplete cards; the [Issue #50 ledger](case-studies/issue-50/README.md) records each route. Exact-release repetition remains [#40](https://github.com/konard/vietnam-accomodation-search/issues/40). Telegram still has no final forty-source report and remains [#43](https://github.com/konard/vietnam-accomodation-search/issues/43).                                                                                                                                       |
| WEB-1    | Browser Commander UI rather than private APIs                                                                                     | Verified                                              | Code boundary, navigation tests, and explicit live/manual harness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| WEB-2    | Multilingual ranked Vietnamese real-estate sites with rental-intent adapters                                                      | Implemented; live/release pending                     | PR #51 replaces the three challenged routes and two semantically incomplete routes with five verified Nha Trang rental routes. Two complete mutable-candidate Browser Commander runs pass 10/10 with 5 Vietnamese, 2 English, and 3 Russian sources; [Issue #50](case-studies/issue-50/README.md#40-ten-route-vienru-browser-commander-audit) records aggregate evidence. The exact immutable-release repeat remains [#40](https://github.com/konard/vietnam-accomodation-search/issues/40).                                                                                            |
| WEB-3    | Per-domain serialization, jitter/backoff/challenge detection, cross-domain bounds                                                 | Verified on candidate                                 | Production defaults are configurable 3–8 seconds; navigation, extraction, and classification run inside one per-domain scheduler. Persistent retry-after/exponential cooldowns stop challenged domains without blocking unrelated domains. The live cohort ran three independent domains concurrently, and a challenged fourth domain persisted its non-pass cooldown across process restarts.                                                                                                                                                                                          |
| SEARCH-1 | `/search --cheapest 1..50`, refresh, VND/period normalization, all types                                                          | Verified                                              | Command/pricing/search suites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SEARCH-2 | Independent room/total/per-room/per-bed bounds and explicit missing/studio semantics                                              | Verified                                              | Parser/matcher tests cover each one/two-sided range, alias, invalid range, and missing denominator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SEARCH-3 | Named presets, one global active preset, switch/save/delete, non-mutating overrides                                               | Verified                                              | Command/service/persistence/restart suites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| SUB-1    | `/subscribe [PRESET]`, active default, restart, unsubscribe/status                                                                | Verified                                              | Bot handler, service, and restart suites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| SUB-2    | Fresh unseen-only feed, stable aliases, post-send marking, partial recovery, grouping/backpressure                                | Verified                                              | Delivery failure/suffix resume, search suppression, alias, fake-time grouping/no-overlap/bounds suites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| LINK-1   | Canonical LiNo plus transactional `clink` storage and deterministic repair                                                        | Open scalability gap (sharded; private rerun pending) | Correctness, crash, hash, and repair suites pass with Rust `clink` 0.2.10. The real 16 MiB projection exceeded the 600-second deadline because `clink` import is quadratic and the text exceeded the 10 MiB parser default. PR #53 projects collections as verified content-defined shards with digest reuse and resumable retries, parses with an explicit bound, and decodes in linear time ([Issue #52 ledger](case-studies/issue-52/README.md)); [#43](https://github.com/konard/vietnam-accomodation-search/issues/43) still needs the private rerun within the documented budget. |
| LINK-2   | All entities/details/provenance as addressable typed links rather than opaque-only JSON                                           | Verified                                              | Associative v2 schema/query/property fixtures, including raw/unknown escape hatch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| LINK-3   | Shared 10 GiB budget, remote-link-preserving eviction, crash/lock/backup/restore/migration/query                                  | Verified                                              | Budget/media, multiprocess/stale-lock, migration, corruption/recovery, delete, and query suites plus `storage.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| STACK-1  | Requested orchestration stack and Browser Commander boundary                                                                      | Verified                                              | Production scripts/tests exercise `use-m`, `command-stream`, `lino-arguments`; browser boundary is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OBS-1    | Correlated redacted collection/parse/storage/delivery traces and replay evidence                                                  | Verified                                              | A shared bounded `TraceRecorder` now correlates collection, normalization, search, subscription matching, and delivery; typed LiNo persistence, recursive redaction, segment ledgers, and drop notices have regression coverage.                                                                                                                                                                                                                                                                                                                                                        |
| QA-1     | Reusable experiments; no committed Telegram secrets/raw reports                                                                   | Verified                                              | Manual harnesses live under `experiments/`; secret scans and ignored `0600` environment rules pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| QA-2     | Compare privacy-safe audit with baseline                                                                                          | Open gap                                              | The 2026-09-27 `0.12.3` attempt again proves the pre-projection checkpoint survives and is reused, and repeats the browser result, but the first-source projection timeout still prevents a complete Telegram comparison. [#43](https://github.com/konard/vietnam-accomodation-search/issues/43) owns completion.                                                                                                                                                                                                                                                                       |
| QA-3     | Real-data Telegram/browser E2E only by explicit invocation, never normal CI                                                       | Verified                                              | Harnesses refuse CI and are absent from automated npm/workflow test commands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| QA-4     | Real user session drives bot commands, restart, persistence, no-duplicate, and cleanup                                            | Verified bot-only; native pending                     | The 2026-09-27 bot-only conversation passed with no unexpected reply, duplicate, or stale message; cleanup-only found zero remnants before and after. Native user-only/combined production modes remain in [#42](https://github.com/konard/vietnam-accomodation-search/issues/42).                                                                                                                                                                                                                                                                                                      |
| FINAL-1  | Revalidate Issue #1 with code, tests, and sanitized live/degraded evidence                                                        | Open gap                                              | The [`0.12.3` baseline](case-studies/revalidation-2026-09-27/README.md) recorded 790/791 local Node tests, npm `ENEEDAUTH`, 5/10 browser sources, pending native Telegram modes, and a first-source projection timeout. PR #51 repairs the tested packaging, local argv, and mutable browser cohort, as detailed in [Issue #50](case-studies/issue-50/README.md); immutable publication, Telegram, deploy handoff, and exact-release audit remain [#16](https://github.com/konard/vietnam-accomodation-search/issues/16) and [#39–#43](case-studies/issue-50/README.md).                |

## Issue #20 focused contracts

The exhaustive numbered inventory, design alternatives, code ownership, and
evidence state for Issues #12–#19 is maintained in
[`issue-20-requirements-and-design.md`](issue-20-requirements-and-design.md).
The key added contracts are:

| Issue | Added production boundary                                                                                                    | Evidence state                                                                                                                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #12   | Composed Telegram discovery, discriminator-first private-user rejection, separate Nha Trang 40/source top-20 cohorts         | Automated; historical baseline retained; fresh complete run blocked by [#43](https://github.com/konard/vietnam-accomodation-search/issues/43)                                                                     |
| #13   | Versioned reviewed corpus, relevance-before-extraction, album/OCR reconciliation, stateful segment accounting                | Automated; full audited-window acceptance blocked by [#43](https://github.com/konard/vietnam-accomodation-search/issues/43)                                                                                       |
| #14   | Versioned domain graph and semantic states, direct associative LiNo round-trip/query, private-field rejection                | Automated                                                                                                                                                                                                         |
| #15   | Explicit mtcute session envelope/format, safe native migration, GramJS re-login boundary, classified status                  | Automated; native identity-pinned live modes remain [#42](https://github.com/konard/vietnam-accomodation-search/issues/42)                                                                                        |
| #16   | Schema-v2 cross-artifact release identity, exact-tag candidate retest, evidence integrity/comparison/manual boundary         | Automated contract; run 36211660562 created `0.12.3` but failed npm publication with `ENEEDAUTH`, and no immutable release exists; remains [#39](https://github.com/konard/vietnam-accomodation-search/issues/39) |
| #17   | Versioned domain adapters, actual-language detection, typed page failures, polite domain scheduler, unsafe route disablement | Automated; candidate complete-cohort pass, exact-release repeat remains [#40](https://github.com/konard/vietnam-accomodation-search/issues/40)                                                                    |
| #18   | Shared redacted run/stage traces, safe segment hashes, bounded retention/drop notice, LiNo persistence                       | Automated; real-data runners remain explicit/manual                                                                                                                                                               |
| #19   | Optional-by-default Pages policy, early preflight, separate build/deploy, least-privilege permissions                        | Automated; PR workflow rerun provides immutable run evidence                                                                                                                                                      |

## Telegram reference practices

The production implementation adopts and tightens the strongest patterns from
the three issue-linked repositories:

- `telegram-bot`: interactive phone/code/2FA, cleanup in `finally`, local help
  parsing, flood-wait handling, and broad event/entity extraction;
- `follow`: hidden 2FA, first-run sessions, reusable connected user clients,
  bounded entity refresh/retry, and aggregated cleanup;
- `telegram-terminal-bot`: credential validation, authorization middleware,
  bot-level errors, signals, and startup hooks.

This project additionally forbids retry/fallback of ambiguous non-idempotent
sends, raw private-update logging, implicit plaintext session writes, username-
only authorization, automatic joining, and automatic owner contact.

## Evidence policy

Automated evidence is rerunnable on Node, Bun, Deno, and the production image.
Real-data harnesses require explicit local invocation and refuse CI. Mutable
popularity/site observations retain timestamps. Credentialed transcripts stay
sanitized, and a missing secret or inaccessible Telegram capability is reported
as a precise degraded state. Historical failures stay historical failures; the
matrix never converts an old observation into a new success merely because a
unit test exists.
