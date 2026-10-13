# PR 241: original-host revalidation

Tested merged main `9b1f791` on October 13, 2026. All twenty previously listed
issues were closed by the merged implementation. Closure was not treated as live
acceptance. This handoff changes QA experiments/documentation only; production
fixes remain assigned through new issues.

## Verified fixes and finite suites

- Node 24.18.0, real clink 1.0.0: **1,575 passed**, zero failures, 100% lines,
  97.03% branches and 98.81% functions. Bun 1.4.3: **1,575 passed**, zero failures.
  Both strict runners verified temporary teardown and no pending recovery journal
  at completion; the owned Node compile cache was removed.
- All ten original quote, intent, context, denominator, amenity, weak-merge and
  unprefixed-cleanup reproductions now pass. Additive-state, finite Docker
  diagnostics and bounded offline import controls pass. The watchdog control
  deliberately exits nonzero after containing its escaped timer and verifies
  cleanup; an initial QA aggregator wrongly expected zero, and its failed
  aggregate is not reported as a passing run.
- Reviewed stored/parser value corpus controls pass. This curated corpus does
  not independently attest every field from every live source.
- Offline Chromium exercises actual primary detail-status extraction for active,
  expired, rented and unknown fixtures, excludes misleading recommendations,
  blocks source network requests and closes the browser.
- All six real Docker controls pass: success, setup/assertion failure, SIGINT,
  SIGTERM and hard-kill recovery. Every control restores its complete baseline
  immediately before the next acquisition. No shared pruning was performed.

## Real collected data and upgrade boundary

All ten selected public Telegram posts were checked again in per-source batches.
They still exist, parse as monthly whole-property VND offers and match their
previously reviewed quotes. Fresh canonical save/readback now preserves **ten**
distinct posts, correcting the previously reproduced nine-record false merge.
No fabricated unit IDs, joins or public messages were used. Private evidence is
cached in `data/live-link-checks-pr241-2026-10-13.json`; the reviewed partial
shortlist remains available locally, without confirming landlord availability.

Current-parser checksum/window/whole-cohort replay of continuous retained
90-plus-day history passes through `2026-10-12T14:03:28.334Z`, with no parser
exceptions and complete message accounting. Its strict envelope encountered a
recovery journal from a separate concurrent source run and returned failure;
the actual completed replay is reported separately, not as an envelope pass.
Retained text replay cannot establish fresh edits/deletions, complete media/OCR
or independent all-source precision/recall.

The actual old warm cache remains unsafe for automatic ranking. The new
streaming cache-only query succeeds with the ordinary runtime and zero source
requests, but returns a literal **4 VND/month** pre-fix record whose stored review
flag is false. Reparsing its exact raw text with the fixed parser requires
review. A new cleanup-safe, self-authored legacy normalized-record regression
also reproduces this after fresh storage readback. See issue 244. The root cache
and original source timestamps were preserved, not deleted to make a cold-store
test pass. An additional 128 MiB heap probe fails; this is not represented as a
default-runtime OOM or fixed by raising the default heap.

## Real accounts, conversation and recovery

Both actual supplied identities authenticate. Original bot settings still deny
their independently verified owner; original credentials/configuration were not
changed. The new explicit onboarding helper has not been approved/applied to
this original file. Issue 242 tracks this local operational completion.

The first configured-copy real bot-only scenario fails because queued old
cutover commands acquire the new poller's marker and are mistaken for replies
to the current command. Chat-history deletion did not clear those pending
updates. An offset-free queue inspection independently sees the old QA commands.
Issue 243 contains the sanitized actual transcript and requests per-command
correlation plus exact pending-update ownership recovery.

Exact original sender/run/sequence/time proof permitted acknowledging a
contiguous owned prefix. That recovery stopped at an unproven update and did
not pass its final readiness gate. A subsequent normal conversation poller was
started despite that incomplete gate; global preservation of pending unrelated
updates is therefore **not certified**. No whole-queue drop was used. This QA
ordering error and the incomplete attempt are retained rather than called a
successful exact queue recovery. A later offset-free preflight confirms the
pending queue is empty without acknowledging updates. A final bot-only run uses
that preflight and a unique receipt name; its complete envelope passes. Earlier
failed attempts remain preserved.

The subsequent bot-only scenario's actual harness passes preset/subscription,
notification, restart and zero-owned-chat-leftover checks, but the private parent
receipt hits `EEXIST` on an earlier failed receipt. That parent attempt remains
failed; the harness result is distinguished from the envelope. Degraded-mode
real conversation passes its complete strict envelope and marks/deletes its own
messages. These are disposable configured QA copies with self-authored offers,
not original-config or real-photo acceptance.

The scoped real `both-owner` process fails readiness twice before scenario
commands. Its retained redacted startup log is empty. The actual native owner
driver and a separate instrumented `TelegramAuthService.validate` probe succeed;
the latter completes session import, GetMe, update-loop initialization and
destruction. A general native-authentication failure is not inferred. Issue 245
requires bounded runtime startup phase/cause tools and actual combined-process
acceptance; no third identity or another actor is requested.

The unsynthesized real-source workflow does start native collection and retains
actual graph/event/review/media data. Its checkpoint is still in progress when
the strict wrapper's stdout-inactivity watchdog interrupts quiet work. The
workflow publishes no final result; neither OCR/photo notification/restart nor
all-source acceptance is certified. Its message journal is preserved and
independently recovered through the supported exact-journal tool, which reports
zero remaining owned messages. Failed native data and original journal evidence
remain private and unmodified. Issue 246 tracks quiet-progress/watchdog cleanup,
missing parent-visible results and missing independent guard receipts.

## Current blockers

| Issue                                                                   | Remaining original-host blocker                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [242](https://github.com/konard/vietnam-accomodation-search/issues/242) | Original bot settings still deny the verified owner                           |
| [243](https://github.com/konard/vietnam-accomodation-search/issues/243) | Prior queued QA commands contaminate real conversation correlation/cleanup    |
| [244](https://github.com/konard/vietnam-accomodation-search/issues/244) | Pre-fix normalized cache bypasses current parser safety                       |
| [245](https://github.com/konard/vietnam-accomodation-search/issues/245) | Actual combined process fails readiness without a useful startup cause        |
| [246](https://github.com/konard/vietnam-accomodation-search/issues/246) | Quiet source work is interrupted and lacks complete guard recovery provenance |

Full production readiness is **not established**. Existing credentials are
sufficient to execute these tools, but closed issues, cold-store controls and
synthetic notifications do not certify the original configuration, persistent
cache, complete live source/media truth or actual combined-process readiness.

## Dependency and resource limits

The root security audit reports zero advisories. Runtime dependencies remain
current, including Browser Commander 0.31.2. `npm outdated` reports only the
intentional development alias `command-stream-release@2.0.2`, used to execute
the exact historical release loader with its pinned digest; runtime
`command-stream` is 2.4.0. This reproducibility fixture is not silently upgraded
or described as a current runtime dependency.

The stopped source run leaves the host storage-audit lock with a dead owner.
It was absent before tests and created during that run, but no independently
saved original capability receipt exists. PID and timing alone are not release
authority. Explicit approval was requested for recovery of that **exact** lock;
it has not been automatically stolen. Heavy validation is blocked while it
remains. Recovered message evidence was moved out of the active recovery
namespace; failed snapshots and persistent `data/` are intentionally retained.
No failed or incomplete acquisition/cleanup/acceptance is called a pass.

The final read-only, pinned-account audit independently pages the private bot
chat and finds no recognized QA messages, checks an empty pending update queue
without an offset, and confirms no surviving owned runtime or known bot/deploy
producer. The complete Docker inventory equals this run's fresh baseline.
Original credential files, lockfile, cache manifest and reviewed shortlist retain
their original digests; persistent `data/` remains ignored. Active message recovery
is empty and run evidence is permission-protected. An initial audit invocation
omitted the required owner pin and failed before reading chat; its failed receipt
is preserved. The corrected invocation restores the identity check using earlier
verified exact-owned update evidence and passes. This is **not** a certificate of
full resource release while the storage guard remains.

Fresh uninterrupted complete-source/media/photo/restart and full production
cutover gates remain uncompleted, not silently skipped or inferred from the
finite suites. No new heavy workload is launched through a replacement lock
namespace while the unresolved guard is held.
