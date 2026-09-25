# Candidate revalidation — 2026-09-25

## Scope and privacy boundary

This local/manual pass tested `main` commit
[`b0c4b89`](https://github.com/konard/vietnam-accomodation-search/commit/b0c4b899facc8475f6b3f55dfe294cb1781b3417),
package version `0.12.2`. It is a candidate observation, not release
acceptance: no Git tag or GitHub Release existed when the pass began.

Real Telegram and website data was used only through the committed manual
harnesses. Credentials, identities, raw posts, page bodies, screenshots,
Browser Commander recordings, and typed live state remain in ignored private
local storage. This report contains only aggregate, privacy-safe evidence.

## Deterministic checks

The intended runtime must put Node 22.23.0 and the repository-pinned Rust
`clink` 0.2.10 before unrelated host executables with the same names.

| Check                                         | Result                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Node coverage gate                            | 787 tests, 184 suites, 0 failures; line 100%, branch 94.19%, function 98.01% |
| Bun 1.2.20                                    | 787 tests across 80 files, 0 failures                                        |
| Manual-audit fixture suites                   | 26 tests, 3 suites, 0 failures                                               |
| Lint, Prettier, tracked-file limit            | pass                                                                         |
| `npm@11.19.0 pack --dry-run --ignore-scripts` | pass; 42 files, 108,489 bytes; CLI included                                  |

The host's older Deno 2.4.5 cannot run this lock/source set and fails on a
Node-style import. It is not the release runtime. The workflow-pinned Deno
2.9.7 exact-candidate leg passed in
[run 36050159106](https://github.com/konard/vietnam-accomodation-search/actions/runs/36050159106).

## Real Telegram bot conversation

The bot-only production runtime was driven through real Telegram by the
authorized local GramJS user session. The run passed preset save/select,
`/subscribe`, fresh unseen delivery, restart on the same state, no duplicate
after restart, cleanup commands, and deletion of every test-created command and
reply. Cleanup-only checks before and after the run found zero recognized
remnants.

Failure replies would be written to ignored, mode-`0600`, secret-redacted logs
before deletion. This successful run produced no failure reply. The credential
files still lack independent numeric identity pins, and the available user
session is not a native `mtcute/session-string-v1` production session. User-only
and combined bot-first/user-fallback acceptance therefore remains
[Issue #42](https://github.com/konard/vietnam-accomodation-search/issues/42).

## Real Telegram source audit

The up-to-40-source runner connected with the authorized user session after
verifying English, Russian, and Vietnamese OCR. The first source again produced
approximately 16 MiB of typed canonical LiNo. The new projection heartbeat
reported every 15 seconds and the child was terminated at its configured
600-second boundary with classified `storage-timeout`; it no longer hangs
silently.

The run still wrote no durable source checkpoint before that projection, so a
restart cannot skip the already collected Telegram window. It produced no final
source count, parser report, or acceptance object and therefore proves neither
40-source completion nor complete offer/detail parsing. Private state was
retained locally for diagnosis; no raw content or stable identity is committed.
The remaining throughput/checkpoint/acceptance work is
[Issue #43](https://github.com/konard/vietnam-accomodation-search/issues/43).

## Browser Commander audit

All ten committed Vietnamese, English, and Russian routes were tested with
independent per-domain queues, concurrency three, randomized 3–8 second pacing,
a 60-second navigation timeout, and no CAPTCHA bypass.

| Outcome          | Sources                                                             | Aggregate evidence                                                         |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Success          | Alo Nhà Đất, Nha Trang Renting, Be Jib, Vietnam Real Estate, ICEKEM | 156 cards; 1,094/1,094 segments consumed                                   |
| Challenge        | Nha Tot, Batdongsan, Xmetr                                          | HTTP 401/403 evidence; no cards claimed                                    |
| Parse incomplete | Dot Property                                                        | 4 incomplete cards; 0/92 segments consumed                                 |
| Parse incomplete | Vietdom                                                             | 4 cards, 1 incomplete; 15/15 segments consumed, but required fields absent |

This improves the 2026-09-24 result from three to five fully successful
sources, but the full-manifest gate still fails. Exact adapters, challenges,
required fields, and two-consecutive-run acceptance remain
[Issue #40](https://github.com/konard/vietnam-accomodation-search/issues/40).

## Docker and deployment

The current production image built successfully from pinned Node and Rust base
digests. Direct smoke checks passed:

- OCI version `0.12.2`, revision `b0c4b899...`, and created timestamp match the
  checkout;
- CLI `0.12.2`, Rust `clink` 0.2.10, and headless Chromium start successfully;
- the configured runtime user is unprivileged UID/GID 1000; and
- the image has one Tini entry point.

The committed deploy helper did not reach preflight or cutover. At
[`scripts/deploy.mjs#L201`](../../../scripts/deploy.mjs#L201), the unquoted
`{{json .Config.Labels}}` template is split by `command-stream`; Docker receives
an incomplete Go template and exits 64. Consequently this pass could not repeat
same-bind deploy/redeploy/rollback, persistence, or downtime measurement on the
current candidate. This blocks production deployment in
[Issue #41](https://github.com/konard/vietnam-accomodation-search/issues/41).

## Release state and conclusion

The latest release workflow versioned `main` to `0.12.2`, but its npm publish
attempts failed with `ENEEDAUTH`; the package does not yet exist and the
first-publication `NPM_TOKEN` was unavailable. There is still no tag, GitHub
Release, npm artifact, OCI release identity, or immutable post-release audit.
Bootstrap and immutable publication remain
[Issue #39](https://github.com/konard/vietnam-accomodation-search/issues/39),
followed by the exact-release rerun in
[Issue #16](https://github.com/konard/vietnam-accomodation-search/issues/16).

The candidate is not fully accepted. Automated checks, package contents, the
real bot-only conversation, image contents, and five browser sources pass.
Immutable publication, deploy-script execution, native identity-pinned Telegram
modes, complete 40-source Telegram ingestion, and the full browser set remain
open.
