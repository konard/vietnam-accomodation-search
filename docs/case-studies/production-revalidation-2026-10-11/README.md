# Production revalidation — 2026-10-11

## Verdict and scope

**Not fully production-ready.** This is a fresh local acceptance run of PR #178
(`cfe482aca90a534b171c108f1fd2757387aaf567`) plus the QA-only changes and
links-notation patch recorded below. It supersedes the credential-dependent
acceptance limits in [the implementation report](../issue-177/README.md), not
the preserved historical observations in older reports.

Existing real bot and user credentials were sufficient: expected identities
were derived from those credentials and checked against the authenticated
clients. No extra independent identity or session was required. Real Telegram
writes were restricted to the credential owner's private bot conversation;
public-channel history and media were read-only. Only independently verified
QA-owned messages and resources were removed. Unrelated history, deployment
records, user transcripts and pre-existing Docker resources were preserved.

Raw messages, images, contacts, numeric identities, source membership, workload
details and SDK logs remain in the ignored, permission-restricted local evidence
directory. Public evidence uses self-authored controls and aggregate assertions.
The QA-only boundary remains in force: application fixes are assigned through
issues, not silently implemented in this retest.

## Fresh acceptance

The final runtime, repository and local cutover results are recorded after the
last QA changes. Earlier successful runs and failed attempts are retained
privately rather than overwritten or presented as a final pass.

The final serial Node run passes **1,403 tests**, zero failures/cancellations/
skips, with **100% product lines**, 96.75% branches and 98.71% functions covered.
Strict cleanup reports no leftover fixture names and independently verifies
teardown. Zero-warning full ESLint, tracked/new-file formatting, the duplication
gate and the universal example's web build pass.

The repeated full Bun 1.4.3 run also passes **1,403 tests**, zero failures, and
strict teardown. The preceding serial full run had two release-fixture deadline
failures; both files pass all 14 tests in isolation at the same deadline. This
intermittent full-suite finding remains open in
[#189](https://github.com/konard/vietnam-accomodation-search/issues/189), rather
than being erased by the green rerun. No test deadline or assertion was changed.

Deno 2.9.6 passes **1,286 tests plus 19 steps**, zero failures and **11 documented
ignores**, using the ordinary frozen graph. Its strict fixture/teardown audits
also pass. These three complete runtime results are from the final QA candidate,
not an extrapolation from a preceding commit's counts.

- Node 24.21.0 and Bun 1.4.3 complete suites use the mandatory real Rust clink
  1.0.0, not the unrelated executable named clink in the default shell.
- Deno 2.9.6 uses the ordinary frozen lock. Its documented SDK/native/filesystem
  ignores are not claimed as executed acceptance. Run it after Node/Bun so its
  npm-layout setup cannot mutate dependencies underneath another suite.
- Every automatic suite runs inside its own TMPDIR, fails on unexpected
  fixture residue and independently verifies removal of that directory.
- Real bot-only and degraded conversations pass saved presets, subscriptions,
  notifications, restart deduplication, persistence, search and state cleanup.
- Eleven real native/combined capability checks pass identity, owner-only
  sends/updates, media download, restart idempotency and owned-message cleanup.
- Real text/photo/album cleanup controls pass success, assertion failure,
  SIGINT and SIGTERM, including ambiguous-send recovery. Unrelated messages
  remain preserved and independent readback finds zero owned leftovers.
- Six populated Docker cleanup controls pass success, setup/assertion failure,
  SIGINT, SIGTERM and actual SIGKILL journal recovery. No global prune is used.
- A fresh production image passes six non-root/read-only/dropped-capability
  runtime checks: SQLite, provider construction, Chromium, actual Tesseract
  and independent fresh-clink readback. Its isolated builder/cache and image
  are removed and the baseline is independently restored.
- Actual browser HTTP 200/202/404/502/503 controls pass; only 200 qualifies as
  success. browser-commander 0.29.0 navigation controls and self-authored HTML
  checkpoint privacy controls also pass.
- Installed-SDK entities, media shapes, bounded download, shared photo lookup,
  graph retention, bounded quote scanning, distinct bedroom/room/bed metrics,
  unit ranking and comparable stay-price controls pass.

Local environment warning: the default shell selects unsupported Node 20 and
an unrelated .NET executable called clink. QA explicitly selects supported
Node 24.21.0 and Rust clink 1.0.0 through PATH/CLINK_COMMAND. Global shell profiles
and the unrelated executable were not changed. A bare host invocation without
the supported tools is not the configuration validated here.

## Source completeness and accuracy

Every current supported web catalogue entry was visited read-only, including
explicitly disabled entries without enabling them. Outcomes were seven success,
seven zero-card, two parse-incomplete, one HTTP-pending, three rate-limited,
three HTTP-not-found, five challenge and one unexpected-error observations.
These are honest route observations, not exhaustive listing/pagination
acceptance. No CAPTCHA or rate limit was bypassed.

Every currently enabled Telegram seed identity is represented in the retained
private cohort. Fresh public-history catch-up and a continuous replay of the
retained 90-plus-day baseline/delta chain completed. All retained messages were
accounted for and text replay reported zero parser errors. Photo-only messages
still have unresolved review. Text accounting is not full media/OCR truth,
independent precision/recall or proof of every edit/deletion before retrieval.

The real native-source workflow ran actual OCR and passed durable fresh-clink
readback, media identities and graph closure. It then **failed** strict
photo-notification acceptance: no accepted photo was observed. Its checkpoint
remained explicitly degraded rather than falsely complete. Notification cleanup
passed with zero leftovers. Candidate selection versus rendering/upload failure
has not been isolated; this is not labelled a proven renderer defect.

The reviewed historical corpus and self-authored controls pass their declared
labels. There is no new independently reviewed live room/bed truth across every
source. No global false-positive/false-negative-zero claim or global cheapest/
best-offer claim is justified.

## QA findings and corrections

| Finding                                                                                                  | Evidence and disposition                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#179](https://github.com/konard/vietnam-accomodation-search/issues/179): Docker baseline false positive | Docker Desktop recreated its built-in bridge ID after otherwise successful disposal. Only exact built-in name/driver/scope triples are compared semantically; user networks retain exact IDs. Unit controls and the six live exit-path controls pass. Built-in deletion remains forbidden.                                                               |
| [#180](https://github.com/konard/vietnam-accomodation-search/issues/180): duplicate ownership markers    | Real grammY Context APIs inherited the bot transformer and applied the marker twice. QA marking is now idempotent; actual Context text/photo/album regressions and both real conversation modes pass.                                                                                                                                                    |
| [#181](https://github.com/konard/vietnam-accomodation-search/issues/181): uncached numeric bot peer      | A fresh native observer could not resolve the numeric bot ID. QA now verifies Bot API identity and resolves its verified public username. The native ingestion/OCR workflow passes preflight; its later photo gate is a separate failure.                                                                                                                |
| [#186](https://github.com/konard/vietnam-accomodation-search/issues/186): repeated cutover teardown      | A rejected first deploy reached cleanup in both finally paths; the second call sent a command after shutdown. Grouped teardown is now once-only and skips application-state commands before successful deployment. A real rejection rerun reports conversation/project/state cleanup true, zero leftovers and removal of its newly owned data directory. |
| [#187](https://github.com/konard/vietnam-accomodation-search/issues/187): retained browser profiles      | The manual browser audit retains disposable profiles and suppresses close failures. This run's exact owned profiles were removed; diagnostic traces were preserved. Automatic failure/signal cleanup still needs repair and acceptance.                                                                                                                  |

[Self-check #188](https://github.com/konard/vietnam-accomodation-search/issues/188)
is another independently reproduced failure-path gap: a finite injected bind
error needs no real socket and escapes instead of rejecting. Its self-check
fixture remains until the diagnostic's outer scope removes it. The production
helper needs a rejecting error boundary so its finally cleanup executes.

Read-only final chat auditing now recognizes every current QA harness and the
known legacy markers. Matching is never permission to delete. An independently
observed cutover leftover was recovered only through that run's exact ownership
journal; subsequent full-history audit found zero known QA messages.

The first deployment attempt mistakenly supplied a local-only tag through the
registry-image option, which correctly tried to pull it. That setup rejection
is not a production deploy defect; the cleanup defect it exposed was real.
The final local-build drill does not require image publication.

The captured default local-build rerun successfully built the image, then the
documented bot-token reservation guard rejected original deployment records.
No container was started; cleanup passed with zero leftovers and removed the
new test data/project. This is not an image-build defect. Removing original
records or demanding a second bot would violate this run's requirements.
[QA #190](https://github.com/konard/vietnam-accomodation-search/issues/190)
therefore adds an explicit `--allow-shared-token` pass-through, default off,
permitted only with an independently empty pre-run container inventory. The
production guard is unchanged and the live single-poller/conflict assertions
remain enabled. Original records are preserved.

The first opt-in run successfully deployed and became ready, then QA history
readback threw `Request not set yet` before later transitions. Independent
read-only chat audit found zero known QA messages and owned Docker/data/project
cleanup passed. [QA #191](https://github.com/konard/vietnam-accomodation-search/issues/191)
isolates Teleproto's exhausted adjacent-ID iterator failure: a fake no-network
client returns empty for minId=10/offsetId=12 but throws before any request for
offsetId=11. QA now stops at the exclusive baseline+1 boundary without catching
arbitrary errors, with full inclusion/non-advancement regression controls. The
SDK counterexample is reported in
[Teleproto #48](https://github.com/sanyok12345/teleproto/issues/48).

[QA #192](https://github.com/konard/vietnam-accomodation-search/issues/192)
adds a preflight using the production access policy: the supplied driver must
be authorized for privileged commands before Docker creation or chat writes.
The original private bot environment has no authorized numeric recipients;
healthy container startup therefore does not establish usable original local
configuration. [#193](https://github.com/konard/vietnam-accomodation-search/issues/193)
tracks that operator readiness blocker separately. QA uses a freshly derived,
private owner-only allowlist in temporary credentials; original `.env` and
authorization settings remain untouched. Public mode without privileged-driver
authorization still fails the QA preflight.

The final owner-authorized local-build drill successfully deployed, became
ready, completed its stability window and saved the QA preset. It then failed
the unchanged `/subscribe` acknowledgement deadline. The remaining deploy
transitions therefore **did not execute**; healthy startup is not full cutover
acceptance. [#194](https://github.com/konard/vietnam-accomodation-search/issues/194)
records that live failure and an independent no-network counterexample:
the registered handler persists a subscription, then awaits the scheduled
search before acknowledging it. A finite barrier proves no acknowledgement
while that search is blocked; releasing the barrier produces the expected
reply. The exact live stall's internal phase was not captured, so the
counterexample is not presented as proof of a particular browser failure.
The manual diagnostic intentionally fails its readiness assertion and passes
strict cleanup. No production fix or larger acceptance deadline was applied.

Independent final read-only chat auditing finds zero known QA messages.
The final Docker inventory has no containers, images or volumes, and only
the original built-in networks/default builders. Newly owned drill project
and data directories and temporary credential files are gone. A pre-existing
Docker frontend cache entry is preserved; physical Docker disk accounting
is not claimed to be zero. Private diagnostic traces and logs are intentional
evidence, not disposable runtime profiles or resources.

Initial final-suite attempts also ran under a sandbox that denied loopback
listening and outbound bootstrap requests. Seventy-two affected controls pass
with authorized local/network access and no fixture residue. The denied binds
exposed the separate genuine cleanup gap in #188; the strict wrapper removed its
own root after detecting that residue. One full Node attempt exceeded a storage
test's 30-second deadline while another full runtime suite and Docker compilation
were running concurrently. Serial, network-enabled reruns established the final
runtime verdicts above; neither timeout suppression nor a larger deadline was used to
manufacture a pass. Formatting of an unrelated untracked user transcript
also causes the broad `format:check` command to warn; the user file is preserved
and tracked/new QA files are checked separately.

## Dependencies and warnings

Current public npm metadata was checked for every package in both lockfiles.
All direct dependencies match current latest tags. links-notation 0.25.2 replaces
0.25.1 consistently in the npm and Deno locks. browser-commander remains the
verified latest 0.29.0; command-stream is the safe latest 2.0.2. Root and universal
example audits report zero known vulnerabilities. Parent-constrained older
transitive majors are reported, not force-overridden without compatibility
evidence. Production remains the pinned Node 24.21.0 LTS runtime.

Two pre-existing upstream limitations remain reproducible but have working application/test
boundaries: [use-m #80](https://github.com/link-foundation/use-m/issues/80) leaves
a stalled response body beyond its requested deadline while the application
bounded-fetch control rejects;
[test-anywhere #148](https://github.com/link-foundation/test-anywhere/issues/148)
can emit passing TAP without executing the options-overload callback while the
repository uses the working two-argument overload. These are not described as
currently unmitigated application failures. Browser-commander trace privacy
[#153](https://github.com/link-foundation/browser-commander/issues/153) and
command-stream security
[#221](https://github.com/link-foundation/command-stream/issues/221) are closed
and their corrected contracts pass fresh checks.

## Remaining blockers

- [#182](https://github.com/konard/vietnam-accomodation-search/issues/182): the
  native SDK emits identity-bearing session-reset warnings during shutdown
  despite a silent provider logger.
- [#183](https://github.com/konard/vietnam-accomodation-search/issues/183):
  exhaustive web pagination, native photo-only review and current independent
  room/bed truth are not complete acceptance evidence.
- [#184](https://github.com/konard/vietnam-accomodation-search/issues/184): a
  finite self-authored control proves a received latest offer remains invisible
  until the entire historical tail completes; after releasing the tail, its
  positive-control extraction passes. This is not an invented numeric SLA.
- [#185](https://github.com/konard/vietnam-accomodation-search/issues/185): strict
  real-source photo delivery still fails after actual OCR/storage checks.
- [#187](https://github.com/konard/vietnam-accomodation-search/issues/187): browser
  audit profile/error/signal cleanup remains unverified.
- [#188](https://github.com/konard/vietnam-accomodation-search/issues/188):
  self-check bind errors do not reject into owned fixture cleanup.
- [#193](https://github.com/konard/vietnam-accomodation-search/issues/193): the
  original private local bot configuration has no authorized recipients.
- [#194](https://github.com/konard/vietnam-accomodation-search/issues/194):
  subscription acknowledgement waits for scheduled search, and the real
  owner-authorized local cutover drill fails at that command.

The intermittent Bun release-fixture deadline warning in #189 also remains open
despite the passing complete rerun.

Production readiness requires these findings to be resolved and rerun, not
merely closed administratively. No application feature or transport fix is
included in this QA handoff.
