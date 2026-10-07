# Independent PR145 revalidation — 2026-10-07

Verdict: **not fully production-ready**. Two newly reproduced production reconciliation defects remain, alongside blocked release and incomplete full-cohort acceptance. Passing code tests and closed issues do not establish universal semantic accuracy.

Production revision tested: `3808dee17635e6a10b17ab6ff00e8da312b4064e` (merged PR145), package 0.12.3. Only audit/report changes are made here. Existing bot credentials and the existing user session were used; identity checks were derived from the actual credentials without requiring another bot/account or publishing identities. Secrets, original images and message bodies remain in ignored private evidence.

## Verified checks

| Check                                       | Independent result                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Node 24 + required actual Rust clink 0.2.11 | 1,279 passed; zero failures/skips                                                                                          |
| Production coverage                         | 1,279 passed; lines 100%, branches 96.41%, functions 98.93%                                                                |
| Bun 1.4.2 + actual clink                    | 1,279 passed; zero failures                                                                                                |
| Deno 2.9.6, CI-compatible permissions       | 1,174 passed, 19 steps; zero failures                                                                                      |
| Earlier diagnostic regressions              | All PR118 checks/controls and all six PR141 checks pass                                                                    |
| Reviewed field corpus                       | 299 cases; zero measured FP/FN in evaluated fields                                                                         |
| Native real-session transport               | All 11 checks pass, including history/media/live updates, own-bot delivery, restart idempotency and cleanup                |
| Real bot-only and degraded conversations    | Both exit zero; restart, preset/subscription persistence and zero duplicate notifications verified; zero leftover messages |
| Clean latest-main repository checks         | Lint, formatting and duplication gate pass                                                                                 |

The conversation fixture intentionally uses a synthetic listing cache over real Telegram transport. It is not a complete live acquisition-to-notification integration test. The native check separately downloads a real public photo and uses the production native provider. Its four marked test messages were deleted.

The working checkout's `npm run check` reports a formatting warning for the user's untracked `codex-session-01a0c776-dc6c-75a2-aa1c-051c3fd91465.md`. A clean committed checkout passes. This is not a tracked production-code defect; the user file was preserved unchanged. Accepted duplication-gate output is not a claim that the repository contains no duplicated code.

## Original image and preview defects

The original 25,181-byte captionless poster now passes actual Tesseract eng/rus/vie PSM11 plus production reconciliation: **13,000,000 VND/month**. It retains `reviewRequired=true` and `ocr-fields-unverified`; extraction is not verified rental truth. The original 114,621-byte navigation map remains unaccepted. Evidence was added to [issue 129](https://github.com/konard/vietnam-accomodation-search/issues/129#issuecomment-6035611342).

Real public-preview navigation verifies durable progress across new collectors/stores. The busier original source retains **86 offers** across 12 restarted ten-page calls, but reaches only **27-day-old** messages. Every call correctly reports partial history and a user-visible warning. The second source reaches an actual **94-day-old** cutoff sentinel in six pages and reports complete history without the incomplete-history warning. This fixes the reporting/resume defect in [issue 142](https://github.com/konard/vietnam-accomodation-search/issues/142#issuecomment-6035612013), not complete 90-day HTML coverage for every source. Probe output contains aggregate counts only; temporary browser state is removed.

## At least 90 days of public history

The checksum-verified original window is `2026-07-08T20:34:53.774Z` through `2026-10-06T20:34:53.774Z`, exactly 90 days, over **66 distinct public sources** (30 channels, 36 public supergroups). All enabled default Telegram public seeds are in that retained cohort. Current production text parsing was rerun on **1,224,694 baseline messages**:

- All message/album members are accounted for; zero parser exceptions and zero age-gate losses.
- **155,364** production parse results equal the historical-age control count; these are automatic results, not human-labelled true positives.
- **194,617** assembled materials include **4,379** captionless/photo-only materials; those counts alone do not prove OCR recall.
- One multi-caption album remains independently accounted for; all distinct captions are tested, not just the first assembled material.

A fresh real-session catch-up completes **66/66 sources**, without a message cap, from `2026-10-07T05:46:57.041Z` through `2026-10-07T09:56:39.560Z`: **3,889** additional messages, **464** automatic parse results, **11** captionless materials, zero parser exceptions and zero age-gate losses.

Independent retained-page checks verify the baseline, previous 6,766-message catch-up and this fresh phase: **1,235,349 distinct observed source/message pairs**, zero overlapping IDs, zero checksum failures and zero albums split across frozen boundaries. The previous 6,766-message phase was also reparsed on the current production revision: 860 automatic results, zero parser exceptions or age-gate losses. The separate older 101-message catch-up was replayed successfully but is not added again to that union.

This is bounded source-cohort and normalized-message evidence, not an archive of every Telegram channel or full MTProto objects. Old edits/deletions are not continuously resynchronized by reading a new-message delta. Two previously observed posts later became unavailable. Messages deleted before their initial retrieval cannot be reconstructed. Earlier exhaustive media testing found **249 unsupported non-photo items**; cached OCR text and one recovered poster do not establish support for them or universal OCR accuracy. The reviewed 299-case corpus does not label all 1.2 million live messages.

## Real full-body storage acceptance

The new manual `experiments/revalidation-pr145-real-ledger.mjs` verifies the original checksummed private journal, not a reduced synthetic replacement: **3,125 messages, 368 input offers, 110,291 domain records (29,681,658 JSON bytes), 406 traces**, with a reached cutoff and no cap. It requires actual clink, verifies full domain/trace round trips and all normalized stored offer fields through a fresh store, and includes persistence and readback timings. The run is isolated from other parser/runtime/projection suites. A synthetic one-message control first passed to validate the probe itself.

The first attempt stopped safely after **240,354 ms and 5,519 imports** at its then-1-GiB disk floor (`QA_DISK_HEADROOM`), before completing any collection write. Its new temporary projection occupied approximately **1.5 GiB** before cleanup. This was a resource-limited acceptance failure, not proof of an incorrect compact-name implementation.

After disk headroom independently recovered to approximately **11 GiB**, the isolated **production-default retry passed**. Actual clink 0.2.11 persisted all 110,291 domain records and 406 traces, then restored them exactly through a fresh store. All fields of the **35 normalized/deduplicated stored offers** match the reference representation of 368 input posts. This verifies storage representation, not that every semantic merge is correct.

- Domain persistence: **293,788 ms**; traces: **1,861 ms**; offers: **4,171 ms**.
- Independent fresh-store readback: **58,702 ms**.
- Total: **358,559 ms (5.98 minutes)**, **6,951 imports**.

The committed probe now refuses initial writes below **8 GiB** free, checks a **2 GiB** floor before imports and has a finite 30-minute write-phase budget. It deletes only newly created temporary state. Original journals/evidence remain intact. No larger-shard experiment was executed or production default changed. [Issue 143 records the passing retry](https://github.com/konard/vietnam-accomodation-search/issues/143#issuecomment-6035841913); its requested practical full-cohort acquisition-to-storage acceptance remains open.

## New confirmed false-positive/negative defects

The audit-only `experiments/revalidation-pr145-dedup.mjs` contains self-authored fixtures and deliberately exits nonzero while defects remain. Its ordinary mode tests parsing and reconciliation. With `QA_DEDUP_STORAGE=1` and actual clink 0.2.11, it also proves both failures persist after save and fresh-store readback. **Five controls pass and six assertions fail**, representing two defect groups:

1. [Issue 146: conflicting explicit units merge](https://github.com/konard/vietnam-accomodation-search/issues/146). Units A1702/floor 17 and A1802/floor 18 parse correctly, but shared agent/location/area/bedrooms produce one stored listing instead of two. Unique source-property keys do not veto a shared weak fingerprint. This is a false-positive identity match and a lost-listing false negative. A legitimate same-unit repost still deduplicates correctly.
2. [Issue 147: historical order resurrects a sold-out listing](https://github.com/konard/vietnam-accomodation-search/issues/147). A newer unavailable 8M post followed by an older available 9M post, with the same batch collection time, produces available-now=true and price=9M. Both posts parse correctly. Reversing input order correctly produces unavailable/8M. Sorting only by collection time lets old source history override newer source state, and actual persistence retains the error.

These are confirmed counterexamples, not measured population-wide rates. The 368-to-35 reduction includes legitimate reposts and is not asserted wholly false. Parser-only corpus FP/FN metrics do not cover these reconciliation defects. Both production fixes were reported as separate issues for parallel agents; no production implementation was changed.

## Release, operational warnings and cleanup

Exact-main [Actions run 37599689825](https://github.com/konard/vietnam-accomodation-search/actions/runs/37599689825) passes all nine OS/runtime jobs and required real-clink integration but **fails Release Preflight and Pipeline Status**. Preflight reports **0 verified, 2 failed, 0 unknown**: absent npm package requires authorized bootstrap `NPM_TOKEN`; required Docker Hub image/username/token configuration is missing. Publication/release jobs are skipped; GitHub releases remain empty. [Issue 122 was reopened with current evidence](https://github.com/konard/vietnam-accomodation-search/issues/122#issuecomment-6035460317). PR145's closing references did not fix these external acceptance gates.

Local disk headroom briefly fell to **215 MiB**, and remains unstable. After verifying stopped QA ownership and identical retained domain/trace indexes, the disposable PR118 `deploy-large` copy (3.8 GiB logical size) was removed. It can be recreated from the preserved PR110 copy; the deleted copy itself is not directly recoverable. No credentials, user transcripts, source histories, original images or production state were removed. Shared/COW blocks mean logical deletion size is not equal to reclaimed physical space.

The old QA Docker image is no longer in the local daemon. No new image build/deployment is claimed in this low-headroom retest; the earlier PR141 Docker drill is historical evidence, not an exact-PR145 release test. Fresh exact-revision container/registry/native-platform acceptance remains necessary. No bot poller/container from this audit is left running.

Required remaining acceptance includes fixes and retests for issues 146/147, authorized successful release/publication and clean installs, full protected acquisition-to-storage audit completion, support/review of unresolved media, and representative human-labelled semantic coverage. A correct partial-history warning is useful operational reporting, not a warning to suppress to obtain a nominal zero-warning result.
