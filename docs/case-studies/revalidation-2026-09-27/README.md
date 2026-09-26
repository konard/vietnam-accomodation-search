# `0.12.3` main revalidation — 2026-09-27

## Scope and privacy boundary

This local/manual pass tested package version `0.12.3` at main commit
[`606ffa9`](https://github.com/konard/vietnam-accomodation-search/commit/606ffa951a18ee9a18f13719efb37e4592204786).
That commit was created by the release workflow after PR
[#49](https://github.com/konard/vietnam-accomodation-search/pull/49) merged as
`6a247f9`. PR #49 stated that browser, deployment handoff, native Telegram,
and private 40-source acceptance remained open, but its `Fixes` references
automatically closed Issues #16 and #39–#43.

This is candidate evidence, not release acceptance. Credentials, numeric
identities, private source aliases, raw Telegram posts, page bodies,
screenshots, recordings, typed live state, and failure transcripts remain in
ignored mode-`0600`/`0700` local storage. Only privacy-safe aggregates are
committed here.

## Release and deterministic checks

[Checks and release run 36211660562](https://github.com/konard/vietnam-accomodation-search/actions/runs/36211660562)
fixed the earlier staged-file `ArrayBuffer` failure, created the exact
`0.12.3` version commit, and passed its Node, Bun, and Deno candidate matrix.
The
[Release job](https://github.com/konard/vietnam-accomodation-search/actions/runs/36211660562/job/108319888740)
then retried `npm publish` three times and failed with `ENEEDAUTH`. The job also
reported that npm removed an invalid bin entry while auto-correcting the
publish manifest. Local npm 10 and npm 11.6 dry runs both include
`bin/vietnam-accomodation-search.js` and do not reproduce that correction, so
the workflow/package-manifest discrepancy still needs resolution.

Repository and registry checks after the run found no Git tag, GitHub Release,
npm package, published OCI identity, or immutable release audit. The local npm
tarball dry run contains 42 files, including the CLI, but a dry run is not a
published artifact.

On Node 22.23.0 with Rust `clink` 0.2.10 first in `PATH`, the local suite
reports **790/791 tests passing** across 184 suites. The sole failure remains
`passes the Docker label Go template as one real command argument`: the fake
Docker command exits 1 when `use-m` resolves `command-stream` 1.1.0, while the
same test passes in the workflow. The committed manual-audit helper suites pass
26/26. Lint passes with 12 unchanged-line warnings suppressed by policy, and
the complete formatting check passes.

Publication remains Issue
[#39](https://github.com/konard/vietnam-accomodation-search/issues/39), followed
by exact-release revalidation in Issue
[#16](https://github.com/konard/vietnam-accomodation-search/issues/16).

## Real Telegram bot conversation

With no competing poller, the authorized GramJS user session drove the
production bot-only runtime through bot identity/readiness, preset save and
selection, `/subscribe`, fresh unseen delivery, restart on the same data,
duplicate suppression, persisted preset/subscription checks, search, and
cleanup. Cleanup-only scans immediately before and after the scenario both
found zero stale E2E messages, and every message created by the passing run was
deleted.

The harness retains unexpected replies and failed-run transcripts before
deletion in ignored, redacted, mode-`0600` files. This passing run needed no new
failure transcript. Its result still reports `combinedRuntime: false` and
`testUserIdentityPinned: false`. The available session is explicitly GramJS
driver state, not a native mtcute production session; it cannot safely satisfy
user-only, combined, degraded-combined, or bot-first fallback acceptance.
Those gates remain Issue
[#42](https://github.com/konard/vietnam-accomodation-search/issues/42).

## Real Telegram source audit

The up-to-40-source runner was resumed with the authorized user session,
configured bot token, Rust `clink` 0.2.10, and verified English, Russian, and
Vietnamese OCR. It reused the one retained private source journal and
checkpoint from the previous collection rather than recollecting that window.

Binary projection emitted redacted 15-second heartbeats with zero stderr and
timed out at exactly 600 seconds with classified `storage-timeout`. No final
report was written. The private journal and checkpoint remain intact for the
next retry, but the runner still cannot progress to a current selected-source
count, complete two-month history, parser metrics, typed-storage verification,
acceptance object, or idempotent second result.

Consequently this pass does **not** prove that 20–40 Telegram sources are fully
parsable or that discovery selects the current most popular communities.
Checkpoint reuse passes; projection throughput and complete corpus acceptance
remain Issue
[#43](https://github.com/konard/vietnam-accomodation-search/issues/43).

## Browser Commander audit

All ten committed Vietnamese, English, and Russian routes were rerun with
Browser Commander. The run used independent per-domain queues, concurrency
three only across different domains, randomized 3–8 second pacing, 60-second
navigation timeouts, persisted cooldowns, private redacted traces, and no
CAPTCHA bypass.

| Outcome          | Sources                                                             | Privacy-safe aggregate evidence                                                                             |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Success          | Alo Nha Dat, Nha Trang Renting, Be Jib, Vietnam Real Estate, ICEKEM | 156 cards; 1,093/1,093 segments consumed; every required semantic check passed                              |
| Challenge        | Nha Tot, Batdongsan, Xmetr                                          | Main response 403; no cards claimed                                                                         |
| Parse incomplete | Dot Property                                                        | 4/4 cards incomplete; 0/92 segments consumed; availability/contact/location/price-period/rooms-beds missing |
| Parse incomplete | Vietdom                                                             | 4 cards, 1 incomplete; 15/15 segments consumed; location/price-period/rooms-beds missing                    |

The command correctly exited non-zero with **5 success, 3 challenge, and 2
parse-incomplete**. Complete-route support and two consecutive passing runs
remain Issue
[#40](https://github.com/konard/vietnam-accomodation-search/issues/40).

## Docker, persistence, redeploy, and rollback

An isolated production image built from the exact `0.12.3` commit. Candidate
preflight passed image identity, CLI version, Tini/unprivileged runtime, Rust
`clink` 0.2.10, headless Chromium, storage writes, and real bot-only Telegram
preflight. First deploy reached healthy readiness; a same-bind redeploy reached
healthy readiness; and explicit rollback restored the exact recorded previous
image to healthy state.

The retained isolated host bind then verified that canonical LiNo, the binary
mirror, cached media, active preset, subscription, delivered-offer cursor, and
Telegram update cursor survived the version upgrade, redeploy, and rollback.
Only the stopped test container and its dedicated network were removed; the
mode-`0700` operator-owned data directory remains intact.

This is strong candidate durability evidence, but deployment acceptance is not
complete. The supported `use-m`/`command-stream` real-argv regression still
fails locally, no committed continuous `/ready` plus Bot API probe quantifies
the single-poller handoff, the deliberately failed-candidate restoration path
was not exercised in this pass, and no published multi-architecture digest
exists. These gates remain Issue
[#41](https://github.com/konard/vietnam-accomodation-search/issues/41).

## Conclusion

`0.12.3` is a mutable version commit, not an immutable release. It passes the
real bot-only conversation and candidate deploy/persistence drills, but fails
the local deterministic suite, release publication, complete browser cohort,
native Telegram modes, and complete Telegram source audit. Issues #16 and
#39–#43 must remain open until their unchecked acceptance criteria pass against
one published immutable target.
