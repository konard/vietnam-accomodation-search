# Product requirement traceability

This is the durable checklist for requirements originating in
[Issue #1](https://github.com/konard/vietnam-accomodation-search/issues/1) and
implemented by umbrella Issue #10 and extended by
[Issue #20](https://github.com/konard/vietnam-accomodation-search/issues/20).
The previous version described the pre-implementation handoff; PR #11
completed the original production contracts, while PR #21 closes the focused
discovery, parsing, graph, session, release-audit, browser, observability, and
Pages gaps in Issues #12–#19. Historical audits remain evidence of what was
observed at their recorded commit, including failures.

Status meanings:

- **Verified** — current code, automated regression evidence, and documentation
  exist; a live observation is also linked where the requirement needs one.
- **Verified (degraded)** — the implemented contract and tests pass, and the
  current environment demonstrated the documented no-credential or mutable-site
  behavior rather than fabricating an unavailable live result.
- **Historical gap** — a preserved live baseline found source/content behavior
  that cannot honestly be rewritten as a post-change success.

## Requirement matrix

| ID       | Requirement                                                                                                                       | Status              | Current contract and evidence                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEP-1    | Reproducible Node 22+ local/production image with external persistent data and secrets                                            | Verified            | Digest-pinned non-root Dockerfile, hardened Compose, local image CLI/browser/`clink`/storage/health smoke, and `deployment.md`.                                                                                                     |
| DEP-2    | Serialized candidate preflight, shortest non-overlap handoff, readiness, exact-image rollback                                     | Verified (degraded) | Deployment transition/lock/rollback suites pass. A live token handoff was not attempted without operator credentials.                                                                                                               |
| DEP-3    | Drain commands/subscriptions and close Bot API, MTProto, browsers, storage, health                                                | Verified            | Deadline and signal suites exercise polling settlement, middleware drain, resource order, timeouts, and aggregated cleanup errors.                                                                                                  |
| TG-1     | Bot-only, user-only background/CLI, combined bot-first safe fallback                                                              | Verified            | Capability matrix and router tests cover every operation/credential mode and reject ambiguous-send fallback.                                                                                                                        |
| TG-2     | Independent no-poll identity preflight and numeric principal pins                                                                 | Verified (degraded) | Preserved live audit validated both configured identities; current environment correctly exits before polling because no credentials were supplied.                                                                                 |
| TG-3     | Secure login/session lifecycle, hidden 2FA, QR/injection, explicit destination, `0600`, atomic writes, rotation/logout, redaction | Verified            | Auth/session/redaction/storage/no-argv-secret suites and `telegram.md`.                                                                                                                                                             |
| TG-4     | Numeric authorization, fail-closed privilege, public/private modes, limits                                                        | Verified            | Central access middleware, privilege matrix, and per-user/chat rate-limit tests.                                                                                                                                                    |
| TG-5     | Typed failures, bounded retry, no ambiguous replay, update/edit dedup, redacted logs, health                                      | Verified            | Telegram error/retry/dedup/runtime suites.                                                                                                                                                                                          |
| SRC-1    | 20 ranked web, 20 ranked nationwide Telegram, independent Nha Trang cohort                                                        | Verified (degraded) | Seed/ranking suites plus preserved timestamped live cohort; popularity is intentionally treated as volatile.                                                                                                                        |
| SRC-2    | Up to 40 deduplicated multilingual Nha Trang communities with popularity evidence                                                 | Verified            | Preserved credentialed audit found 44 candidates and selected 40; source discovery/ranking persistence now has regression coverage.                                                                                                 |
| SRC-3    | Seed from `Нячанг жильё`; unconditionally exclude one-to-one/private-message dialogs                                              | Verified            | Preserved live audit ignored all returned `User` dialogs; current filter regression pins the rule.                                                                                                                                  |
| SRC-4    | `/update_sources` persists multilingual metric/value/evidence URL/time; never auto-joins private sources                          | Verified (degraded) | Handler/storage/policy tests pass; live refresh requires operator credentials and current network sources.                                                                                                                          |
| PARSE-1  | Strict two-month history plus continuous topics/albums/media/edit/delete/migration/pin/service events                             | Verified            | History cutoff and event-adapter suites cover the complete path through the shared normalizer; the preserved audit supplies bounded live history evidence.                                                                          |
| PARSE-2  | Exclude unrelated/request/sale/out-of-location posts                                                                              | Verified (degraded) | Reviewed multilingual classification/corpus regressions cover current rules. The preserved pre-change false-positive audit remains a historical non-success, and the post-change credentialed rerun is pending.                     |
| PARSE-3  | Parse every human-confirmed offer/useful detail, retaining unknowns                                                               | Verified (degraded) | Typed/raw/unknown round trips and reviewed EN/RU/VI fixtures pass. The older live corpus documents missed content; audited-window 100% recall remains pending rather than inferred from fixtures.                                   |
| PARSE-4  | Albums as one offer, up to ten photos, media-only bounded OCR or degraded status                                                  | Verified            | Album/media grouping, ten-photo delivery, and explicit degraded-media suites.                                                                                                                                                       |
| PARSE-5  | Every meaningful segment consumed, retained unknown, or actionable error                                                          | Verified (degraded) | Stable hash/length/position ledgers enforce mapped, reviewed-unknown, or error accounting. The older browser/Telegram audit retains its unconsumed-segment findings; a post-change live rerun is pending.                           |
| WEB-1    | Browser Commander UI rather than private APIs                                                                                     | Verified            | Code boundary, navigation tests, and explicit live/manual harness.                                                                                                                                                                  |
| WEB-2    | Multilingual ranked Vietnamese real-estate sites with rental-intent adapters                                                      | Verified (degraded) | Manifest/adapters and multilingual/rental route tests pass; current public smoke completed with no harness failure but selected page yielded no offers.                                                                             |
| WEB-3    | Per-domain serialization, jitter/backoff/challenge detection, cross-domain bounds                                                 | Verified            | Scheduler and challenge/backoff suites plus preserved live challenge observations.                                                                                                                                                  |
| SEARCH-1 | `/search --cheapest 1..50`, refresh, VND/period normalization, all types                                                          | Verified            | Command/pricing/search suites.                                                                                                                                                                                                      |
| SEARCH-2 | Independent room/total/per-room/per-bed bounds and explicit missing/studio semantics                                              | Verified            | Parser/matcher tests cover each one/two-sided range, alias, invalid range, and missing denominator.                                                                                                                                 |
| SEARCH-3 | Named presets, one global active preset, switch/save/delete, non-mutating overrides                                               | Verified            | Command/service/persistence/restart suites.                                                                                                                                                                                         |
| SUB-1    | `/subscribe [PRESET]`, active default, restart, unsubscribe/status                                                                | Verified            | Bot handler, service, and restart suites.                                                                                                                                                                                           |
| SUB-2    | Fresh unseen-only feed, stable aliases, post-send marking, partial recovery, grouping/backpressure                                | Verified            | Delivery failure/suffix resume, search suppression, alias, fake-time grouping/no-overlap/bounds suites.                                                                                                                             |
| LINK-1   | Canonical LiNo plus transactional `clink` storage and deterministic repair                                                        | Verified            | Real `clink`, hash, kill-point, pointer rebuild, deterministic round-trip tests.                                                                                                                                                    |
| LINK-2   | All entities/details/provenance as addressable typed links rather than opaque-only JSON                                           | Verified            | Associative v2 schema/query/property fixtures, including raw/unknown escape hatch.                                                                                                                                                  |
| LINK-3   | Shared 10 GiB budget, remote-link-preserving eviction, crash/lock/backup/restore/migration/query                                  | Verified            | Budget/media, multiprocess/stale-lock, migration, corruption/recovery, delete, and query suites plus `storage.md`.                                                                                                                  |
| STACK-1  | Requested orchestration stack and Browser Commander boundary                                                                      | Verified            | Production scripts/tests exercise `use-m`, `command-stream`, `lino-arguments`; browser boundary is unchanged.                                                                                                                       |
| OBS-1    | Correlated redacted collection/parse/storage/delivery traces and replay evidence                                                  | Verified            | A shared bounded `TraceRecorder` now correlates collection, normalization, search, subscription matching, and delivery; typed LiNo persistence, recursive redaction, segment ledgers, and drop notices have regression coverage.    |
| QA-1     | Reusable experiments; no committed Telegram secrets/raw reports                                                                   | Verified            | Manual harnesses live under `experiments/`; secret scans and ignored `0600` environment rules pass.                                                                                                                                 |
| QA-2     | Compare privacy-safe audit with baseline                                                                                          | Verified (degraded) | Current public and no-credential probes are recorded next to the preserved authorized baseline; private rerun is operator-dependent.                                                                                                |
| QA-3     | Real-data Telegram/browser E2E only by explicit invocation, never normal CI                                                       | Verified            | Harnesses refuse CI and are absent from automated npm/workflow test commands.                                                                                                                                                       |
| FINAL-1  | Revalidate Issue #1 with code, tests, and sanitized live/degraded evidence                                                        | Verified (degraded) | [`issue-1-revalidation`](case-studies/issue-1-revalidation/README.md) records exact local/runtime evidence, historical live observations, and every unavailable capability. Historical parser gaps above remain explicitly visible. |

## Issue #20 focused contracts

The exhaustive numbered inventory, design alternatives, code ownership, and
evidence state for Issues #12–#19 is maintained in
[`issue-20-requirements-and-design.md`](issue-20-requirements-and-design.md).
The key added contracts are:

| Issue | Added production boundary                                                                                                    | Evidence state                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| #12   | Composed Telegram discovery, discriminator-first private-user rejection, separate Nha Trang 40/source top-20 cohorts         | Automated; historical 40-source live baseline retained; credentialed rerun pending |
| #13   | Versioned reviewed corpus, relevance-before-extraction, album/OCR reconciliation, stateful segment accounting                | Automated; full audited-window rerun pending                                       |
| #14   | Versioned domain graph and semantic states, direct associative LiNo round-trip/query, private-field rejection                | Automated                                                                          |
| #15   | Explicit mtcute session envelope/format, safe native migration, GramJS re-login boundary, classified status                  | Automated; live dual-identity preflight pending operator credentials               |
| #16   | Immutable release audit schema/comparison/manual boundary and pending-changeset release detection                            | Automated; no GitHub Release currently exists, so next-release audit pending       |
| #17   | Versioned domain adapters, actual-language detection, typed page failures, polite domain scheduler, unsafe route disablement | Automated; mutable public-site rerun pending                                       |
| #18   | Shared redacted run/stage traces, safe segment hashes, bounded retention/drop notice, LiNo persistence                       | Automated; real-data runners remain explicit/manual                                |
| #19   | Optional-by-default Pages policy, early preflight, separate build/deploy, least-privilege permissions                        | Automated; PR workflow rerun provides immutable run evidence                       |

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
