# Deployment, Telegram, subscriptions, and associative-stack implementation

This document began as the handoff from the pre-implementation audit at commit
`826e901`. Pull request #11 has now completed that handoff without discarding
the original tests or historical evidence. The linked issue bodies remain the
authoritative acceptance contracts; the exhaustive current mapping is in
[`issue-10-requirements.md`](issue-10-requirements.md).

## Completed workstreams

| Issue                                                                | Implemented boundary                                                                                                                    | Primary evidence                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [#3](https://github.com/konard/vietnam-accomodation-search/issues/3) | Production image, hardened Compose, health/lifecycle, serialized candidate preflight/cutover/rollback, operations runbook               | Docker structural/image smoke and deployment-state tests |
| [#4](https://github.com/konard/vietnam-accomodation-search/issues/4) | Canonical typed LiNo, real transactional `clink` mirror, multiprocess durability, migration/recovery/budget/query paths                 | Associative storage and real-adapter suites              |
| [#5](https://github.com/konard/vietnam-accomodation-search/issues/5) | Range filters, named active presets, one-time overrides, unseen/fresh subscriptions, grouped scheduler, restart/partial-delivery safety | Preset, bot, scheduler, search, and storage suites       |
| [#6](https://github.com/konard/vietnam-accomodation-search/issues/6) | Typed Telegram failures, bounded safe retry, redacted diagnostics, readiness/liveness, signal drain and cleanup aggregation             | Error/retry/runtime/signal tests                         |
| [#7](https://github.com/konard/vietnam-accomodation-search/issues/7) | Bot/user/combined capability routing, idempotency, MTProto history/live normalization, preview fallback/provenance                      | Capability, ingestion, cutoff, and reconciliation suites |
| [#8](https://github.com/konard/vietnam-accomodation-search/issues/8) | Requirement/code/test evidence, local image/runtime verification, preserved credentialed baseline, explicit current degraded probes     | Issue 1 revalidation case study                          |
| [#9](https://github.com/konard/vietnam-accomodation-search/issues/9) | Login/session lifecycle, explicit secure destinations, principal pinning, numeric authorization, access modes/rate limits               | Auth/access/redaction/no-network suites                  |

## Reference practices retained

- Interactive phone/code/hidden-2FA or QR authentication always cleans up and
  parses help/validation before any connection.
- Stable numeric user IDs—not mutable usernames—authorize privileged actions.
- Telegram capability, rate-limit, and ambiguous transport failures are
  classified before retry or fallback.
- Polling is stopped and active work is drained before process exit.
- `browser-commander` remains the public web-UI automation boundary.
- Canonical Links Notation remains inspectable while `link-cli` adds a
  transactional, hash-verified binary projection.
- `use-m`, `command-stream`, and `lino-arguments` remain the conventions for
  applicable orchestration and maintenance commands.

## Historical baseline versus current state

The pre-implementation scaffold provided useful parser and service types but
was not wired into Telegram, runtime scheduling, or binary storage. PR #11
preserves those commits in history and completes the wiring, stable delivery
identity, partial-batch recovery, Telegram limits, v2 associative schema,
binary transaction/recovery protocol, and production lifecycle.

The 2026-09-22 browser and Telegram audit documents are intentionally retained
as historical observations. They expose source volatility and parser gaps at
the audited commit; they are not relabeled as post-change live successes.
Current code contracts have automated regression evidence, while credentials,
private dialogs, mutable public sites, and Docker Hub publication require an
authorized operator and are reported as explicit degraded or unconfigured
states when unavailable.

## Completion policy

Issue #8 is still treated as the integration gate rather than “unit tests are
enough.” The case study records direct code/test evidence, real local `clink`
and container execution, the preserved authorized Telegram run, the current
public browser probe, and exact constraints for checks this environment cannot
ethically perform. No success transcript, current popularity value, production
handoff duration, or published application manifest is fabricated.
