# Post-PR #51 candidate revalidation — 2026-09-28

## Scope and evidence boundary

This local/manual pass tested main commit
[`5f4a715`](https://github.com/konard/vietnam-accomodation-search/commit/5f4a7156e67fc9a2903d9fc836589cd414c6a175)
after PR [#51](https://github.com/konard/vietnam-accomodation-search/pull/51)
merged. It is a mutable candidate, not an immutable release. All credentials,
numeric identities, private Telegram source names, raw posts/pages, contacts,
media, and detailed traces remain in ignored local mode-`0600` files under
mode-`0700` directories. Only aggregate findings are committed.

PR #51 used closing references and GitHub closed Issues #16, #39–#43, #48,
and #50. The checks below show that closure was premature. Their acceptance
checklists must remain open until a released target passes.

## Publication and deterministic checks

[Checks and release run 36304502244](https://github.com/konard/vietnam-accomodation-search/actions/runs/36304502244)
passed its Node, Bun, and Deno platform jobs. Its
[Release Preflight job](https://github.com/konard/vietnam-accomodation-search/actions/runs/36304502244/job/108578329679)
failed before publication: the log shows an empty `NPM_TOKEN`, and the first
package does not yet exist. The release job was skipped. The registry still
returns `E404` for `vietnam-accomodation-search`; there is no Git tag, GitHub
Release, or published OCI digest to revalidate. A local npm 11.6 tarball dry
run includes 42 files and the CLI executable, but cannot establish install or
provenance of a published package.

The local Node 24.18.0 suite reported **804/805 passing**. The sole failure,
`passes the Docker label Go template as one real command argument`, uses a
fake `docker` on `PATH`; `command-stream` invokes `/bin/sh -l -c`, and on this
macOS host the login shell reorders `PATH` so the real Docker is selected
first. The updated
[`experiments/reproduce-deploy-argv.mjs`](../../../experiments/reproduce-deploy-argv.mjs)
detects that condition and invokes the fake executable by absolute path when
necessary. It confirms that the Go template stays one argument on Node 24
with `command-stream` 1.1.0 and the locked 0.24.1, and on Node 22 with locked
0.24.1. Thus the remaining local failure is an environment-sensitive test
fixture, not demonstrated production argument splitting; the full suite still
needs a green local run after its fixture is fixed. The manual helper and
deploy-handoff test group passed **28/28**. `npm run check` passed (12 existing
lint warnings suppressed by policy); `git diff --check` passed.

## Browser Commander live audit

The committed ten-route manifest was run twice consecutively with polite
per-domain pacing, separate concurrent domains, private redacted traces, and
no CAPTCHA bypass. Both full runs passed **10/10** routes (5 Vietnamese,
2 English, 3 Russian), yielding **224 cards**, **1,607/1,607 meaningful
segments consumed**, **zero incomplete cards**, and **zero missing required
semantic checks** in each run. The route IDs were `alonhadat`, `homedy`,
`nhatrangland`, `nha-trang-renting`, `nha-trang-vn`, `yourhome`, `newhome`,
`be-jib`, `vietnam-real-estate`, and `icekem`. These are mutable-site
candidate passes. The same two-run gate must still be repeated against the
exact immutable release, and the aggregate check does not prove every
Telegram post or every future web listing is parsable.

## Real Telegram checks

An authorized GramJS user session drove the real production **bot-only**
runtime through identity/readiness, preset save/select, `/subscribe`, fresh
unseen delivery, restart on the same data, no duplicate after restart,
persisted preset/subscription, search, and cleanup. Cleanup-only scans found
zero stale E2E messages before and after; the successful run left zero
test-created messages. Failure transcripts, when created, are retained before
message deletion in ignored redacted mode-`0600` logs. This run created no
new failure transcript. Its result still says `combinedRuntime: false` and
`testUserIdentityPinned: false`. A GramJS driver session cannot be assumed to
be a native mtcute runtime session, so user-only, combined, degraded-combined,
bot-first fallback, and independent identity-pin acceptance remain unproved.

The private up-to-40-source audit resumed its retained source journal and
checkpoint with verified English/Russian/Vietnamese OCR and Rust `clink`
0.2.10. It reached binary projection, emitted redacted 15-second heartbeats
with zero stderr, and timed out at **600 seconds** with classified
`storage-timeout`. The private journal and checkpoint remain intact, but no
final report was produced. Current selected-source count, complete rolling
two-month corpus, human-reviewed precision/recall, typed link/binary
verification, and second-run idempotence therefore remain unproved. This is
not evidence that 20–40 Telegram sources are fully parsable or that current
most-popular community discovery passes.

## Docker deploy, handoff, and host-bind durability

An isolated production image built from `5f4a715` passed image/CLI/`clink`/
Chromium/storage/bot preflight and reached healthy readiness. A committed
[`experiments/measure-deploy-handoff.mjs`](../../../experiments/measure-deploy-handoff.mjs)
probe ran during a same-bind redeploy: of **48** sampled `/ready` requests,
46 passed and 2 failed; the longest observed readiness interruption was
**3,691 ms**. The concurrent Bot API `getMe` probe passed 48/48, but that
endpoint is independent of this app and **does not** establish message
delivery continuity, a single poller, or absence of lost/duplicate updates.
The redeploy reached healthy state and explicit exact-image rollback restored
the previous image to healthy state.

After stopping the app, a fresh container mounted the retained operator-owned
host directory and verified the binary mirror, cached media, delivered cursor,
offer, preset, subscription, and Telegram update cursor. Only the stopped
isolated test container and its network were removed; the host bind was
retained. A deliberately failed candidate's **automatic** restoration was
not live-tested, nor was an immutable multi-architecture image digest.

## Acceptance conclusion

Candidate browser coverage and bot-only/durable-state behavior improved, but
the system is **not fully delivered or production-ready**. First publication
is blocked by missing bootstrap `NPM_TOKEN`; no immutable artifact exists.
The local test fixture still fails, native Telegram modes are unverified, the
real 40-source audit times out before projection completes, and deploy
cutover lacks one-poller/message-continuity and failed-candidate evidence.
Issues [#16](https://github.com/konard/vietnam-accomodation-search/issues/16),
[#39](https://github.com/konard/vietnam-accomodation-search/issues/39),
[#40](https://github.com/konard/vietnam-accomodation-search/issues/40),
[#41](https://github.com/konard/vietnam-accomodation-search/issues/41),
[#42](https://github.com/konard/vietnam-accomodation-search/issues/42), and
[#43](https://github.com/konard/vietnam-accomodation-search/issues/43) own
the remaining acceptance gates.
