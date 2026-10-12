# Original-host revalidation of PR 219

QA-only validation of merged main `9897478` with the dependency updates below on
the original macOS host with the supplied real bot token and user session.
Production fixes remain issue-driven.
No issue comments or predecessor reopening are used. Original credentials,
deployment records, user transcripts and unrelated/shared resources are preserved.

This run does **not** certify complete production readiness, every fresh native
message/media item from every supported source, zero false positives/negatives,
or globally best offers.

## Verified finite and dependency checks

- Browser Commander is updated from 0.31.1 to 0.31.2, Command Stream from 2.3.0
  to 2.4.0, and Links Notation from 0.25.2 to 0.26.0. npm and Deno direct pins and
  integrity hashes agree. Official current npm metadata confirms every direct
  root and example dependency is latest; both advisory audits report zero
  vulnerabilities. Compatible older pre-1.0 transitive grammar ranges are not
  forcibly overridden.
- Node 24.21.0 and Bun 1.4.3 each pass **1,525 tests**, with zero failures. Node
  coverage is 100% source lines, 96.94% branches and 98.78% functions. The existing
  30-second per-test bounds are unchanged; full line coverage is not full branch
  or semantic correctness.
- Current Browser Commander contracts, HTTP outcomes, selector drift, trace
  privacy, process/profile ownership, default/managed recording and production
  recording-disabled controls pass. Current Links Notation reference roundtrip
  controls pass. No new Browser Commander defect is reproduced.
- Explicit unit quotes, bedroom/bed/room metrics and scoped ranking controls
  pass. Unknown or nonpositive denominators remain unknown; per-person is not
  substituted for per-bed. Arithmetic fixtures do not provide independent live
  field truth.
- SDK flood-wait and source diagnostic controls pass. Existing upstream
  [use-m #80](https://github.com/link-foundation/use-m/issues/80) and
  [test-anywhere #148](https://github.com/link-foundation/test-anywhere/issues/148)
  remain open and their separate original counterexamples remain intentionally
  red. Application safeguards are not removed on the strength of unrelated green
  tests. The maintained grammar migration is tracked in
  [lino-env #33](https://github.com/link-foundation/lino-env/issues/33).
- Zero-warning lint, duplication threshold and example web build pass. The new
  diagnostic files are manual counterexamples outside the ordinary finite suite.

Deno 2.9.6 passes the ordinary frozen project configuration: **1,408 tests and
19 steps**, zero failures, 11 explicit native-only exclusions. The subsequent
Node coverage rerun again passes all 1,525 tests. Tracked-file formatting passes
without modifying the user's untracked transcript. The initial Deno lock-update
attempt is rejected by the default package-age policy; a separate temporary
configuration produces an empty lock and is rejected as evidence. The real lock
is regenerated with temporary named package-age exclusions, the original policy
is restored, and the ordinary frozen test run above passes. Failed setup attempts
remain failed, not product regressions or passing tests.

## Real Telegram and owner access

Both real supplied identities authenticate. Pins are derived locally with GetMe;
no third identity, credential paste or manual test execution is requested.

- The unchanged original private bot configuration still rejects its verified
  credential owner for privileged commands. A protected disposable copy created
  with the supported private-owner helper passes privileged bot-only and degraded
  conversation E2E, while an unrelated recipient is rejected. A passing copy does
  not repair or certify the original configuration. New operational follow-up:
  [#221](https://github.com/konard/vietnam-accomodation-search/issues/221).
- Validation-first native-update sharing passes isolated, overlapping and
  after-overlap listener phases. Real text/media/album cleanup passes success,
  assertion failure, SIGINT and SIGTERM, with independent paged readback and
  preservation of pre-existing messages.
- Real native identity, resolution, popularity, read-only membership, combined
  history, media download, owner-only native send/live updates, combined send
  restart idempotency and availability-to-owner-bot probes pass. Known owner
  input-peer routing avoids unnecessary username resolution without fabricating
  an access hash or identity. These router probes are not the separate official
  combined-process harness requiring distinct runtime/driver identities.
  New [#226](https://github.com/konard/vietnam-accomodation-search/issues/226)
  requests locally executable two-identity combined-process tooling without
  weakening the independent-driver guard or pretending its cross-account
  scenario passed. The current same-account guard rejection is independently
  verified with synthetic numeric pins and no network acquisition.
- A real lower-volume source executes 90-day native ingestion, actual OCR,
  native-media preservation, fresh text/binary storage readback and complete raw
  graph coverage. No OCR failure is observed. Actual stored live offers exercise
  bedroom and room division; no eligible actual bed denominator or explicit unit
  quote is found, so those live cases are not claimed passed.
- The real-source workflow stops at notification: `No eligible native photo
offer is available for notification acceptance.` No synthetic offer/cache is
  seeded to make it pass. Actual real-photo notification and its restart gate
  remain unfulfilled. Its producer/message/runtime teardown passes.
- The final independent paged owner-chat audit passes with no known QA messages.

Only uniquely marked QA messages are written to the verified owner's bot chat.
Public channels and sites are read-only; no join, landlord inquiry, account
rotation or challenge bypass is performed.

## Docker release and deployment checks

Real clean-cache guest capacity acceptance passes twice. The actual pinned
production image builds and passes container smoke acceptance. Every completed
resource test has an immediate independent full Docker inventory comparison
before the next resource acquisition: containers, ordinary networks, volumes,
image references and isolated builders/cache return to the original baseline.
Owned capacity helpers are included in this boundary. Shared images/cache are
preserved, not pruned.

Initial real cleanup/cutover attempts fail. Protected actual traces distinguish
the transient Docker helper acquisition failure from a resource leak: Docker
returns `Error response from daemon: lease does not exist: not found` on the
helper-image pull. After a single idle Docker Desktop restart, all six actual
cleanup modes pass: success, setup failure, assertion failure, SIGTERM, SIGINT and
worker SIGKILL with journal recovery. Each mode independently restores the full
post-guard baseline before the next mode begins.

The following independently reproduced defects are filed as **new issues**:

- [#220](https://github.com/konard/vietnam-accomodation-search/issues/220): an
  interrupted deploy leaves an ownerless global `.deploy/operation.lock` and
  blocks subsequent cutover. The [actual CLI counterexample](../../../experiments/revalidation-deploy-signal-lock.mjs)
  uses synthetic module/command boundaries, no Docker/network/credentials, and a
  real SIGTERM after lock acquisition. The worker stops but the lock remains;
  fixture teardown still passes. The run-owned empty lock from the failed real
  cutover is quarantined recoverably only after checking its exact inode, birth
  time, owned acquisition window and absence of active owned producers. Original
  deployment records and any active lock are not deleted.
- [#223](https://github.com/konard/vietnam-accomodation-search/issues/223): the
  finite Docker diagnostic sanitizer drops the known `pull` operation to
  `unknown`. The [sanitized-daemon control](../../../experiments/revalidation-qa-docker-operation-diagnostics.mjs)
  preserves actual stderr grammar and checks the existing inspect control. It is
  intentionally red, with no external resources acquired. This is diagnostic
  fidelity, not an application-caused daemon error or observed resource leak.

The post-restart drill executes all six default transitions. First deployment,
redeploy and explicit rollback return zero; the intentionally missing-image
preflight rejects. However, unhealthy-candidate restoration remains unhealthy
and subsequent recreate returns one. Protected actual logs report
`Deploy failed during restoring the previous service: Candidate became unhealthy while waiting for readiness.`
Some marker commands lack a matched reply in their transition window; neither
duplicate marker replies nor multiple simultaneous app pollers are observed.
Late replies/backlog must be reconciled before calling these permanently lost.
Preset/subscription cleanup commands fail to receive expected responses, but
the entire disposable runtime data is subsequently removed. Chat/project cleanup
passes, full Docker inventory is immediately restored, and the global operation
lock is absent. New focused follow-up:
[#224](https://github.com/konard/vietnam-accomodation-search/issues/224).

The live fingerprint comparison also produces a separately reproduced QA false
positive: ordinary additive trace activity, with an independently verified
unchanged existing record, fails the live transition gate as `collections
changed`. The [actual-store counterexample](../../../experiments/revalidation-cutover-live-mutation.mjs)
is intentionally red and cleans its fixture. This is not proof of actual
corruption, and does not suppress the independent readiness failures. New
[#225](https://github.com/konard/vietnam-accomodation-search/issues/225) records
this preservation/mutation distinction.

Default transitions exclude the explicit Linux-only `systemctl` daemon-restart
transition; the actual macOS idle Desktop restart above is separate evidence,
not that Linux transition's pass.

## Every supported source and the 90-day boundary

Fresh latest Telegram catch-up passes the entire retained cohort: every enabled
production seed is represented and every retrieved text message is accounted for,
with no parser exceptions. A separate copy-on-write resumed full frozen 90-day
refresh remains incomplete at source resolution, with transport-failure and
unknown categories. Enabled production seeds are among these failures, and the
same seeds appear in the successful fresh catch-up. They are not silently
discarded as stale sources. One subsequent bounded copy-on-write resumption also
fails at source resolution with the same categories; no mandatory long-wait
cooldown is recorded. Failed snapshots are retained unmodified. An initially
incorrect relative QA preload path fails before acquisition and is not counted
as a provider/product failure.

Continuous retained **90-plus-day parser replay through the new catch-up passes**
checksum/window/whole-cohort accounting with no parser exceptions. It cannot
discover previously deleted posts, fresh edits/deletions or missing native
media/OCR, and is not a precision/recall evaluation.

Every enabled web source is attempted. Some fetch/parse stages pass while
pagination remains incomplete; another returns SOURCE_TIMEOUT. The manifest of
all supported web routes is also attempted, including disabled routes without
enabling them in production. Non-success outcomes include zero cards, pending
HTTP, rate limiting, navigation timeout, not found, challenge and incomplete
parsing. No source limitation is counted as complete collection. Authenticated
local browser access is requested so the QA agent can investigate existing
account sessions directly, without asking another agent/user to execute tests.

No independently attested blind live labels are supplied for the eight-field
acceptance gate: price, period, billing scope, currency, bedrooms, rooms, beds and
location, with positive and negative examples in each field. No parser prediction
is relabelled as independent truth. Personal-data substitutions in public
evidence preserve field names, types, nesting and provider error grammar, but do
not invent passing runs or labels. New acceptance follow-up:
[#222](https://github.com/konard/vietnam-accomodation-search/issues/222).

## Final ownership and handoff

The final independent audit passes: original configuration digests are unchanged,
the entire Docker inventory matches baseline, no owned Docker or runtime workers
remain, disposable runtime directories and automatic checkout traces are absent,
the global deployment operation lock is absent, and successful recovery
namespaces are empty. The final paged chat audit is clean. Read-only cache
inspection on the active and default Docker contexts finds only cache records
created before this run. Last-use metadata is not claimed unchanged and shared
cache is not pruned. Logical resource release does not promise immediate physical
shrinkage of Docker Desktop's backing file.

Temporary Node/npm/Deno installs, CLI hook shims and owned caches are removed
after the last git-hook consumer exits; the exact cleanup and final handoff
receipts remain private. Private live logs, review packs, failed snapshots and
recoverable empty test-lock evidence are preserved and ignored; they are not
published or confused with active test resources. No broad Docker prune,
shared-cache deletion, original configuration change or production fix is
authorized by this QA-only retest.

Remaining application/local acceptance blockers are
[#220](https://github.com/konard/vietnam-accomodation-search/issues/220),
[#221](https://github.com/konard/vietnam-accomodation-search/issues/221),
[#222](https://github.com/konard/vietnam-accomodation-search/issues/222) and
[#224](https://github.com/konard/vietnam-accomodation-search/issues/224).
QA diagnostic/false-positive/tooling follow-ups are #223, #225 and #226. No green finite suite,
passing synthetic fixture, automatic predecessor closure or image smoke result
is substituted for these missing live gates.
