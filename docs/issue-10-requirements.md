# Issue 10 requirement and solution map

This file enumerates the seven sub-issues of issue 10. The selected plan is
implemented in this pull request; alternatives are recorded so future changes
preserve the contracts rather than rediscovering them.

## Issue 3: production container and redeploy

| Requirement                                                                              | Selected solution                                                                                                              | Alternative considered                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Reproducible Node 22+, Chromium, non-root, init, volume, OCI, health, no layered secrets | Digest-pinned multi-stage Dockerfile, exact Playwright install, `node` + `tini`, `/data`, OCI labels, bounded health           | Playwright's larger prebuilt image; rejected to keep the runtime explicit |
| Hardened Compose                                                                         | Required untracked env file, named volume, restart/grace/health, localhost bind, read-only root, dropped capabilities          | Kubernetes; outside the local-deploy scope                                |
| Deploy/status/logs/stop/rollback using project conventions                               | One `use-m`/`command-stream`/`lino-arguments` script with exclusive lock and durable state                                     | Shell-only orchestration; weaker argument and command boundaries          |
| Near-zero downtime                                                                       | Build/pull, image/clink smoke, credential/data preflight while old runs; serialized stop/start; exact-image rollback           | Blue/green pollers; invalid because Bot API allows one long poller        |
| Lifecycle/readiness and CI                                                               | `/live`, `/ready`, `onStart`, signal drain; CI image CLI/clink/health smoke; existing native amd64/arm64 publication preserved | TCP-only health; insufficient authentication/polling evidence             |
| Operations docs                                                                          | Build, published deploy, handoff, rollback, logs, backup/restore, Hub variables/manifests in `deployment.md`                   | Tribal runbook; not reproducible                                          |

## Issue 4: associative and binary persistence

| Requirement                                               | Selected solution                                                                                                  | Evidence                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Canonical non-opaque schema for every entity              | Generic typed field/path links, raw and unknown fields included                                                    | Associative round-trip and query tests                   |
| Text plus transactional binary                            | Canonical fsynced text + immutable hash-named `clink` import/export snapshot + atomic pointer                      | Real `clink`, failed-stage, interrupted-activation tests |
| Two-value compatibility and lossless deterministic output | Every link has two values; exported link set must contain every imported link                                      | Parser fixture and real adapter smoke                    |
| Serialized/multiprocess durability                        | Promise queue plus dead-owner-aware process lock; read/merge/write inside lock                                     | Concurrent process and stale-lock tests                  |
| Migration                                                 | Read legacy opaque and associative-v1 files; next save emits v2                                                    | Existing legacy store fixtures plus v2 tests             |
| Shared 10 GiB/recovery/compaction                         | Count all data files, evict oldest media only, retain URLs; prune old binary snapshots and bound operational state | Media/cache and storage recovery suites                  |
| Production/local support                                  | Exact `link-cli` in image and documented Cargo installation/preflight                                              | Docker and preflight tests                               |

## Issue 5: presets, filters, and subscriptions

| Requirement                          | Selected solution                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Eight command semantics              | Built-in default plus list/show/save/use/delete/search override/subscribe/unsubscribe/status handlers              |
| All independent type/room/VND bounds | Order-independent typed parser and one shared matcher; rooms and beds remain distinct                              |
| Persistent state                     | Generic associative collections for presets, active setting, one subscription, last success, bounded shown aliases |
| Fresh unseen delivery                | Stable reconciled aliases; per-offer confirmed mark, so a partial batch resumes without replaying completed offers |
| Efficient scheduler                  | Identical option grouping, sequential bounded backpressure, immediate subscribe tick, non-overlap, clean stop      |
| Telegram limits                      | Plain text chunks at 4096 and at most ten photos per offer; no parse mode injection                                |

## Issue 6: resilient Telegram runtime

The central classifier distinguishes Bot API, transport, MTProto flood/auth,
entity, 409, blocked, capability, and malformed failures. The retry helper is
safe-operation-only and bounded by attempts, elapsed time, delay, jitter, and
abort signal. `bot.catch`, persisted update/edit IDs, readiness/liveness,
distinct fatal exits, redaction, middleware draining, polling settlement,
scheduler shutdown, and resource aggregation form the lifecycle solution.
Unbounded implicit library retries were rejected because they obscure
non-idempotent outcomes.

## Issue 7: capability routing and ingestion

The typed method matrix covers identity, sending, live updates, history,
entities, media, membership, and popularity. Bot-first combined routing falls
back only on a known capability rejection before send, and stores idempotency
outcomes. MTProto history and public-preview history share the strict rolling
two-month normalizer path. Bot live posts, captions, edits, topics, and albums
carry provenance. User-only mode intentionally has no Bot API commands but
retains continuous user-session ingestion capability; diagnostics report degradation without
secrets. Automatic joining and automatic owner contact were rejected on
privacy and Terms-of-Service grounds.

## Issue 8: end-to-end revalidation

Durable sanitized evidence and the requirement/code/test table live in
`case-studies/issue-1-revalidation/README.md`. Local product, real `clink`,
container, Compose, and recovery evidence is captured. No Telegram credential
was available to this change environment; the case study records the exact
preflight failure/degraded behavior instead of inventing a live result.

## Issue 9: auth and privileged authorization

Explicit login/status/validate/rotate/logout support hidden phone/code/2FA and
QR callbacks. Sessions go only to an explicit stdout/secret/file destination;
local writes are atomic, fsynced, and `0600`. Startup/preflight pins numeric
identities. Numeric allowlists guard every privileged bot action, private mode
fails closed, and public search/subscriptions are rate-limited. Help and
argument errors are resolved before application/network construction. Nested
redaction plus no-argv-password tests cover disclosure boundaries.
