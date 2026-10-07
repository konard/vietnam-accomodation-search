# Independent production-readiness retest after PR 141

## Verdict

**Not fully production-ready.** The merged fixes materially improve extraction, history coverage and native transport. Real evidence still reproduces a rental-poster false negative, incomplete-history reporting and an unfulfilled release gate. Protected full-cohort acceptance is not established.

Production revision tested: `28158e860023a990a14a9e03fdae7a879ae6dca2` (PR 141), package `0.12.3`, October 7, 2026. This retest changes only experiments/tests and this report. Production fixes are left to the linked issues. Credentials, message bodies, contacts and account identifiers are not committed.

## Automated and real-runtime checks

| Check                                              | Result                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Node 24.18 full suite                              | 1,266 passed; zero failures/skips                                                                                              |
| Real Rust clink 0.2.11                             | Actual integration passed; mandatory subset 8/8                                                                                |
| Sequential production coverage                     | 100% lines, 96.35% branches, 98.91% functions                                                                                  |
| Bun 1.4.2                                          | 1,266 passed; zero failures                                                                                                    |
| Deno 2.9.6, CI-style read permission               | 1,161 passed plus 19 steps; zero failures                                                                                      |
| Original independent regression examples           | 19/19 plus 5/5 negative controls pass                                                                                          |
| Strict whole-repository lint                       | Zero errors/warnings after experiment corrections                                                                              |
| Clean-checkout formatting/duplication              | Pass; duplication 5.38%, below unchanged 10% limit                                                                             |
| Production/full dependency advisories              | Zero reported vulnerabilities                                                                                                  |
| Open CodeQL/Dependabot alerts                      | Zero / zero at retest                                                                                                          |
| Example web build                                  | Pass                                                                                                                           |
| Packed clean-install/CLI/parser smoke              | Pass; 56 package files, no private evidence or credentials                                                                     |
| Host and hardened-image browser/search self-checks | Pass                                                                                                                           |
| Real native Telegram capabilities                  | Isolated identity, metadata, history, media, sending, updates and idempotency pass; four test messages deleted, zero leftovers |
| Real bot-only and degraded conversations           | Both pass, including restart, persisted settings and no duplicate reply; zero leftover messages                                |

The native helper first missed a live update while another client using the same user session was collecting history. An isolated repetition passed. This is reported as interference/uncertainty, not a confirmed product failure. Conversation assertions use controlled synthetic cached listings with real Telegram transport; real live search is tested separately. Deno's runtime-specific early-return paths do not prove the same external integrations as Node's real-process checks.

The actual incompatible .NET clink 2.2.2 now fails preflight with `CLINK_INCOMPATIBLE`; actual Rust 0.2.11 passes. The new main CI run passes all nine Node/Bun/Deno platform jobs, including the formerly failing Windows literal-argument check. It still fails **Release Preflight**, not those tests. [Current-main CI](https://github.com/konard/vietnam-accomodation-search/actions/runs/37572369835).

## At least 90 days of public-history evidence

Every checksummed retained page from the previous completed audit was independently verified and replayed through the new production parser. This is a **fresh parser replay of retained history**, not a claim that 1.2 million old messages were downloaded again today. A fresh read-only catch-up resolved all 66 sources as public communities and retrieved new messages since the original frozen start.

The 66-source scope covers all 40 currently enabled public default seeds plus 26 retained discovery communities. The remaining catalog seed, previously resolved as a User, is now disabled. This is a finite audited scope, not all Telegram communities or future discovery. No private history was read.

| Retained 90-day replay                              |                Result |
| --------------------------------------------------- | --------------------: |
| Completed sources                                   |                 66/66 |
| Messages / distinct source-message pairs            | 1,224,694 / 1,224,694 |
| Assembled materials                                 |               194,617 |
| Classifier-eligible production parse results        |               155,364 |
| Publication-time diagnostic parse results           |               155,364 |
| Age-gate exclusions within the frozen window        |                     0 |
| Parser exceptions / unaccounted messages            |                 0 / 0 |
| Captionless materials requiring separate media work |                 4,379 |
| Distinct multi-listing-caption albums               |                     1 |

The retained window starts `2026-07-08T20:34:53.774Z` and ends `2026-10-06T20:34:53.774Z`. The new catch-up ends `2026-10-07T05:46:57.041Z`: **66/66 sources, 6,766 messages, 1,044 materials, 860 classifier-eligible parse results, zero parser exceptions and 19 captionless materials**. Independent checks verify checksums, complete checkpoints, zero overlapping base IDs and zero albums crossing the frozen boundary. Base plus fresh catch-up contains **1,231,460 distinct observed message pairs**, spanning more than 90 days. The previous closing catch-up's 101 messages were also independently replayed; they are not added again to the new catch-up total.

The native production iterator was separately compared against one full public source's retained 90-day history: **3,054 exact IDs and text bodies, zero missing/unexpected/duplicate IDs and zero changed bodies**. A real **19-second FLOOD_WAIT** occurred and production retry resumed successfully in a total 33.69 seconds, without external retry or consumer throttling. This independently verifies issue 128 on real transport; it is not a second SDK comparison of every source.

Retrieval/accounting is not reviewed semantic precision or recall. Automatic accepted totals may contain misclassifications. Retained old messages can subsequently be edited or deleted, and messages deleted before initial retrieval cannot be recovered from these snapshots. The earlier audit preserved two posts that later became unavailable; this retest does not turn a retained snapshot into a continuously synchronized immutable archive. Earlier exhaustive media work found 249 unsupported non-photo items. Neither a text-parser replay nor successful photo OCR proves complete extraction of all media formats.

## False positives, false negatives and warnings

The 299-case reviewed corpus across four languages and 34 sources has zero measured FP/FN for offer, native price, period, availability, location and rooms. Its 21 explicit unavailable cases are evaluated. Retesting 1,232 retained listings preserves all 653 sold-out listings as unavailable; zero become available-now. A bounded rent-label heuristic agrees on 832/833 cases; the remaining caption contains conflicting 7M/8M terms and is not asserted a confirmed parser error.

All ten actual browser-site checks passed. Their combined search matched 51 reviewed cards; a separate fresh live-search audit matched 61 cards, stored 151 offers and recorded zero evaluated-field FP/FN. **Live availability had zero positive labelled cases and remains not evaluated**, not perfect recall. These small reviewed samples do not establish global public-channel accuracy.

Three actual default-paced whole-catalog search passes took 247.43s, 253.02s and 262.95s under overlapping local test load. Only 34/37 sources succeeded at least once; three repeatedly timed out. Isolating those three finished in 99.76s, but two returned `historyComplete: false` while the summary claimed three successes and zero failures. Browser traces mark degradation and the service does not mark those histories scanned, but the user-visible failure formatter produces no warning. This is a confirmed completeness-reporting false positive, not evidence that every returned listing is incorrect.

Restart/cache-first search returned in 5.26s with zero explicitly unavailable results. The initial helper saw 171 records and a later reload saw 177 while background refresh was writing; after the writer finished, two fresh real-binary reads both returned the same 177 IDs. The non-atomic observations are not asserted corruption.

The old album diagnostic falsely checked only the first array element after the implementation began returning separate captions. It now checks all materials. The audit also counts distinct member IDs, distinct conflicting-caption albums and caption-specific identities, preventing duplicate provenance from inflating raw-message coverage. Offline controls pass.

| Remaining issue                                                                                             | Evidence / significance                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [129: real-poster false negative](https://github.com/konard/vietnam-accomodation-search/issues/129)         | Host and exact production-image PSM 11 OCR recover the real studio poster's 13M VND/month. The normal text parser extracts that price, but reconciliation accepts zero because its explicit rent-word guard rejects a genuine poster with monthly price/availability and no literal rental verb. The map now correctly produces no accepted rent. Reopened with fresh evidence. |
| [142: incomplete-history warning missing](https://github.com/konard/vietnam-accomodation-search/issues/142) | Two actual public previews never reach the 90-day boundary, yet aggregate results report success and omit a user-visible warning. New sanitized independent diagnostic reproduces this.                                                                                                                                                                                         |
| [143: protected-audit throughput warning](https://github.com/konard/vietnam-accomodation-search/issues/143) | A real uncapped source has 3,125 messages, 368 accepted listings, 38 review entries, 110,291 full-body domain records and 406 traces. It remains projection-pending after over 15 minutes. Other checks and low disk headroom overlapped; this is not an isolated performance benchmark. Full protected-cohort acceptance is not claimed.                                       |
| [122: release still blocked](https://github.com/konard/vietnam-accomodation-search/issues/122)              | Actual main release-mode preflight reports 0 verified and 2 failed: missing npm bootstrap token and Docker Hub image/username/token configuration. No successful npm/OCI publication or immutable release identity is established. Reopened; no settings or secrets changed.                                                                                                    |

The new diagnostic intentionally exits nonzero for the unresolved poster and history-warning checks; it is not added as a failing normal CI test. The clean package installation also emits a transitive `prebuild-install@7.1.3` deprecation warning; the current advisory audit reports no vulnerability. No claim of exhaustive adversarial parser testing or zero global false positives is made.

## Deployment and cleanup

The exact linux/arm64 production image builds with real Rust clink and installed Tesseract eng/rus/vie models. A real-token drill uses a separate Compose project, port and isolated copy of the realistic 3.8GiB store; original data is untouched. Initial deployment became healthy in **111s** and redeployment in **78s**, both within the unchanged 300s readiness budget.

An initial explicit local-image attempt incorrectly used the registry-pull path; the local-build retry fixed that setup error. Stopped historical QA projects left token-ownership records; after confirming no bot container was running, the drill explicitly bypassed only that stale-record guard. No simultaneous bot pollers were used. An initial Docker self-check used the wrong CLI command and omitted Compose's sandbox setting; the documented self-check commands with actual Compose restrictions both passed. These setup failures are not product defects.

Rollback returned to the prior healthy image in **68s**. This tests rollback between two deployments of the same production revision, not cross-version/schema recovery; the optional snapshot-restore path was not repeated in this retest.

The protected source was stopped for disk safety with exit 130 after **22.70 minutes measured from the first attempt's log creation**. Its checkpoint remains explicitly incomplete and projection-pending; its checksummed journal and logs are retained. No protected full-cohort acceptance or completed storage projection is claimed from that interrupted run. The actual folder resolver did reach collection without the earlier invalid-folder error, and its full-body ledger contains no literal `undefined` source text.

The QA bot was stopped. The disposable **3.8GiB QA data copy and 842MiB recovery snapshot** were removed to restore disk headroom; they can be recreated from the untouched original/previous QA data. Raw evidence, report outputs and credentials were preserved. Published registry artifacts, native linux/amd64 execution, token rotation and a full passing protected audit are **not** inferred from this local arm64 drill.

## Reproduction

Use supported Node and the real Rust clink first on PATH. No credentials are required for these committed independent controls:

```sh
REQUIRE_REAL_CLINK=1 npm test
npm run test:coverage
node experiments/test-telegram-90-day-coverage-audit.mjs
node experiments/revalidation-pr118-regressions.mjs
node experiments/revalidation-pr141-regressions.mjs
node experiments/field-corpus-metrics.mjs
```

Private raw evidence and real-credential run outputs remain under the ignored `local-revalidation-pr141-2026-10-07` audit directory. No production fix, credential replacement or external publication was performed by this retest.
