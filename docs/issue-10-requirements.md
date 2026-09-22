# Issue 10 requirement and solution map

This is the exhaustive implementation map for umbrella issue #10 and its seven
sub-issues. It was produced after reading every issue body and comment (there
were no issue comments), all three kinds of PR #11 feedback (none existed), the
current codebase, the linked reference implementations, and the upstream
documentation listed below. “Verified” means the implementation has a durable
automated check; credential- or Internet-dependent observations are called out
separately and are never inferred from a unit test.

## Existing components and design choices

| Problem                    | Reused component or contract                                  | Selected use and alternative                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Associative binary storage | `link-cli` 0.2.10 (`clink`)                                   | Import/export a canonical two-value LiNo snapshot and verify its hash. A custom binary format was rejected because it would not exercise the requested stack.                 |
| Browser automation         | `browser-commander` + Playwright Chromium                     | Keep browser UI navigation as the only web boundary. Private marketplace APIs were rejected.                                                                                  |
| Bot runtime                | grammY                                                        | Use `bot.catch`, awaited startup/stop, and Bot API error metadata; immediate `process.exit()` shutdown was rejected.                                                          |
| User transport             | mtcute                                                        | Use explicit sign-in callbacks, connected-client lifecycle, history/update APIs, and classified RPC failures. Supplying a session only through `.env` was rejected.           |
| Orchestration              | `use-m`, `command-stream`, `lino-arguments`                   | Use the repository's established loader/process/argument conventions in deployment and maintenance paths instead of an unstructured shell script.                             |
| Containers                 | digest-pinned Node image, Playwright install, `tini`, Compose | Keep the runtime reproducible and non-root. The larger Playwright image is a valid alternative but obscures the exact dependency installation this issue asks CI to exercise. |

## Issue #3 — production container and redeploy

### Required implementation

| ID  | Requirement                                                                                                                                                                        | Implemented solution and evidence                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Reproducible multi-architecture Node 22+ image; exact Chromium dependencies; non-root user; init; writable data volume; OCI metadata; bounded health check; no layered credentials | Digest-pinned multi-stage `Dockerfile`, `playwright install --with-deps chromium`, `tini`, runtime `node` user, `/data`, OCI labels, and bounded `/live` health probe. Docker structural tests prevent copying env/session material.                                                                             |
| 3.2 | `.dockerignore` and hardened Compose with named persistence, env file, restart, health, grace period, and localhost-only health port                                               | `.dockerignore` plus `compose.yaml` provide a read-only root, dropped capabilities, named state volume, required env file, restart/grace/health settings, and `127.0.0.1` binding.                                                                                                                               |
| 3.3 | One command for deploy/status/logs/stop/rollback, following the requested orchestration conventions                                                                                | `scripts/deploy.mjs` exposes every action, loads dependencies through `use-m`, parses through `lino-arguments`, and executes through `command-stream`.                                                                                                                                                           |
| 3.4 | Candidate build/pull and smoke/preflight while old bot stays live; shortest serialized non-overlapping handoff; automatic rollback                                                 | The deployment state machine uniquely tags and smokes the candidate, takes an exclusive deployment lock, preflights without polling, stops the prior poller only at cutover, verifies readiness, and restores the exact prior image ID on failure.                                                               |
| 3.5 | Readiness only after auth/poll initialization; orderly signal drain of scheduler, bot, middleware, browser, MTProto, storage, health server                                        | `runtime.js` separates liveness/readiness, turns readiness off first, uses deadline-bounded drains, awaits polling settlement and aggregates cleanup errors.                                                                                                                                                     |
| 3.6 | Credential preflight without `getUpdates` or secret output                                                                                                                         | `telegram preflight` independently validates configured identities and storage, supports expected numeric-ID pins, and uses the shared redactor. The no-credential probe exits before polling.                                                                                                                   |
| 3.7 | CI image build plus CLI, browser, clink, storage, and health smoke; retain amd64/arm64 publishing                                                                                  | The Docker workflow builds the image and runs each image-level smoke. The existing native manifest publication matrix remains intact.                                                                                                                                                                            |
| 3.8 | Document Docker Hub variables/secrets and verify `latest` and immutable manifests                                                                                                  | `deployment.md` documents `DOCKERHUB_IMAGE`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, manifest checks, local/published flows, backups, restore, logs, and handoff. This repository currently has none of those GitHub settings, so a published application manifest cannot truthfully be asserted from this run. |

### Acceptance and failure cases

- 3.A Fresh-clone/one-command behavior and persistent state are covered by
  Compose rendering, container health, and named-volume tests.
- 3.B A broken offline candidate is rejected before cutover.
- 3.C A post-cutover readiness failure restores the exact prior image ID.
- 3.D Signal tests prove cleanup finishes within the configured deadline.
- 3.E Docker build, Compose validation, deployment transition, and rollback
  checks are in the automated suites and image smoke workflow.
- 3.F README and `deployment.md` cover local/published deployment, redeploy,
  rollback, logs, backup/restore, and the unavoidable single-poller handoff.

## Issue #4 — canonical LiNo and transactional binary storage

### Required implementation

| ID  | Requirement                                                                                               | Implemented solution and evidence                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Non-opaque associative schema for every named entity and relationship                                     | Associative v2 emits addressable typed field/path links for sources, messages, albums, media, offers/variants/observations, identities/contacts, presets, subscriptions, shown deliveries, and transport provenance. |
| 4.2 | Canonical inspectable text plus file-mapped doublets; authority/hash/recovery rules                       | Canonical fsynced LiNo is authoritative; immutable hash-named `clink` snapshots and an atomic pointer form the binary projection. Hash/version metadata selects or repairs a complete projection.                    |
| 4.3 | Synchronous transactions, text fsync/rename/directory fsync, in-process serialization, cross-process lock | The write queue and owner-aware filesystem lock enclose read/merge/stage/commit/activate. `clink` import/export and text commits run with synchronous durability boundaries.                                         |
| 4.4 | Two-value compatibility, deterministic lossless round trip, and deletion parity                           | Every emitted link has two values. Fixture/property tests cover object → LiNo → clink → LiNo → object, deterministic ordering, binary rebuild, eviction, and delete.                                                 |
| 4.5 | Typed representation plus lossless raw/unknown escape hatch                                               | Semantic fields are queryable links; raw records, unrecognized labels, and source values remain losslessly addressable rather than being discarded.                                                                  |
| 4.6 | One 10 GiB budget across all projections and media; preserve remote photo URLs                            | Budget accounting covers text, snapshots, recovery/version state, offers, and media. Compaction removes old snapshots and evicts oldest local media only.                                                            |
| 4.7 | Production/local `clink`; binary failure must surface and repair                                          | The image installs exact `link-cli` 0.2.10, local setup is documented, preflight is explicit, failed stages do not publish text, and missing/corrupt mirrors repair from verified canonical data.                    |
| 4.8 | Use the requested stack for maintenance and retain Browser Commander                                      | Maintenance/deployment use the requested loader/argument/process stack; browser collection remains browser-driven.                                                                                                   |
| 4.9 | Document migration, backup/restore, corruption, compaction, locks, recovery                               | `storage.md` documents formats, v1/opaque migration, point-in-time procedures, hash checks, lock recovery, compaction, and drills.                                                                                   |

### Acceptance and failure cases

- 4.A Round-trip tests cover every persisted type and a real `clink` process.
- 4.B Kill points cover pre-stage, binary-stage, text-commit, and pointer activation;
  restart chooses or repairs only a complete committed snapshot.
- 4.C Concurrent real processes preserve both writers; dead-owner locks recover.
- 4.D Deletion/eviction keeps text, binary, and budget views consistent.
- 4.E Legacy `offers.lino`, `sources.lino`, opaque records, and associative v1
  migrate without loss on the next write.
- 4.F Relationship queries filter links directly by price, type, location,
  source, preset, and subscription without decoding every raw object.

## Issue #5 — presets, range filters, and unseen subscriptions

### Command and filter requirements

| ID   | Requirement                                                                                 | Implemented solution and evidence                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | `/preset list`                                                                              | Lists the built-in and persisted named presets with the active/subscribed selections identified.                                                                                                                                        |
| 5.2  | `/preset show [NAME]`                                                                       | Resolves the supplied name or active preset and renders all normalized options.                                                                                                                                                         |
| 5.3  | `/preset save NAME [OPTIONS]` merges supplied values over the active preset                 | Partial overrides merge without dropping unspecified active values; supported-script names and invalid options produce actionable errors.                                                                                               |
| 5.4  | `/preset use NAME` makes one preset globally active                                         | The active choice persists per stable numeric user identity.                                                                                                                                                                            |
| 5.5  | `/preset delete NAME` protects `default` and an actively subscribed preset                  | Service invariants reject both protected deletion cases and remove only the selected named record.                                                                                                                                      |
| 5.6  | `/search` uses the active preset; supplied options are non-mutating one-time overrides      | Search merges into an ephemeral option set and records shown aliases only after confirmed result delivery.                                                                                                                              |
| 5.7  | `/subscribe [NAME]` starts/restarts the single subscription with the named or active preset | Subscription choice persists; starting it triggers an immediate non-overlapping scheduler tick.                                                                                                                                         |
| 5.8  | `/unsubscribe` and `/subscription` stop/inspect the subscription                            | Stop is durable and status reports preset/last-success/degraded delivery state.                                                                                                                                                         |
| 5.9  | One or more normalized accommodation types                                                  | `--type`/`--types` parse repeatable/comma-separated values and the shared matcher applies them.                                                                                                                                         |
| 5.10 | Independent min/max room count                                                              | `--min-rooms`/`--max-rooms`, including either bound alone and inverted-range rejection.                                                                                                                                                 |
| 5.11 | Independent min/max total VND                                                               | Both `--min-total-price` aliases and the documented `--min-total-vnd` form are accepted, with matching max options.                                                                                                                     |
| 5.12 | Independent min/max VND per room                                                            | Total VND divided by the explicit room count; absent/zero counts do not invent a match.                                                                                                                                                 |
| 5.13 | Independent min/max VND per bed                                                             | Total VND divided by explicit bed count, distinct from bedrooms/rooms.                                                                                                                                                                  |
| 5.14 | Existing labeled-field filters                                                              | Existing exact typed/labeled filters compose with the new structured ranges.                                                                                                                                                            |
| 5.15 | Studio, missing count, periods, rooms-versus-bedrooms semantics                             | Studios normalize as the studio type and are not silently treated as one room; missing denominators cannot satisfy derived-price bounds; prices compare only after VND/period normalization; rooms, bedrooms, and beds remain distinct. |

### Feed requirements

| ID   | Requirement                                                                                | Implemented solution and evidence                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.16 | Persist presets, active choice, subscription, last success, bounded per-user shown aliases | All state is typed associative storage; credentials are outside the schema.                                                                                         |
| 5.17 | Fresh matching unseen only; mark after confirmed delivery; partial-batch recovery          | Strict freshness is evaluated at delivery. Each offer is committed shown only after its send succeeds, so restart retries only the unconfirmed suffix.              |
| 5.18 | Stable cross-source identity aliases                                                       | Reconciled canonical IDs plus aliases share one shown identity and prevent resend across transports/sources.                                                        |
| 5.19 | Group identical searches; bounded concurrency/backpressure                                 | Scheduler hashes normalized options, performs one collection per group, bounds work, starts immediately, prevents overlapping ticks, and supports abort/clean stop. |
| 5.20 | Telegram-safe text/media, ten-photo maximum, restart resume                                | Plain-text chunking observes 4096 characters, media groups cap at ten, unsafe parse modes are avoided, and per-offer delivery commits allow resume.                 |
| 5.21 | Same associative store, no credentials                                                     | Presets/subscriptions/shown events use the same v2 Links schema and contain no tokens/sessions.                                                                     |

### Acceptance and failure cases

- 5.A Parser tests cover every one/two-sided bound, invalid/inverted ranges,
  types, studios/missing counts, VND dimensions, merge/override behavior, and
  preset names in supported scripts.
- 5.B Restart tests prove presets, active/subscription choices, last success,
  partial-delivery progress, and shown identities survive redeployment.
- 5.C Delivery tests prove search-to-subscription suppression, retry of a failed
  offer, no replay of a completed prefix, and cross-source alias collapse.
- 5.D Fake-time scheduler tests prove grouping, bounded work/backpressure,
  immediate subscribe refresh, no overlapping cycles, and clean shutdown.
- 5.E Bot and combined modes deliver feeds; user-only mode explicitly reports
  the absent Bot API command/delivery surface while background ingestion works.

## Issue #6 — resilient Telegram runtime

| ID  | Requirement                                                                                               | Implemented solution and evidence                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6.1 | Typed classification of Bot API, transport, MTProto RPC/flood/auth/entity, 409, blocked, malformed errors | `telegram-errors.js` maps these cases to stable types, retryability, ambiguity, capability, and fatal-health fields.                                         |
| 6.2 | Retry safe/idempotent or known pre-send rejection only; obey delays/jitter/cancellation/budgets           | `withTelegramRetry` enforces attempt, elapsed-time, and maximum-delay budgets with abortable waits. Ambiguous non-idempotent sends never retry/fallback.     |
| 6.3 | `bot.catch`, per-update isolation, fatal auth/config exit                                                 | Bot wiring catches at the update boundary, redacts structured diagnostics, and distinguishes degraded per-update failures from fatal unready startup.        |
| 6.4 | Signal drain in the exact required order and deadline                                                     | Runtime rejects new work, marks unready, stops timers/polling, awaits active work, closes browser/MTProto/storage/health resources, and aggregates timeouts. |
| 6.5 | Liveness/readiness and correlated redacted telemetry                                                      | Health and logs carry operation/transport/attempt/delay/source/correlation metadata without raw updates or secrets.                                          |
| 6.6 | Global/per-source bounds and persisted update/edit dedup                                                  | Semaphores bound collection and persisted event keys prevent update/edit replay after restart.                                                               |

### Acceptance and failure cases

- 6.A Deterministic clocks cover flood waits, exponential backoff, jitter,
  cancellation, permanent failure, attempt/time budgets, and ambiguous sends.
- 6.B Signal tests prove middleware drains, polling settles, resources close,
  and shutdown does not force-exit early.
- 6.C Duplicate poller 409, revoked token, expired user session, blocked bot,
  and cleanup timeout produce distinct health/exit classifications.
- 6.D Redaction snapshots cover nested causes, grammY payloads, MTProto errors,
  and structured logs.

## Issue #7 — bot-first capability routing and MTProto ingestion

| ID  | Requirement                                                                                                       | Implemented solution and evidence                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | Typed interface for identity, sends, updates, history, entities, media, membership/visibility, popularity         | The capability matrix declares availability and selected transport for every operation.                                                                             |
| 7.2 | Bot-only, user-only background/CLI, and combined bot-first modes                                                  | Configuration validates each mode independently. Combined routing asks Bot API first and uses user transport only after a classified missing capability/permission. |
| 7.3 | No fallback after ambiguous send; durable idempotency outcomes                                                    | Router persists operation keys/results and refuses unsafe timeout fallback.                                                                                         |
| 7.4 | Bot membership/admin data first; MTProto only for otherwise unavailable history/media/entity/contact capabilities | Per-operation selection encodes that preference and emits degraded decisions. Owner contact always requires explicit authorized action.                             |
| 7.5 | Two-month backfill and continuous topics/albums/media/edit/delete/migration/pin/service updates through one model | `telegram-history.js` enforces the rolling cutoff; live/history event adapters carry the complete event family through the same normalizer/reconciler.              |
| 7.6 | Public preview fallback and per-variant provenance                                                                | Browser Commander public-preview variants share the normalizer and preserve their transport alongside Bot API/MTProto raw variants.                                 |
| 7.7 | ToS/privacy/rate limits; no automatic joining/contact                                                             | Policy code and documentation prohibit auto-join and auto-contact and isolate/rate-limit source work.                                                               |
| 7.8 | Explain routing/degradation without secrets                                                                       | Diagnostics expose capability, operation, selected transport, and reason through the common redactor.                                                               |

### Acceptance and failure cases

- 7.A The matrix covers every operation with no/bot/user/both credentials and
  permission, flood-wait, invalid-entity, and ambiguous-timeout outcomes.
- 7.B Combined mode proves bot-first order and safe-classification-only fallback.
- 7.C Reconciliation merges the same bot/MTProto/preview post into one offer and
  retains all three raw transport variants.
- 7.D User-session history reaches the exact rolling cutoff; bot-only reports a
  precise unavailable capability and continues other sources.
- 7.E Retry, fallback, restart, and persisted-idempotency tests never duplicate
  a send.

## Issue #8 — end-to-end revalidation

| ID   | Acceptance item                                                              | Durable evidence and current live boundary                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | Authorized bot command surface                                               | Access/handler tests plus the preserved credentialed identity audit; current no-token preflight correctly refuses startup.                                                         |
| 8.2  | Bot-only, user-only, combined routing                                        | Full capability matrix tests; preserved live audit validated both principals, while current run has no supplied credentials.                                                       |
| 8.3  | 20 ranked web + 20 nationwide Telegram + independent Nha Trang cohort        | Seed/source suites and preserved timestamped 2026-09-22 audit (44 candidates, 40 selected). Popularity is volatile and must be refreshed by an authorized operator.                |
| 8.4  | `/update_sources` persists multilingual popularity evidence                  | Source refresh tests verify metric/value/URL/time fields; live refresh requires Telegram credentials and mutable Internet sources.                                                 |
| 8.5  | Browser Commander UI only                                                    | Code boundary, tests, and manual harness prohibit private APIs. The current public smoke completed without failures but the selected public page yielded zero offers.              |
| 8.6  | Strict two-month preview/Bot/MTProto cutoff and provenance reconciliation    | Cutoff, pagination, normalization, and three-transport reconciliation tests; preserved credentialed audit supplies live history evidence.                                          |
| 8.7  | Multilingual types and unknown fields                                        | EN/VI/RU fixtures cover rooms/hotels/apartments/houses/other types; unknown/raw fields round-trip losslessly.                                                                      |
| 8.8  | Ten photos and shared 10 GiB                                                 | Media cap, shared budget, eviction, and retained-remote-URL tests.                                                                                                                 |
| 8.9  | VND/period and cheapest 1..50                                                | Pricing and command tests cover conversion timestamps, normalized periods, and bounds.                                                                                             |
| 8.10 | Official observations/events remain distinct                                 | Reconciliation tests permit official price events only from official-web observations.                                                                                             |
| 8.11 | Explicit authorized nonduplicated availability inquiry                       | Access, capability, ambiguity, and idempotency suites cover bot-first and safe fallback; no live owner was contacted during verification.                                          |
| 8.12 | Presets/ranges/fresh-unseen subscriptions across restart                     | Parser, persistence, scheduler, partial delivery, and mode suites cover the complete path.                                                                                         |
| 8.13 | Inspectable LiNo + transactional clink with crash recovery                   | Real `clink` round trip, multiprocess, kill-point, hash repair, deletion, and migration tests.                                                                                     |
| 8.14 | Docker deploy/redeploy/rollback and measured handoff                         | Local image build/smoke/health and deterministic deployment-state tests pass; an actual token handoff was intentionally not attempted without operator credentials.                |
| 8.15 | Security/ToS boundaries                                                      | Redaction, numeric authorization, SSRF/navigation, no-auto-join/contact, file mode, and secret-exclusion checks.                                                                   |
| 8.16 | Node/Bun/Deno/Docker/amd64-arm64/format/lint/duplication/coverage/live smoke | Local Node, Bun, Deno, exact Docker image, Compose, lint/format/check, and 100% product-line gates pass. Publication remains conditional on absent Docker Hub repository settings. |

The durable commands, exact local versions/image digest, preserved live audit,
degraded probes, and caveats live in
`case-studies/issue-1-revalidation/README.md`. This distinction is intentional:
tests establish behavior; they do not fabricate a credentialed transcript or a
published manifest.

## Issue #9 — authentication, sessions, and authorization

| ID  | Requirement                                                                                                                    | Implemented solution and evidence                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 | `login`, `status`, `validate`, `rotate`, `logout`; phone/code/optional hidden 2FA, QR callback, noninteractive container input | Telegram auth CLI and injected prompt/QR/secret providers implement each lifecycle flow.                                                                            |
| 9.2 | Never accept 2FA on argv; hide/clear/redact it; never serialize secrets into LiNo                                              | Argument schema excludes passwords, prompt input is hidden, references are scoped/cleared, recursive redaction covers causes/payloads, and storage tests scan LiNo. |
| 9.3 | Explicit stdout/secret/file/environment destination; file `0600`, atomic fsync; never silently write `.env`                    | Destination is mandatory for session output; file writes use temp/fsync/rename/directory fsync and verify mode.                                                     |
| 9.4 | Startup/preflight `getMe`, safe identity logging, optional stable numeric pins                                                 | Bot and user identities validate independently without polling; only numeric ID/public username are returned and expected-ID mismatches fail.                       |
| 9.5 | Numeric allowlists for every privileged operation                                                                              | Central middleware protects source refresh, user-account sends, and auth/status administration; username is never the authorization boundary.                       |
| 9.6 | Explicit public/private mode; fail-closed privilege; rate-limit public search/subscriptions                                    | Access policy denies missing privilege configuration and applies per-user/chat token buckets to public work.                                                        |
| 9.7 | `/help` and validation perform no network connection                                                                           | CLI parsing/handler tests use connection spies and pass with no credentials.                                                                                        |
| 9.8 | Document privacy mode, least privilege, revocation/rotation, exclusions, incident response, session sensitivity                | `telegram.md`, README, and deployment guidance cover all operator procedures.                                                                                       |

### Acceptance and failure cases

- 9.A Bot-only, user-only, and combined identities validate independently.
- 9.B Partial credentials fail once with an actionable error and no connection.
- 9.C Unauthorized identities cannot enter privileged handlers or trigger a
  user-account send.
- 9.D Help/version and argument validation work without credentials or network.
- 9.E Session output plus every structured error/log snapshot is scanned for
  secret leakage.
- 9.F Cancellation, invalid code, hidden 2FA, expired/revoked session, changed
  expected identity, and cleanup failure have deterministic tests.

## Umbrella issue #10

| ID   | Requirement                                                                                          | Disposition                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1 | Read every listed issue and comment and fully implement it                                           | All seven issue bodies, empty comment threads, code, tests, and linked prior art were reviewed; the mappings above cover every implementation and acceptance item.                              |
| 10.2 | Complete all work in one PR without deferring a listed issue                                         | Issues #3–#9 are implemented on PR #11. Later issue numbers mentioned by historical audits are context, not deferral of this scope.                                                             |
| 10.3 | Close the umbrella and all seven sub-issues in the PR body                                           | PR #11 uses independent closing lines for #3 through #10.                                                                                                                                       |
| 10.4 | Use one full closing keyword per issue                                                               | The exact `Fixes #N` syntax is used once per line, avoiding GitHub's comma-list limitation.                                                                                                     |
| 10.5 | Explicitly disclose anything already resolved/not reproducible while retaining its closing reference | No sub-issue was treated as already resolved. Unavailable credentials, absent registry configuration, mutable source failures, and historical parser gaps are disclosed rather than fabricated. |

Historical gaps found before this implementation remain preserved as baselines,
clearly labeled with their observed date and commit, rather than being rewritten
as successful live observations.
