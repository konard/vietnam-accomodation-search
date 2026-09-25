# Post-PR #47 revalidation — 2026-09-26

## Scope and privacy boundary

This local/manual pass tested `main` commit
[`963f37a`](https://github.com/konard/vietnam-accomodation-search/commit/963f37a6aca1f2783b2f242b54214efdc847c200),
package version `0.12.2`, after PR
[#47](https://github.com/konard/vietnam-accomodation-search/pull/47)
automatically closed Issues #16 and #39–#43. It is not release acceptance: the
repository still had no Git tag or GitHub Release, and npm still returned
`E404` for the package.

Real Telegram and website data was used only through committed manual
harnesses. Credentials, numeric identities, source aliases, raw posts, page
bodies, screenshots, browser recordings, and typed live state remain in
ignored mode-`0600`/`0700` local storage. This report contains only aggregate,
privacy-safe evidence.

## Release and deterministic checks

[Checks and release run 36160222510](https://github.com/konard/vietnam-accomodation-search/actions/runs/36160222510)
did not publish a release. The release job prepared version `0.12.3`, then
`version-and-commit.mjs` failed while staging the changed file list:

```text
Error: The "list" argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView.
```

No tag, GitHub Release, npm package, OCI release identity, or immutable
post-release audit exists. The local Node 22.23.0 suite, with the repository's
Rust `clink` 0.2.10 first in `PATH`, reported 789/790 tests and 183/184 suites
passing. The sole failure is the new real-argv regression
`passes the Docker label Go template as one real command argument`; the
`command-stream` process exits 1. The three documented manual-audit helper
suites pass 26/26 tests.

This means PR #47 fixed neither immutable publication nor its own complete
deterministic gate. Publication remains Issue
[#39](https://github.com/konard/vietnam-accomodation-search/issues/39), followed
by the exact-release audit in Issue
[#16](https://github.com/konard/vietnam-accomodation-search/issues/16).

## Real Telegram bot conversation

With no competing poller, the authorized GramJS test user drove the production
bot-only runtime. The scenario passed bot identity/readiness, preset save and
selection, `/subscribe`, fresh unseen delivery, restart on the same state, no
duplicate after restart, cleanup commands, and deletion of every command and
reply created by the test. Cleanup-only passes immediately before and after the
scenario both found zero recognized leftovers.

The harness writes unexpected replies and run failures to ignored,
secret-redacted, mode-`0600` files under `experiments/logs` before attempting
message deletion. Existing retained failure logs have the required permissions;
this successful run created no new failure transcript. The result still reports
`combinedRuntime: false` and `testUserIdentityPinned: false`, so native mtcute
user-only/combined and capability-fallback acceptance remains Issue
[#42](https://github.com/konard/vietnam-accomodation-search/issues/42).

## Real Telegram source audit

The up-to-40-source runner connected with the authorized user session after
verifying English, Russian, and Vietnamese OCR. Private `User` dialogs remain
excluded by the discriminator-first implementation and fixture gate.

PR #47 made one material improvement: before the first expensive binary
projection, the run wrote one durable source journal and one checkpoint. The
first projection still emitted 15-second redacted heartbeats and timed out at
exactly 600 seconds with classified `storage-timeout`. No final source count,
parser metrics, storage verification, or acceptance object was produced.

A controlled restart entered binary projection directly from the retained
journal. Its timestamp and byte size did not change, proving that the collected
window was reused rather than rewritten. The checkpoint and journal also
survived an operator interruption. This validates partial crash resumability,
but not projection completion, the exact 40-source cohort, the two-month
window, or complete parsing. Those gates remain Issue
[#43](https://github.com/konard/vietnam-accomodation-search/issues/43).

## Browser Commander audit

All ten committed Vietnamese, English, and Russian routes were rerun with
independent per-domain queues, concurrency three, randomized 3–8 second pacing,
a 60-second navigation timeout, persistent cooldowns, and no CAPTCHA bypass.

| Outcome          | Sources                                                             | Aggregate evidence                                                         |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Success          | Alo Nhà Đất, Nha Trang Renting, Be Jib, Vietnam Real Estate, ICEKEM | 156 cards; 1,094/1,094 segments consumed                                   |
| Challenge        | Nha Tot, Batdongsan, Xmetr                                          | HTTP 401/403 evidence; no cards claimed                                    |
| Parse incomplete | Dot Property                                                        | 4 incomplete cards; 0/92 segments consumed                                 |
| Parse incomplete | Vietdom                                                             | 4 cards, 1 incomplete; 15/15 segments consumed, but required fields absent |

The result remains 5 success, 3 challenge, and 2 parse-incomplete. Dot Property
still lacks availability, contacts, location, price period, and rooms/beds;
Vietdom still lacks location, price period, and rooms/beds. The complete cohort
and two consecutive passing runs remain Issue
[#40](https://github.com/konard/vietnam-accomodation-search/issues/40).

## Docker, persistence, and redeploy

An isolated production image built from commit `963f37a`. Candidate checks
passed OCI identity, CLI version, Rust `clink` 0.2.10, headless Chromium,
unprivileged storage writes, and real bot-only Telegram preflight. A first
deploy reached healthy readiness, followed by a same-bind redeploy and an exact
rollback to the previous image.

The committed persistence experiment proved that canonical LiNo, the binary
mirror, cached media, active preset, subscription, delivered-offer cursor, and
Telegram update cursor survived redeploy and rollback. The same state passed
again after the exact stopped Compose container and its dedicated network were
removed; the operator-owned host bind was not removed.

The deployment is not fully accepted. The new fake-Docker argv regression fails
locally even though real Docker accepts the argument, no committed continuous
`/ready` plus Bot API probe quantifies the single-poller interruption, the
failed-candidate automatic restore path was not exercised in this pass, and no
published multi-architecture digest exists. These remaining gates stay in
Issue [#41](https://github.com/konard/vietnam-accomodation-search/issues/41).

## Conclusion

The automatic issue closures from PR #47 are not acceptance evidence. This
pass confirms useful progress in Telegram pre-projection checkpointing and real
same-bind deployment durability, while independently reproducing the release,
browser, native Telegram, and binary-projection blockers. Issues #16 and
#39–#43 must remain open until their unchecked acceptance criteria pass against
one immutable release target.
