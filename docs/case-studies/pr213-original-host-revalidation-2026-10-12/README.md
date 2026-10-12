# Original-host revalidation of PR 213

QA-only validation of merged main `4fcf51f` on the original macOS host, using
the supplied real bot token and user session. Original credentials/configuration,
deployment records, user transcripts, unrelated Docker resources and shared
caches remain unchanged. Production fixes remain issue-driven.

This does not certify full production readiness, complete fresh all-source
history, zero field false positives/negatives or globally best offers. New
follow-up issues are used instead of reopening previous issues; no issue comments
are added.

## Immediate, complete Docker release

The user's release requirement is checked at each resource test's boundary,
before the next resource acquisition, not only at the end of the full QA run.

- Clean-cache guest-capacity bootstrap succeeds twice through the actual macOS
  Docker Desktop guard. A real guest measurement passes preflight on each run;
  exact ownership and original Docker inventory are preserved.
- The actual pinned production image builds in an isolated builder and passes
  its container smoke acceptance. On exit, an independent full-inventory audit
  immediately matches the pre-run baseline. Owned containers, networks, volumes,
  image references, builders/cache and capacity helper resources are removed.
- The actual populated Docker cleanup matrix passes success, setup failure,
  assertion failure, SIGTERM, SIGINT and worker SIGKILL with journal recovery.
  A new independent pre-mode/post-guard inventory assertion includes the helper
  and its image, which the inner resource ledger's baseline alone cannot prove
  removed. Every mode passes this assertion before the next mode begins.
- The credential-pinned cutover attempt stops before deployment at the distinct
  QA preflight issue below. Its independent full-inventory audit immediately
  matches the original baseline too. No deployment or marker send is reached.
- Resource producers are stopped/joined before exact deletion. Successful owned
  teardown is awaited before tests complete; failures remain failed. No global
  prune, arbitrary container deletion, guard bypass or repeated Docker restart
  is used.

The final read-only disk/cache audit distinguishes retained baseline images and
shared default-builder cache from run-owned garbage. Containers and volumes are
empty. All remaining default-builder cache records were created before this QA
run. The CLI's last-use display is not verified as absolute timestamps, so
unchanged last-use metadata is not claimed. No new default-builder record is
observed. Existing shared
entries are preserved rather than pruned; isolated owned builders/cache are gone.
This does not promise that Docker Desktop's host backing file shrinks immediately.

These results verify prompt release on the exercised paths, not an unconditional
guarantee under arbitrary daemon/filesystem failures. A failed external disposal
requires durable recovery evidence, which exposes a remaining QA defect.

## New QA blockers, independently reproduced

- [#214](https://github.com/konard/vietnam-accomodation-search/issues/214):
  the outer strict test runner deletes an inner retained recovery journal after
  an external cleanup failure. The self-authored filesystem-only control uses
  the real conditional retention policy, an independently present external
  marker and an injected failed disposer. The inner failure remains a failed
  exit, but the outer runner reports its own TMPDIR gone while erasing the
  journal needed to recover the surviving external resource. The control's
  parent cleans its own marker/fixture; no Docker resource is leaked by this
  counterexample. Real heavyweight external-resource acceptance is run directly
  under its own ownership scope, avoiding this known destructive outer wrapper.
- [#215](https://github.com/konard/vietnam-accomodation-search/issues/215):
  cutover QA's shared-token override rejects its own capacity helper. The
  independent original container inventory is empty, but `runOwnedDrill` takes
  the poller boundary after the storage guard has acquired its labelled helper.
  This produces the existing fail-closed container-inventory rejection before
  any cutover transition. A finite no-network counterexample also reproduces
  the ordering problem. Actual image smoke and cleanup passes do not substitute
  for the blocked first-deploy/redeploy/restart/readiness/rollback/snapshot drill.

Both counterexamples intentionally remain red and are outside the normal finite
suite. Their own fixture teardown passes. No production fix is implemented here.

## Runtime, pricing, browser and dependencies

- Node 24.21.0: 1,508 passing tests, zero failures/cancellations/skips. Coverage
  is 100% lines, 96.97% branches and 98.78% functions; not full branch coverage.
- Bun 1.4.3: 1,508 passing tests, zero failures, unchanged per-test timeout.
- Deno 2.9.6: ordinary frozen project configuration passes 1,391 tests and 19
  steps, zero failures, with 11 explicit native-only exclusions. An earlier
  manual-layout invocation lacked the implicit Node type package and ran no
  tests; that retained input failure is not reported as a product regression.
- Actual Browser Commander contracts, HTTP outcomes, private trace policy,
  process/profile ownership, managed recording/default-off and production
  recording-disabled controls pass.
- Explicit unit quotes, bedroom/bed/room metrics and scoped ranking controls
  pass. Unknown/nonpositive denominators and unsupported conversions remain
  unknown; per-person is not per-bed. Finite arithmetic is not independent live
  extraction truth.
- The actual installed SDK flood-wait counterexample passes direct and nested
  `source-resolution` / `rate-limited` / `FLOOD_WAIT` classification without raw
  wait values or credential-bearing error fields. Held-lock/source diagnostic
  controls remain passing; the repaired #211 is not reopened.
- Official npm metadata confirms every direct root and example dependency is
  current, including Browser Commander 0.31.1 and Command Stream 2.3.0. No
  dependency update is needed this run. Root/example advisory audits report zero
  vulnerabilities.
- Zero-warning lint, tracked-file formatting, duplication threshold and example
  web build pass. Added QA peer controls separately test pin mismatch, non-bot
  peers, unexpected username resolution, fallback identity and incomplete native
  peers; strict owned-fixture teardown passes.
  Final focused cleanup/capacity/peer/conversation controls pass all 47 tests.

Self-authored upstream [use-m #80](https://github.com/link-foundation/use-m/issues/80)
and [test-anywhere #148](https://github.com/link-foundation/test-anywhere/issues/148)
remain open and their original counterexamples remain red. Working bounded
application loading/two-argument testing mitigations are not substituted for
upstream fixes. No new Browser Commander defect is reproduced.

## Real Telegram and cleanup

Both supplied identities authenticate. Initial ordinary QA username resolution
hits the SDK rate limit before sending; affected public-source resolution stays
deferred until the actual provider cooldown, without early retries, deadline
expansion or identity rotation. Failed-attempt evidence is retained.

The same user already has a dialog with the independently verified bot. New
QA-only peer helpers use only its exact pinned bot entity/native input peer,
including its real access hash, with bounded operations. They do not fabricate
hashes, trust usernames as identity or inspect/report unrelated dialog bodies.
This is an alternative owner-only test path, not proof of public-source coverage.

- The owner operator configures a protected owned copy from the supplied
  session, retains private access and rejects an unrelated recipient. Actual
  privileged bot-only and degraded conversation E2E pass on that copy. Synthetic
  conversation fixtures are labelled test data, not genuine source offers.
- Actual validation-first/native-update sharing passes isolated, overlap and
  after-overlap phases under unchanged live-event assertions. The primary raw
  and normalized listeners receive every owner-only probe; overlapping transport
  ownership and validation release remain working. Owned messages are deleted,
  independent readback is clean and pre-existing messages are preserved.
- Actual text/media/album cleanup passes success, assertion failure, SIGINT and
  SIGTERM. The separate owner-chat audit finds zero known QA messages. Runtime
  producers/providers/profile state are disposed before owned messages/data.
- The unchanged original private environment still does not authorize its
  verified owner. New [#216](https://github.com/konard/vietnam-accomodation-search/issues/216)
  carries that operational configuration acceptance; closed #193 remains closed.
  Passing a configured copy is not repairing the original environment, and this
  QA-only run does not change it.

## Remaining all-source production acceptance

New [#217](https://github.com/konard/vietnam-accomodation-search/issues/217)
carries the unfulfilled all-source/native-history and independent-label gates;
closed #183 remains closed. The [prior original-host report](../pr209-original-host-revalidation-2026-10-12/README.md)
retains incomplete fresh Telegram catchup/full frozen 90-day resumption and
explicit challenged/rate-limited/pending/not-found/zero-card/parse-incomplete web
outcomes. The quota-bound public resolution is not repeated early in this run.

Previously completed continuous retained-history replay is separate evidence,
not a replacement for missing fresh latest/edited/deleted-message or native
media coverage. Photo-only review, a real eligible cached-photo notification and
restart, independent blinded offer/bedroom/bed/room/quote labels and measured
field precision/recall remain unfulfilled. No source is silently dropped,
challenge bypassed, positive label generated from parser predictions or synthetic
candidate seeded to complete a real-source gate.

## Ownership and handoff

Private live logs/evidence remain protected and ignored; public reporting has
only finite categories/booleans and finite-suite counts. Original `.env`, supplied
session environment, deployment records, protected review/history evidence,
user-owned transcripts and unrelated/shared resources remain intact. Supported
Node/npm/Deno installs and npm cache belong to this exact QA run and are removed
after all consumers and git hooks exit, not retained as test garbage.

Current original-host blockers are #214, #215, #216 and #217. They are distinct
from the locally verified clean-cache bootstrap/image/cleanup and SDK diagnostic
fixes. Automatic issue closure, green fixtures or an image build alone cannot
establish a fully production-ready all-source system.
