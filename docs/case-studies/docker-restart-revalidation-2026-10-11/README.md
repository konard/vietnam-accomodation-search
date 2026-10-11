# Original-host Docker restart and latest local validation

This is QA-only revalidation of merged application revision `6dac3bb` and QA
revisions `20ac35d` and `f5f2776`. Production fixes remain issue-driven. Supplied original
credentials, deployment records, source evidence and user transcripts are
preserved. Real writes are restricted to the credential owner's private bot
conversation, with exact message ownership and independent deletion readback.

This run does **not** certify all-source production/global-best readiness.
The remaining acceptance requirements must pass, not merely have implementation
PRs merged or their issues automatically closed.

## Docker recovery

Docker Desktop was restarted as requested using its CLI, without a factory
reset, broad prune or deletion of unrelated resources. After restart, the
original failed image-acceptance ownership journal was validated and restored.
Exact owned cleanup passes; independent full container/network/volume/image/
builder inventory matches the saved baseline. The pre-existing shared build
cache is preserved. The exact old recovery directory is removed only after
that proof. The removed QA image/build resources are disposable and rebuildable.

The healthy `desktop-linux` daemon remains reachable. A later Desktop CLI
status disagrees with daemon reachability; server/inventory checks are used
instead of treating that status alone as proof of daemon failure.

A later inventory observes an added, pre-existing-built, unrelated tagged image
with no QA ownership label. Its ownership is not established and it is preserved.
The final host inventory therefore cannot honestly be called identical to the
earlier recovery baseline. There are no containers or volumes; this observation
is not attributed to a QA cleanup defect without an ownership journal.

## Verified finite controls

- Node 24.21.0: 1,475 tests pass, no failures/cancellations/skips, both before
  and after the final 0.31.1 patch. Final product coverage is 100% lines,
  96.88% branches and 98.76% functions; the earlier run reports 96.91% branches.
  Neither is described as complete branch coverage or independent field truth.
- Bun 1.4.3: 1,475 tests pass, no failures, unchanged per-test timeout.
- Deno 2.9.6 with ordinary frozen project configuration: 1,358 passed,
  19 steps, zero failures and 11 explicitly ignored native-only controls.
  Those native cases run under Node/Bun; they are not counted as Deno passes.
- Both complete-suite wrappers report no unexpected fixture leftovers and
  independently verified removal of their owned temporary directories.
- Latest actual browser contract, trace privacy, HTTP semantics and five
  process/profile ownership controls pass. Room/bedroom/bed value-metric and
  ranking controls pass. These are structural controls, not independent live
  field-label accuracy measurements.
- The repaired owner operator authenticates the supplied real legacy-named
  session without adding canonical aliases. On a protected owned copy it
  configures the verified private owner, rejects unrelated recipients, and
  passes actual privileged bot commands, persistence, notification and restart
  controls. The unchanged original configuration is still unauthorized.
- Root and universal-example npm advisory audits report zero vulnerabilities.
  Tracked formatting, zero-warning ESLint, duplication threshold and universal
  web example build pass. Final checks are repeated after QA changes.

The repeated zero-warning lint, tracked-file formatting, duplication threshold,
example build and both advisory audits pass. An overly broad formatting attempt
flags an untouched untracked user transcript, which is preserved; the tracked
check excludes it. Incorrect duplication executable and unsupported formatter
file-type launch attempts are corrected and do not count as product regressions.

The shell's default Node 20 is unsupported and the earlier temporary Node 24
binary no longer exists. An initial suite launch was rejected before tests;
this is not counted as a product regression. Supported tools were reacquired
inside this run's private directory. The explicit Node 24 and Rust clink 1.0.0
paths are used. The shell's unrelated .NET `clink` is not used.

## Latest maintained dependencies and recording ownership

All direct root/example dependencies were checked against official npm latest
metadata. Browser Commander advanced first to 0.31.0 and then to 0.31.1 during
this run. Both updates refresh the manifest, npm lock and Deno lock; the final
official registry comparison passes. Command Stream 2.1.0 and Links Notation
0.25.2 remain current. No incompatible transitive major is forced through a
parent's range.

The requested
[Browser Commander #168](https://github.com/link-foundation/browser-commander/issues/168)
range update is delivered in 0.31.1; its obsolete nested Links Notation 0.23.0
copy disappears from both locks and the compatible 0.25.2 is reused. Lino
Arguments and Lino Env still use 0.11.2. Compatibility-assessed maintenance
requests remain
[Lino Arguments #46](https://github.com/link-foundation/lino-arguments/issues/46)
and [Lino Env #33](https://github.com/link-foundation/lino-env/issues/33), not
reproduced functional blockers. Lino Env's installed 0.2.8 itself matches
official latest metadata. Existing upstream
[CRLF issue #32](https://github.com/link-foundation/lino-env/issues/32) is referenced
for migration coverage, not claimed as a reproduced failure in this local run.

Browser Commander's [upstream recording request](https://github.com/link-foundation/browser-commander/issues/166)
is delivered in 0.31.0. The actual default creates no trace directory. Managed
opt-in recording creates a private owned child, explicit discard removes that
child and preserves an unrelated sibling sentinel. The production launcher and
commander remain explicitly recording-disabled even with host debug enabled.
Strict teardown and independent checkout checks find no unsolicited captures.

The 0.31.1 rerun passes Node/Bun suites plus actual browser contract, privacy,
HTTP, profile/process ownership, managed opt-in/default-off recording and
production recording policy controls, as well as unit metrics and ranking.
Node/Bun final wrappers have empty unexpected fixture inventories and verified
teardown. A mistaken attempt to launch the Deno binary as a Node script is a
QA input failure, not a Deno or dependency regression; the actual Deno lock
refresh through the runtime-aware cleanup runner passes.

The first managed-path assertion falsely failed because macOS `/var` and
`/private/var` identify the same directory. The QA assertion now canonicalizes
both paths; the verified rerun passes. Failed-attempt evidence is preserved
privately, not erased or described as a dependency defect.

The Deno lock was refreshed with a command-scoped dependency-age opt-in and
`nodeModulesDir=none`, without changing global policy or mutating dependencies
under the active native workflow. An additional manual-layout Deno attempt
cannot resolve its implicit Node type package and runs no tests. The ordinary
frozen project-config suite subsequently passes after live Node consumers exit.
Its runtime dependency initialization is not allowed to mutate the module tree
under those live readers. Expected controlled error strings in suite output are
not evidence that the real supplied session has been revoked.

Existing maintained dependency counterexamples still reproduce:

- [use-m #80](https://github.com/link-foundation/use-m/issues/80): a stalled
  response body outlives the upstream deadline. The application's bounded
  wrapper rejects correctly; strict fixture cleanup passes.
- [test-anywhere #148](https://github.com/link-foundation/test-anywhere/issues/148):
  the documented options overload skips its callback while native tests report
  success. The external diagnostic rejects that false green; the working
  two-argument control and the application's suites execute normally.

## Continuous public Telegram text evidence

Fresh read-only catchup represents every enabled Telegram seed, accounting for
case-insensitive canonical usernames. Checksum/window replay joins retained
baseline and continuous deltas into a window of at least 90 days. Every retained
message is accounted for and parser exceptions are zero.

Photo-only materials remain unresolved for independent review. Message
accounting and absence of exceptions do not establish zero extraction false
positives/negatives or complete OCR/room/bed/billing-basis truth. Private cohort
membership, workload counts, source bodies/media and credentials are not
published. The full native OCR/fresh-storage/photo path is a separate acceptance
run, not substituted by text replay.

A fresh live-store read during incomplete native backfill finds queryable offers.
Available bedroom and bed metrics equal property price divided by their extracted
counts. No live room denominator is exercised by this snapshot; room arithmetic
still has only finite fixture evidence. Unknown/nonpositive denominators are
excluded, and none of these arithmetic checks establishes independent field truth.

To cover older edited/deleted posts, an additional fresh full 90-day read-only
snapshot is collected across the enabled Telegram cohort. Its final completion
fails despite every frozen source receiving an outcome. Successful source reads
account for every retrieved message and have zero parser exceptions; failed
reads have no count evidence. Neither all frozen public channels nor all enabled
seeds have completed this fresh window. Comparing two undefined counts must not
produce a whole-cohort accounting pass.

The audit resumes its durable checkpoints using the documented four-worker
maximum on one client, without changing the source set, 90-day window, or
retained cohort fingerprint. Failed reads retain only generic `Error` type and
no bounded cause code. Separate bounded sequential resolution, next-page order/
advance and retained checksum probes eventually succeed for every failed read,
without rewriting a history page. They diagnose transient availability but do
not complete missing 90-day history or erase the failed snapshot. The cause of
the initial source errors is not independently isolated. This remains #183;
privacy-safe failure categorization is also requested in #205.

Intentional interruption of the waiting private coordinators initially produces
a false cleanup diagnostic: their child-close promise rejects on Node's
`AbortError` although the child stops. Exact worker absence is independently
verified. The one-off QA wrapper now waits for actual close without using that
expected spawn-abort error as a disposer failure. This is a QA orchestration
false positive, not an application failure or a passed history audit.

## Reproduced blockers

- [#200](https://github.com/konard/vietnam-accomodation-search/issues/200):
  healthy macOS Docker Desktop reports a Linux VM root. The new capacity guard
  passes that root to host `statfs`, rejecting `QA_CAPACITY_UNAVAILABLE` before
  image acquisition despite more than 30 GiB host headroom. The actual
  credential-pinned deploy drill rejects for the same reason. The no-credential
  reproducer preserves the full Docker baseline and verifies strict fixture
  cleanup. No capacity floor, lock or VM check is bypassed. Full production
  image smoke and cutover transitions remain uncertified.
- [#193](https://github.com/konard/vietnam-accomodation-search/issues/193):
  the original private bot configuration still does not authorize its verified
  owner. A passing configured temporary copy does not repair the original.
- [#183](https://github.com/konard/vietnam-accomodation-search/issues/183):
  complete source terminal pagination and independent live photo/bedroom/room/
  bed/billing-period review remain acceptance requirements. The latest numbered
  pagination fix does not certify every supported source or global optimality.
- [#205](https://github.com/konard/vietnam-accomodation-search/issues/205):
  the source-acceptance CLI discards even finite guard failure causes. A verified
  no-network/no-credential held-lock control reaches guard acquisition but emits
  no `QA_HEAVY_BUSY` diagnostic or private failure evidence. Privacy-safe bounded
  phase/code/category reporting is needed. Its external assertion intentionally
  stays red while exact owned fixture cleanup passes.
- [#206](https://github.com/konard/vietnam-accomodation-search/issues/206):
  matching value sorts omit explicitly per-bed, per-room and per-bedroom prices.
  The current conservative contract excludes all non-property billing bases;
  that is not an accidental regression, but leaves the requested per-unit
  comparison incomplete. A self-authored counterexample preserves unknown
  property totals while requiring the directly quoted matching unit metric.
  It stays red without a production change; scoped comparable pools and explicit
  quote/currency/period provenance are required, not invented denominators.
- [#207](https://github.com/konard/vietnam-accomodation-search/issues/207):
  two same-session native providers take live-update delivery away from the
  primary listener. Controlled isolated/overlap/after-overlap phases reproduce
  primary delivery, a primary miss with secondary receipt, then restored primary
  delivery after secondary destruction and a primary RPC. Both raw SDK and
  normalized primary listeners miss during overlap, excluding a filter-only
  assertion defect. Actual application wiring creates separate providers for
  discovery, availability and ingestion. Shared update ownership needs a fix;
  the original missed event is no longer merely an unisolated warning.

The readiness issues were reopened after automatic PR closure because these
original-host acceptance requirements remain unmet. QA controls and dependency
updates are committed; no production source fix is silently implemented here.

## Long-running and final acceptance

The larger native 90-day/OCR/fresh-clink/media/photo/restart run advances its
durable checkpoint and completes actual OCR, but reaches the unchanged one-hour
`QA_TIME_BUDGET` during native ingestion. Host space remains above its floor.
Fresh binary readback, photo delivery and restart acceptance are not reached.
The provider is destroyed; owned-message cleanup passes with zero leftovers;
independent readback finds its owned runtime directory absent. This evidence is
reported in #183, not presented as a complete native pass.

A separate lower-volume source from the current cohort completes actual OCR
with zero OCR failures, fresh clink-backed readback, original-body/graph checks
and native media preservation. It then stops at the notification selector:
no eligible cached-photo candidate is available. No synthetic offers are added,
no photo receipt failure is reproduced, and restart delivery is not reached.
Owned messages and the provider/runtime clean up successfully. This is an
unfulfilled acceptance precondition in #183, not grounds to reopen the distinct
fixed photo-receipt issue #185. The first attempt used a directory lacking the
required `e2e` marker and was rejected before acquisition; that QA input error
is corrected without weakening the guard.

After the larger run, serialized collection attempts every enabled public web
source, but fetch, terminal pagination and parsing are not all complete;
exclusions remain explicit. A separate read-only route audit attempts the whole
supported catalogue, including routes disabled in production. Its outcomes
include success, challenge, rate limiting, HTTP pending/not-found, zero cards,
unexpected error and incomplete parse. Neither attempt certifies independent
field review or complete all-source coverage. A premature overlapping guarded
attempt is not counted as collection or a parser defect.

Previously unexpected routes are repeated sequentially with private debug
evidence. They still produce an unexpected-error or zero-card result. A named
HTTP/2/QUIC protocol navigation failure is reproduced, not a proven parser or
Browser Commander defect. An initial diagnostic reader addressed the audit's
parent rather than its actual run-specific trace path and failed before any
browser acquisition; the verified-path repeat is the evidence reported in #183.

The final 0.31.1 queue again attempts every enabled web source, preserving
explicit exclusions and incomplete fetch/pagination/parsing flags. Its owned
runtime directory is removed. The whole supported-catalogue route audit again
finishes with success and also server errors, pending/not-found HTTP outcomes,
challenges, rate limiting, zero cards, unexpected errors and incomplete parsing.
The strict route wrapper reports no unexpected fixtures and verified teardown.
The universal example builds and ordinary frozen Deno again passes with
1,358 passed, 19 steps, zero failures and 11 explicit native-only exclusions.

The real native capability probe passes identity, resolution, popularity,
membership, combined history, native media and sending to the owner's bot, then
misses its live-update event within the unchanged observation window. A
same-session history reader is active; concurrency is observed context, not a
proven cause at that point. After other readers exit, the unchanged full native
capability probe passes live updates, send/restart idempotency, availability and
exact message cleanup as well as the earlier capabilities. The independent chat
cleanup matrix passes success, assertion failure, SIGINT, SIGTERM and read-only
audit, including text/photo/album cleanup.

The subsequent controlled native-client-sharing counterexample reproduces the
isolated/overlap/after-overlap pattern repeatedly using only two native providers,
not an unrelated history reader. It keeps the ten-second event assertion and
cleanup deadlines unchanged. Telegram documents update delivery through the
last active authorized connection in its
[official updates contract](https://core.telegram.org/api/updates). The
application must coordinate provider ownership; this is not claimed as a defect
in that documented upstream behavior. The reusable QA experiment is
`experiments/revalidation-native-update-client-sharing.mjs` and stays red solely
for the missing primary overlap event. Its final exact cleanup receipt proves
zero owned messages and preservation of all pre-existing messages; strict
fixture teardown passes. Earlier variants issue a redundant post-cleanup RPC
that does not finish in the disposer window. The final QA probe instead reuses
cleanup's terminal independent readback for the preservation assertion, with no
deadline widened. A separate read-only chat audit also finds zero known QA
messages after the earlier variants.

The real Docker cleanup exit matrix and deploy drill cannot acquire resources
because of #200; they are blocked, not claimed to pass populated-resource
teardown. The no-credential inventory control and original recovery do pass.
Bun's offline lifecycle serialization control passes.

The final acceptance remains red for the six linked application issues, despite
the finite suite and isolated capability passes. No claim of zero extraction
false positives/negatives, complete all-source parsing, full real photo delivery
or global best-offer ranking is made.

After the last owner-chat writer exits, the final independent read-only audit
finds zero known QA messages and passes strict temporary teardown. Final real
identity verification still finds the original configuration unauthorized,
without modifying it. Docker is reachable at server 29.5.3; all known owned QA
resources are absent and its inventory is unchanged since the unrelated image
observation. That image and shared cache are preserved. Both discarded native
runtime directories, the disposable web collection directories and the deploy
drill directory are absent. Intentional private history/review evidence remains
ignored and protected; it is not confused with a leaked test fixture.
