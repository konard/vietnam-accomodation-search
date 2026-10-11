# Issue 208: requirement inventory, research and acceptance

This single PR covers [#208](https://github.com/konard/vietnam-accomodation-search/issues/208)
and its six child issues. Each description and every conversation comment was
read, along with PR 209's conversation, inline comments and reviews. Recent
merged [PR 204](https://github.com/konard/vietnam-accomodation-search/pull/204)
and [PR 196](https://github.com/konard/vietnam-accomodation-search/pull/196)
establish the existing pagination, source review, private-owner and resource
ownership contracts. Their implementation is retained rather than treating the
reopened operational requirements as new parser bugs.

Four implementation gaps are reproduced and repaired: explicit unit metrics,
same-session native client ownership, Desktop capacity measurement, and bounded
source/history failure diagnostics. The original supplied configuration,
authenticated session, independent live labels, macOS Docker host and historical
recovery journal are unavailable in this workspace. Therefore the original
operational acceptance in #183/#193 and the real-host reruns of #200/#207 are
**not certified**. Self-authored tests establish behavior, not independent live
field accuracy or an original-host acceptance result.

## Every issue requirement and comment constraint

The identifiers below make the implementation and remaining evidence separately
reviewable. “Existing” means the functionality is already in the base and its
tests are retained; it does not mean a live acceptance gate has passed.

| ID     | Requirement                                                                                                                       | Solution and verification plan                                                                                                                                                                                                           | Result here                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 208.1  | Read every child issue and all comments; handle all work in one PR.                                                               | Trace each code path, preserve comment corrections and record every requirement here.                                                                                                                                                    | Completed in PR 209.                                                                   |
| 208.2  | Do not defer to another PR; include a full closing keyword per child and parent.                                                  | Update PR 209, preserving all seven required `Fixes` references. Explicitly distinguish acceptance limitations from resolved code defects.                                                                                               | One branch and PR; operational evidence remains absent.                                |
| 208.3  | State already-resolved or non-reproduced findings explicitly.                                                                     | Preserve the repaired legacy-credential operator, resumable gate and original journal recovery report. Do not allege a new parser, photo-receipt, single-client event or historical I/O root cause.                                      | Findings below and in the PR.                                                          |
| 183.1  | Live resumable source-by-source acceptance over every supported entry.                                                            | Existing source inventory/status/collection/review workflow; persist independent per-source observations and checkpoints. Run the gate with actual original inputs before certifying readiness.                                          | Existing implementation; original live evidence unavailable.                           |
| 183.2  | Establish exhaustive web pagination, fetch and parsing separately.                                                                | Existing durable numbered/preview pagination and terminal evidence. Keep gaps, JavaScript-only controls, bounded stops, empty cards and parse failures incomplete.                                                                       | Retained; no global completion claim.                                                  |
| 183.3  | Honest challenged, rate-limited, pending, inaccessible, not-found and unsupported exclusions.                                     | Preserve fail-closed collection outcomes and inventory capability exclusions. Use lawful accessible/API paths; never bypass access controls.                                                                                             | Retained.                                                                              |
| 183.4  | Complete native 90-plus-day history including native media and photo-only OCR/review.                                             | Existing frozen resumable cohort, native media download/OCR and private independent review. Require full accounting, native history, media and review gates together.                                                                    | Retained; complete original live media acceptance unavailable.                         |
| 183.5  | Reliable latest-offer coverage during unfinished historical traversal.                                                            | Existing current-page publication and incomplete checkpoints; preserve current results while the older tail remains incomplete.                                                                                                          | Existing incremental-ingestion controls retained.                                      |
| 183.6  | Independent blind labels for bedroom, room, bed, quote basis and period.                                                          | Existing blank label template, material digests, reviewer independence/blinding attestations and photo-review flag. Never generate “independent” labels from predictions.                                                                | No reviewer labels manufactured.                                                       |
| 183.7  | Measure false positives/negatives and field precision/recall.                                                                     | Existing field metrics require positive evidence and thresholds; empty labels or stale/mismatched observations cannot pass.                                                                                                              | Existing tests; independent live metrics unmeasured.                                   |
| 183.8  | Do not equate an older text replay, a smaller photo case, arithmetic or green runtime suites with current all-source acceptance.  | Preserve separate dates, windows and completion states. An eligible photo notification and restart/readback remain separate gates.                                                                                                       | Explicit limitation.                                                                   |
| 183.9  | Fresh failures without counts must not pass through undefined-equals-undefined comparisons.                                       | `historyCoverageComplete` now requires each expected outcome, explicit completion, a nonnegative safe-integer message count and matching messages/unique IDs/accounted counts with zero parser errors.                                   | New missing-count, mismatch, empty, sparse and parser-error controls pass.             |
| 183.10 | Preserve the frozen cohort/window fingerprint and bounded four-worker maximum on one client.                                      | Existing history source planner and checkpoint fingerprint stay unchanged; diagnose failures before rerunning the same cohort.                                                                                                           | Existing offline history helper suite passes.                                          |
| 183.11 | Distinguish HTTP/2/QUIC navigation errors from demonstrated parser defects; no workaround may certify exhaustive coverage.        | Preserve unexpected-error outcomes and private debug ownership; do not silently switch protocols or add bypasses.                                                                                                                        | No new parser/protocol defect inferred.                                                |
| 183.12 | Keep membership, bodies, media, workload details and credentials private; honor finite time/disk guards and exact cleanup.        | Existing owned runtime data, message ledger, cleanup scope and storage guard remain. Publish finite self-authored controls only.                                                                                                         | Strict local teardown passes.                                                          |
| 183.13 | Keep global best/cheapest unverified until live whole-catalogue completeness and independent truth pass.                          | Require fetch, terminal pagination, parsing, native media, independent review and comparable billing scope together. Preserve explicit inaccessible-source exclusions and the gate’s unverified global-optimality result.                | Original global-best acceptance remains unverified.                                    |
| 183.14 | Preserve the original one-hour native QA guard; require actual binary readback, eligible photo notification and restart evidence. | Resume the same full cohort within existing bounded phases; treat successful current-offer/OCR or a lower-volume case as its own evidence. Do not widen the guard or manufacture a cached-photo candidate.                               | Full original native acceptance unavailable; guard and selector retained.              |
| 193.1  | Configure the original private production environment's approved owner/user/chat IDs.                                             | Existing `configure-private-owner.mjs` derives the numeric owner from the supplied session, preserves existing approvals and credentials, writes atomically and privately. Execute against the original file only when available.        | Original file/session absent; not configured here.                                     |
| 193.2  | Reuse existing session/token/identity; support original legacy credential aliases.                                                | Existing shared credential resolver and private owner workflow already repaired in PR 204. Keep alias/pin ambiguity rejection and original representations.                                                                              | Existing credential and owner tests retained.                                          |
| 193.3  | Keep public access closed and unrelated recipients unauthorized.                                                                  | Preserve private access policy; test the registered privileged command and unrelated-user rejection. No fabricated default IDs or public mode.                                                                                           | Existing self-authored operator/command controls pass.                                 |
| 193.4  | Actually invoke a privileged command under the original configuration, not a temporary copy.                                      | Require original-config owner authorization and actual bot conversation evidence independently of container health.                                                                                                                      | Not verified; original-host comments confirm only a protected copy passed.             |
| 193.5  | Never commit real IDs, original environment contents or session secrets.                                                          | Record availability of inputs only. No private configuration edits or public secret outputs.                                                                                                                                             | Preserved.                                                                             |
| 200.1  | Serialize storage-heavy native, image, source, audit and cutover work.                                                            | Existing shared host lock remains; the common storage helper applies to every participating Docker caller.                                                                                                                               | Existing lock/floor tests retained.                                                    |
| 200.2  | Fail closed with preflight, bounded monitoring and abort before cleanup.                                                          | Preserve 8 GiB preflight, 2 GiB runtime floor, bounded checks and abort signal. Check both Desktop host backing storage and daemon guest capacity.                                                                                       | New low-host, low-guest, unknown-capacity and floor controls pass.                     |
| 200.3  | Stop owned producers, preserve journals on failed cleanup, preserve unrelated resources/cache; no prune or factory reset.         | Capacity helper is reserved in a private journal before creation and deleted only by exact random name plus ownership label. Failed helper cleanup retains journal and lock.                                                             | Recovery and full existing ownership suites retained.                                  |
| 200.4  | Do not infer concurrent work caused historical I/O corruption; original recovery must be explicit.                                | Original-host comment reports exact journal recovery and baseline verification after the requested restart. This workspace has no original journal; no restart/reset is performed.                                                       | Historical cause unproven; reported original recovery already resolved.                |
| 200.5  | Healthy macOS Desktop cannot host-statfs `/var/lib/docker` inside its VM.                                                         | Identify the effective local daemon/context, locate its host `Docker.raw`, host-statfs that backing filesystem and measure free guest bytes with an owned read-only local-image helper.                                                  | Desktop doubles reproduce before and pass after; actual Linux daemon guard passes.     |
| 200.6  | Image and credential-pinned cutover acceptance must not bypass floors or claim success before actual execution.                   | Both continue calling the shared guard. Require original-host reruns for final macOS/image/cutover evidence.                                                                                                                             | Not certified here; no original macOS host/configuration.                              |
| 205.1  | A held heavy-run lock must produce actionable `QA_HEAVY_BUSY` metadata.                                                           | Real source-command reproducer reaches guard acquisition and preserves the unrelated held lock; emit finite code/phase/category and owned private `failure.json`.                                                                        | Same no-network repro fails before and passes after.                                   |
| 205.2  | Distinguish serialization, capacity, acquisition, collection and cleanup without raw text/paths/identities/material.              | Shared finite whitelist, phase tags, categories, normalized flood-wait code and bounded nested causes (depth two, four children). Unknown arbitrary codes/types are suppressed.                                                          | Privacy, generic transport, RPC, cyclic and nested-cleanup controls pass.              |
| 205.3  | Private error evidence must be bounded and written only in an explicitly owned output.                                            | Root evidence begins only after output creation; atomic private-mode writes. A failure to write evidence yields only sanitized metadata.                                                                                                 | Real private-file assertion passes.                                                    |
| 205.4  | History audits also need safe resolution/page/checksum/analysis failure information; no asserted parser cause.                    | Tag resolution/RPC/checkpoint/checksum/page/date failures and parser findings; retain bounded summaries in failed source outcomes.                                                                                                       | Offline history tests and diagnostics controls pass.                                   |
| 205.5  | Do not publish source membership/workloads/raw SDK exceptions or accept absent accounting.                                        | Public root failures contain only finite metadata; private reports retain existing ownership. Strict numeric accounting described in 183.9.                                                                                              | No source material published.                                                          |
| 206.1  | Known per-bed, per-room and per-bedroom prices must expose the matching metric even without counts.                               | Reuse rent/period validation for direct unit quotes; keep independent unit metric provenance.                                                                                                                                            | Original external assertion and new focused tests pass.                                |
| 206.2  | Preserve basis, original currency/FX, quoted period and stay-estimate policy.                                                     | Existing conversion evidence travels with direct quotes; optional stay conversion uses the same explicit 7/30/365-night conventions.                                                                                                     | VND and foreign-currency/stay controls pass.                                           |
| 206.3  | Property totals and unsupported cross-unit conversions remain unknown; do not invent counts.                                      | Only the matching explicit metric is supplied; property-derived metrics still require exact positive counts.                                                                                                                             | Missing/count-present, invalid amount/period and cross-unit controls pass.             |
| 206.4  | Scope comparable inventory; keep per-person and shared-bed/exclusive-property distinct.                                           | `--comparison-basis` selects property, bedroom, room or bed; mixed-basis value ordering without a selection is excluded with a reason. Person is not a bed pool. A selected unit basis supplies its matching default sort/filter metric. | Search/filter/parser tests pass.                                                       |
| 206.5  | Apply through all consumers; this is a missing feature, not evidence of live independent accuracy.                                | Shared comparator/search ranking, CLI/bot option parser, bot usage/formatting, presets' generic search options and public types. Example consumers use this shared search service.                                                       | Source audit completed; property-price behavior retained.                              |
| 207.1  | Diagnose isolated/overlap/after-overlap loss, including raw events, rather than only source filters.                              | Use Telegram's last-active-connection rule and a finite competing-transport regression. Share the native transport for one credential/session/factory within the process.                                                                | Before counterexample and after event assertions; no new real-credential run possible. |
| 207.2  | Coordinate discovery, bot availability, ingestion and every same-session application entry point.                                 | Shared leases cover native providers, standalone availability, session validation/revocation and the real-source QA observer's application factory. Separate authorizations remain separate.                                             | Concurrent ownership, standalone operations and listener controls pass.                |
| 207.3  | Respect registration readiness, safe update handling and lifecycle; secondary teardown cannot kill the primary.                   | Deduplicate concurrent opening; validate every owner pin; own each provider's listeners; join registration before close; destroy only on final lease. Preserve mtcute's existing update/difference machinery.                            | Registration/teardown/pin/reconnection tests pass.                                     |
| 207.4  | No new token/session, private IDs, widened observation window or ordinary history polling substitute.                             | Reuse exact authorization; keep original live probe event assertion/deadline unchanged. Pool keys are hashes and are never logged.                                                                                                       | No credentials requested, no event assertion changed.                                  |
| 207.5  | An isolated successful single-client run is not proof that overlap is safe; exact external cleanup differs from empty TMPDIR.     | Preserve existing owner-only native repro's ledger, independent terminal readback and unowned baseline checks. Label local doubles separately.                                                                                           | No external message cleanup receipt invented.                                          |
| 207.6  | Competing independent Teleproto/native processes remain a coordination risk.                                                      | Application leases cover one process/factory. Operator acceptance must stop competing same-authorization readers before live-event phases; do not claim cross-process pooling.                                                           | Documented limitation; existing exclusive acceptance sequencing retained.              |

## Root causes, alternatives and selected plans

### Explicit unit quotes

`quoteTotal` correctly rejected non-property billing, but `unitValues` used only
that rejected total. The direct matching quote was therefore discarded along
with unsafe property arithmetic. The fix supplies that quote separately while
retaining unknown totals/cross-unit metrics. A generic division library would
not solve the semantic distinction between exclusive-property and shared-unit
inventory. Implicitly multiplying by counts was rejected because the supplied
count does not establish the offered property total or cross-unit billing.

The search service now selects comparable known-metric candidates before
testing period/basis compatibility. Explicit basis selection filters the pool;
mixed bases otherwise remain excluded. The parser, public types and user help
expose the same option. Newest searches retain their prior behavior. An explicit
quote has `metricProvenance: explicit-unit-quote`; derived metrics identify
property-total division and retain denominator evidence.

### Native ownership

Telegram documents delivery to the last active authorized connection in its
[updates specification](https://core.telegram.org/api/updates). This explains
the issue's raw-event isolated/overlap/after-overlap receipts. It is evidence
for an application connection-ownership problem, not a demonstrated upstream
SDK defect. [mtcute update handling](https://mtcute.dev/guide/intro/updates)
already provides update and catch-up machinery. Disabling a secondary's local
callbacks alone does not prove that Telegram will route events to the primary.

A shared refcounted transport was selected over a new authorization, history
polling, larger deadlines or replacing the SDK dispatcher. It keys numeric API
ID, API hash and normalized native session under the factory identity; hash
keys are internal. Each logical owner still validates its identity pin. Its
listeners are separately disposable. Open/close failures that cannot quiesce
the transport block replacement, preserving the cause instead of reopening a
possibly competing client. Successful final close permits a later reconnect.
Validation-first acquisition also starts the SDK's native update processing
before ingestion can borrow the authenticated transport; `getMe` alone does
not establish that readiness. A reverse-order event control reproduces the
missing processing and verifies the shared listener receives the event.

[mtcute storage guidance](https://mtcute.dev/guide/topics/storage) also warns
about reusing exported sessions across IPs. This patch shares an existing local
authorization; it neither makes cross-host/cross-process use safe nor assumes
that all external Teleproto readers participate. The manually invoked audits
must remain serialized against live event acceptance on that authorization.
New login/rotation deliberately creates a new authorization and is not pooled
with the existing one; validation and revocation of the existing session are.

### Docker Desktop storage

[Docker's macOS disk documentation](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/macfaqs/)
describes the Linux VM's single sparse backing image and the difference between
its logical limit and host allocation. Neither a host VM-root pathname nor the
disk's configured maximum measures currently usable guest space. A host-only
check would also miss an exhausted VM; a guest-only check would miss exhausted
host backing storage. Both measurements are required.

The helper identifies the effective local Unix daemon via
[context inspection](https://docs.docker.com/reference/cli/docker/context/inspect/),
uses a validated explicit `QA_DOCKER_DISK_IMAGE` or existing Desktop settings
and the standard backing file, and rejects remote/unknown configurations.
[Desktop settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
document the settings file and movable disk location. A configured moved
location never falls back to another drive. Unknown locations fail closed;
an explicit image path supports installations whose settings differ.

Host free bytes use `bavail * bsize` with BigInt as defined by
[Node's statfs API](https://nodejs.org/download/release/v22.18.0/docs/api/fs.html).
A previously cached `moby/buildkit:buildx-stable-1`, `busybox:1.37.0`, or explicit
`QA_DOCKER_CAPACITY_IMAGE` is inspected and pinned to its image ID. No image
pull/build is performed by the capacity check. Its root filesystem's `df -Pk /`
reports the guest overlay's available blocks. Malformed or failed output is
unknown capacity, never success. The monitor applies the same 8/2 GiB limits
to both host and guest.

The [Docker create controls](https://docs.docker.com/reference/cli/docker/container/create/)
bound the read-only helper to 32 MiB memory, 16 PIDs and 0.1 CPU, no network,
no added capabilities and no new privileges. Declared image volumes are
overridden by bounded tmpfs to prevent anonymous-volume leakage. It has no
source/credential/socket mounts. Exact private name/label ownership is
journalled before creation. Every failure attempts exact cleanup, and failed
cleanup preserves the lock/journal. No shared image/cache/container reset or
prune is used. Native Linux continues checking its host-visible daemon root.

For recovery after an interrupted probe, stop the recorded producer, verify
the existing heavy-lock owner and baseline, then call
`recoverDockerCapacityProbe(dockerCommand, journalPath)` from the two QA modules.
It accepts only the exact matching random capacity name/token and leaves the
heavy lock for the surrounding verified recovery workflow. Never remove the
lock merely because its PID looks stale.

### Source and history diagnostics

The root source command discarded every cause. A real held-lock command test
therefore exited correctly yet provided neither `QA_HEAVY_BUSY` nor a private
failure category. History failures additionally lacked operation phases. The
shared sanitizer exposes finite type/phase/category and whitelisted codes,
including normalized RPC/flood-wait information. It bounds recursive causes
and classifies bounded generic transport text without retaining the text.

Raw exception dumps were rejected because they can expose private paths,
membership, material and SDK credential metadata. Adding another logging SDK
would not enforce the acceptance command's privacy schema. Existing atomic
private writes are reused only after the command owns its explicit output.
Failed history outcomes cannot pass completion without numeric accounting.

## Existing components and libraries considered

| Component                                                                                                 | Potential use                                                                          | Decision                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [mtcute dispatcher](https://mtcute.dev/guide/dispatcher/handlers)                                         | Group/child event routing and existing difference handling.                            | Retain the installed SDK's emitters and update machinery; pooling transport ownership is the missing behavior. A new dispatcher would not fix multiple connections.                                                        |
| [p-limit](https://github.com/sindresorhus/p-limit) and [p-queue](https://github.com/sindresorhus/p-queue) | Bounded asynchronous task concurrency.                                                 | Existing history workers, schedulers and discovery queue already bound work. Limiting tasks cannot ensure one shared live connection, so no dependency added.                                                              |
| [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile)                                     | Interprocess mkdir locks, heartbeat and stale-lock handling.                           | Existing QA lock deliberately requires exact journal recovery instead of automatic stale takeover. Preserve its cleanup semantics; a library migration is unnecessary.                                                     |
| [Tesseract](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)                              | Real photo text extraction using existing language/data tooling.                       | Already integrated. [Input quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) can improve OCR, but no OCR library can supply independent reviewer truth or certify unseen photo-only messages. |
| [Playwright](https://playwright.dev/docs/api/class-page)                                                  | Actual navigation/pagination and controlled browser evidence.                          | Existing collectors and browser adapters use it. Keep bounded lawful navigation and terminal evidence; do not treat an intercepted fixture as live source acceptance.                                                      |
| Existing `source-acceptance-lib`, media cache, owner operator and QA cleanup/ownership ledgers            | Independent labels, semantic metrics, original private setup, exact resource recovery. | Reuse and extend these established components rather than create a second acceptance or authorization system.                                                                                                              |
| Existing Changesets release workflow                                                                      | Prepare the next release without conflicting manual version bumps.                     | Add a patch changeset; retain the package version and automated release process.                                                                                                                                           |

## Reproduction and validation

Before implementation, preserved local logs show unavailable direct unit
metrics, missing real-command guard diagnostics, Desktop VM-root rejection and
the finite same-session event-stealing counterexample. After implementation:

```bash
node scripts/test-with-cleanup.mjs node experiments/revalidation-explicit-unit-quotes.mjs
node scripts/test-with-cleanup.mjs node experiments/revalidation-source-acceptance-diagnostics.mjs
node scripts/test-with-cleanup.mjs node --test --test-concurrency=1 tests/issue-200-desktop-capacity.test.js tests/issue-205-diagnostics.test.js tests/issue-206-unit-quotes.test.js tests/issue-207-client-sharing.test.js
node scripts/test-with-cleanup.mjs node experiments/test-telegram-90-day-coverage-audit.mjs
QA_DOCKER_CAPACITY=1 node scripts/test-with-cleanup.mjs node experiments/revalidation-docker-desktop-capacity.mjs
QA_DOCKER_CAPACITY=1 node scripts/test-with-cleanup.mjs node experiments/issue-208-docker-guest-capacity.mjs
npm test
node scripts/test-with-cleanup.mjs bun test --timeout 30000
node scripts/test-with-cleanup.mjs deno test --frozen --allow-read
npm run check
```

The Docker command is an actual **Linux** daemon check here, not a real macOS
Desktop acceptance. Desktop semantics use finite command/filesystem doubles;
the historical original-host journal and image/cutover transitions are not
claimed. An additional actual guest-helper attempt reaches Docker container
start but this nested container's cgroup configuration rejects runtime creation.
The owned helper/image are removed, the full daemon baseline is restored and
strict temporary teardown passes. Resource limits are retained; this local
environment failure is not described as a passing measurement. The existing
amd64/arm64 image CI jobs now run this credential-free helper acceptance on
their native runners. Tests leave no unexpected fixture leftovers and verify owned
temporary-directory teardown. Deno's existing read-only boundary is retained;
native subprocess/filesystem-writing controls run under Node/Bun instead.

Local logs remain in gitignored `ci-logs/`. Large reports are read in bounded
chunks. Builds/suites run sequentially within the 2.92 GiB container budget;
no unbounded stress or parallel compiler build is launched. Required real
clink and native architecture image validation use the adequately provisioned
existing CI runners rather than an unverified local build claim.

## CI investigation and final evidence

The initial failed run
[38165408580](https://github.com/konard/vietnam-accomodation-search/actions/runs/38165408580)
was created at 2026-10-11 18:49:15 UTC on placeholder SHA
`62d8b0269f730ed71b45c86f95436ce12b82bbeb`, before the implementation. Its full
log is preserved privately as `ci-logs/initial-38165408580.log`. Lines 5664–5666
report zero newly added changesets and “No changeset found in this PR”; lines
14881–14884 show the corresponding failed gate. The new patch changeset
addresses that specific error. Release-preflight informational warnings about
external publishing credentials are not the failed PR job and are not hidden
by changing policy.

Final runtime counts, check results and final-commit CI links are recorded in
the PR description after validation. CI must be assessed by timestamp and head
SHA; a passing earlier run cannot establish the final revision. No operational
acceptance receipt is inferred from green CI.

## Original-input operational execution plan

For #183, resume the original frozen cohort with its exact checkpoint/window,
attempt every enabled source through the lawful collector, retain terminal
fetch/parse/pagination outcomes and native media accounting, and complete
blind independent labels before running review/status. Keep all observed
unavailable sources incomplete/excluded. Require fresh native readback,
eligible actual photo notification, restart checks and exact owned cleanup
where applicable. Neither smaller cases nor old replay closes the whole-cohort
gate. The supplied inputs and independent human review are absent here.

For #193, run the existing owner workflow against the **original** protected
configuration using its already-supplied session and intended owner approval.
Verify private policy and rejection of an unrelated recipient, then execute a
registered privileged command under that exact configuration. A temporary
copy's successful command does not certify the original. No original file is
available to modify in this workspace.

For #200, rerun the unchanged no-build probe on the original healthy Desktop
host, with the correct backing disk and an already cached compatible helper
image. Only after both capacity measurements pass, run actual image smoke and
credential-pinned cutover with their existing ownership/recovery ledger.

For #207, stop independent same-session readers first; rerun the existing
owner-only live probe with its unchanged isolated/overlap/after-overlap event
assertions. Then run the actual capability and source workflows using shared
application clients. Preserve raw-event receipts, exact owned-message deletion,
terminal independent readback and all unowned baseline messages. This checkout
cannot produce those receipts without the original supplied authorization.
