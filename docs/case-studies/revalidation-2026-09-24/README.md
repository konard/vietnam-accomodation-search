# Full-system revalidation — 2026-09-24

## Scope and evidence boundary

This acceptance pass tested `main` commit
[`f75e4b7`](https://github.com/konard/vietnam-accomodation-search/commit/f75e4b70a87a356a81ceeb7420bd80c5915ff5da),
package version `0.12.1`, on Apple Silicon with Docker Desktop. Real Telegram
credentials and public-site content were used only by explicit local harnesses.
Tokens, sessions, numeric user identities, raw messages, page bodies,
screenshots, and Browser Commander recordings remain in ignored mode-`0600`
local storage. This document contains aggregate, privacy-safe results only.

The result is **not full acceptance**. Automated tests, the bot-only real
conversation, container persistence, deployment, redeployment, and rollback
passed. Release publication, seven of ten browser sources, native MTProto modes,
and the complete 40-source Telegram gate remain open.

## Automated and package checks

| Check                                 | Result                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Lint, formatting, duplication gate    | pass                                                                                  |
| Node 22.23.0 coverage suite           | 778 tests, 184 suites, 0 failures; line coverage 100%, branch 93.99%, function 98.21% |
| Bun 1.2.20                            | 778 tests, 0 failures                                                                 |
| Workflow-pinned Deno 2.9.7            | 695 tests plus 15 steps, 0 failures                                                   |
| `npm pack --dry-run --ignore-scripts` | pass; 42 files, 107.0 kB package                                                      |
| Universal example production build    | pass; 23 modules transformed                                                          |
| Tracked-file line limit               | pass; 260 files below 1,500 lines                                                     |

The shell's default Node 20 and an unrelated executable also named `clink`
cannot run the intended suite. Repeating with the documented Node 22 runtime and
Rust `link-cli` 0.2.10 passed. Deno's `--frozen` check was repeated with the
workflow-pinned 2.9.7 binary rather than treating an older local runtime's lock
format as a product failure.

## Real Telegram conversation

The corrected conversation harness passed in bot-only production mode while an
authorized real user session drove the bot through Telegram:

- Bot identity and readiness passed.
- Preset save/use, subscription, unseen delivery, one-time override, restart,
  unsubscribe, and cleanup passed.
- Preset, subscription, cache, and delivery cursor survived restart.
- No duplicate offer was delivered after restart.
- No unexpected error or usage reply was observed.
- Every test-created message was removed, and a cleanup-only pass found zero
  recognized remnants.
- Failed runs would be preserved in ignored redacted logs before Telegram
  cleanup.

The available driver session is a declared GramJS session. It was not
reinterpreted as a native mtcute production session. User-only and combined
bot-plus-user runtime acceptance, including independent identity pins, remains
in [Issue #42](https://github.com/konard/vietnam-accomodation-search/issues/42).

## Complete Telegram source audit

The real two-month, up-to-40-source runner connected with the authorized user,
validated `eng+rus+vie` OCR availability, and reached real collection/storage.
Its first source produced a 16,027,517-byte canonical typed LiNo snapshot. Rust
`clink` then consumed one CPU core for more than 30 minutes in a single
transactional synchronous import/export with no progress, deadline, report, or
durable source checkpoint. The run was interrupted cleanly with no orphaned
process.

This attempt therefore proves neither that all 40 sources completed nor that all
offers/details were parsed. The raw candidate was retained locally for diagnosis.
The boundedness, restartability, and complete parsing acceptance gap is tracked
in [Issue #43](https://github.com/konard/vietnam-accomodation-search/issues/43).

## Browser Commander real-site audit

All ten committed Vietnamese, English, and Russian targets were tested with
independent per-domain queues, concurrency three, randomized 3–8 second pacing,
a 60-second navigation timeout, and no CAPTCHA bypass.

| Outcome          | Sources                                     | Aggregate evidence                              |
| ---------------- | ------------------------------------------- | ----------------------------------------------- |
| Success          | Alo Nhà Đất, Nha Trang Renting, Be Jib      | 116 cards; 813/813 segments consumed            |
| Challenge        | Batdongsan, Nha Tot configured route, Xmetr | 401/403 evidence; no cards claimed              |
| Parse incomplete | Dot Property, ICEKEM                        | 34 incomplete cards; 30/399 segments consumed   |
| Zero cards       | Vietdom, Vietnam Real Estate                | no classified challenge, but no extracted cards |

The successful VI/EN/RU cohort remains useful evidence, but seven enabled
targets do not meet complete-source acceptance. The detailed adapter, route,
challenge, and replay requirements are in
[Issue #40](https://github.com/konard/vietnam-accomodation-search/issues/40).

## Docker, persistence, and deployment

The production image built and passed these live checks:

- unprivileged UID/GID 1000;
- Node 22.22.0, `clink` 0.2.10, CLI, and browser smoke;
- read-only application path and writable `/data` contract;
- canonical LiNo plus binary mirror, cached media, preset, active subscription,
  delivered-offer cursor, and Telegram update cursor survived removal and
  recreation of the container against the same host bind;
- real Bot API preflight, `/live`, and `/ready` passed;
- first deployment, second deployment, exact-image rollback, and post-rollback
  readiness passed;
- isolated test containers and network were removed without deleting the host
  data.

Two hardening failures remain: the `0.12.1` executable's default local image is
labeled `0.11.30`, and Compose's init plus the image's Tini entry point produce
a double-init warning that defeats the inner Tini's child-reaping role. The
redeploy also lacks a reusable continuous availability measurement. These are in
[Issue #41](https://github.com/konard/vietnam-accomodation-search/issues/41).

## Release state

GitHub workflow
[`35892188721`](https://github.com/konard/vietnam-accomodation-search/actions/runs/35892188721)
versioned the package to `0.12.1`, then failed during the exact-candidate suite.
Three offline preflight tests inherited the job's ambient GitHub OIDC variable,
contradicting fixtures that intentionally omit OIDC. There is no Git tag, GitHub
Release, npm package, or published immutable image identity. The deterministic
test isolation and publication gate is tracked in
[Issue #39](https://github.com/konard/vietnam-accomodation-search/issues/39).

## Successor issue batch

| Issue                                                                  | Blocks                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| [#39](https://github.com/konard/vietnam-accomodation-search/issues/39) | Exact-candidate CI and immutable release publication            |
| [#40](https://github.com/konard/vietnam-accomodation-search/issues/40) | Complete ten-source VI/EN/RU browser parsing                    |
| [#41](https://github.com/konard/vietnam-accomodation-search/issues/41) | Correct Docker metadata/init and measured redeploy interruption |
| [#42](https://github.com/konard/vietnam-accomodation-search/issues/42) | Identity-pinned native mtcute user-only and combined E2E        |
| [#43](https://github.com/konard/vietnam-accomodation-search/issues/43) | Bounded, resumable, complete 40-source Telegram acceptance      |

Until all five gates pass on one immutable release, the system must not be
described as fully accepted or able to parse every discovered Telegram and web
source.
