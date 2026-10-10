# QA cleanup revalidation — 2026-10-11

## Correction to the earlier cleanup verdict

The user's screenshot correctly identified two leftover self-authored rental notifications. The earlier private deploy QA script tracked marker-command replies but not unmarked scheduled notifications. Its successful cleanup assertion therefore did not prove the chat was clean. Both exact fixture messages were deleted through the verified bot owner's conversation, with independent readback; unrelated messages were preserved.

The user had already cleared Docker. This run started with no application containers, images or volumes, and only Docker's default networks/builders. No global prune or unrelated-resource deletion was used.

## Reported defects

- [#172: Telegram QA teardown and false cleanup success](https://github.com/konard/vietnam-accomodation-search/issues/172). Includes scheduled deliveries, captions/albums, ambiguous responses, paged verification, producer ordering and interruption/recovery gaps. The new focused harness passes, but broader legacy harness acceptance remains open.
- [#173: complete run-owned Docker teardown](https://github.com/konard/vietnam-accomodation-search/issues/173). The focused matrix passes; full deploy-image/rollback-tag/build-cache ownership and setup/interruption recovery are not yet proven for every legacy drill.
- [#174: leaked temporary fixtures and failure-unsafe diagnostics](https://github.com/konard/vietnam-accomodation-search/issues/174). Confirmed unit fixture leaks are corrected, and diagnostics receive failure-safe cleanup where changed. Not every legacy diagnostic has been migrated or fault-injected.
- [#175: application clink preflight leaks renamed failed probe directories](https://github.com/konard/vietnam-accomodation-search/issues/175). Application code is unchanged under the QA-only instruction. The suite wrapper removes these run-owned artifacts, but strict per-test cleanup acceptance remains red until the application defect is fixed.
- [#176: npm metadata QA false negative](https://github.com/konard/vietnam-accomodation-search/issues/176). The test now accepts a successful top-level file manifest while still verifying the exact CLI entry.

## Changes and verification

`npm test` and `npm run test:coverage` now run inside an automatically owned TMPDIR. Teardown stops the child, removes the exact suite directory and independently verifies its absence. Per-operation test deadlines remain 30 seconds. `npm run test:cleanup` additionally fails on fixture residue before the wrapper's safety-net cleanup; it does not hide #175. Runtime/compiler caches are identified separately and removed from this same owned directory.

Unit fixtures for buildx stubs, reconciliation, preflight, Git hooks, changed-file detection, fresh-merge and npm evidence now have failure-safe cleanup. QA disposers attempt later phases after failure or timeout and reject cleanup failures. A Docker bind smoke test gains an exact-resource exit/signal trap and refuses untracked image pulls.

The new Telegram ledger marks text, photo captions and every album item, records ownership privately, pages history, retries deletion, and independently checks absence. Bot API chat-local message IDs and the MTProto driver's account-global IDs are kept separate. Actual owner-only subscription, photo and album delivery is exercised; no public-channel writes or original-message publication occurs.

| Check                                                   | Result                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete Node 24.21.0 suite, mandatory Rust clink 1.0.0 | Pass; 100% product lines, 96.81% branches, 98.97% functions; suite-owned TMPDIR removed                                                     |
| Complete Bun 1.4.3 suite, mandatory Rust clink          | 1,360 pass, zero failures; suite-owned TMPDIR removed                                                                                       |
| Deno 2.9.6 frozen read-only suite                       | 1,243 pass plus 19 steps, zero failures, 11 documented ignores; strict cleanup audit has no residue                                         |
| Focused teardown regressions                            | 15 pass; strict audit has no residue, including failure, stalled disposer, lost response, pagination, journal restoration and child signals |
| Real Telegram subscription/photo/album matrix           | Success, assertion failure, SIGTERM and final SIGINT pass; zero owned leftovers and unrelated-message preservation independently verified   |
| Real Docker fixture matrix                              | Success, assertion failure, SIGTERM and SIGINT pass; exact baseline restored                                                                |
| Self-authored browser timing diagnostic                 | Pass; strict cleanup audit has no residue                                                                                                   |
| Known failing browser trace-privacy diagnostic          | Expected failure for browser-commander #153; browser and trace directory still removed, strict cleanup audit has no residue                 |
| Strict clink preflight cleanup control                  | Correctly fails on #175 despite seven passing assertions; wrapper still removes the exact owned directory                                   |

The Docker matrix uses an imported self-authored empty image, an intentionally unstarted container, network, volume and an unbootstrapped isolated builder. It verifies those resource types and signal teardown, **not** a full production image build, running-poller cutover or populated build-cache teardown. No registry pull, shared builder prune or production-data deletion is required.

Final inspection finds no QA containers, image tags, volumes, networks or named builders. An older shared Dockerfile frontend cache predates this run and remains untouched; named-resource baseline restoration is not a claim that Docker's entire content store is empty.

Fault injection also exposed a Playwright signal interaction: its default SIGINT handler can exit before the QA scope finishes Telegram cleanup. The focused harness disables automatic browser process-exit handlers and owns browser closure itself. The interrupted probe's five explicitly marked messages and its one owned temporary directory were recovered; this finding is included in #172, not suppressed.

Initial suite attempts selected the shell's unsupported Node 20 and unrelated .NET clink, or selected Rust clink only through configuration without putting it first on PATH. Their failures are setup mismatches, not newly asserted production regressions. Corrected supported-runtime runs are reported above. Fault-injection controls intentionally emit errors and return nonzero where the reported defect remains.

Hard process kills, network-unavailable deletion and legacy-harness recovery still require the issue acceptance work. A `finally` block cannot execute after SIGKILL or power loss. No claim is made that every automated/live diagnostic is now universally cleanup-safe.
