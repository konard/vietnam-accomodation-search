# Independent PR149 revalidation — 2026-10-08

Verdict: **not fully production-ready**. The original identity and chronology counterexamples are fixed, but a new persisted identity counterexample remains. Release publication and complete practical protected-cohort ingestion acceptance also remain unmet. Two lower-severity tooling/dependency warnings were independently reproduced.

Production revision tested: `fd0bb609d29887e60b31093cde0cae586aaece77` (merged PR149), package 0.12.3. Only experiments and this report are changed by this audit; production implementation fixes are assigned through issues. The existing real bot token and user session were sufficient for the live tests below. Identities were verified from those credentials without requiring another bot/account. Credentials, contacts, source bodies, original images and protected journals remain in ignored private evidence.

## Verified checks

| Check                                         | Result                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 24 + mandatory actual Rust clink 0.2.11  | 1,298 passed; zero failures/skips; 35,916 ms                                                                                                                                    |
| Serial production coverage + actual clink     | 1,298 passed; lines 100%, branches 96.58%, functions 98.94%                                                                                                                     |
| Bun 1.4.2 + actual clink                      | 1,298 passed; zero failures                                                                                                                                                     |
| Deno 2.9.6, CI-compatible permissions         | 1,193 passed plus 19 steps; zero failures                                                                                                                                       |
| Original PR145 identity/chronology diagnostic | All 11 assertions pass, including actual binary persistence and fresh-store readback                                                                                            |
| Earlier regression diagnostics                | All 19 PR118 and six PR141 assertions pass                                                                                                                                      |
| Reviewed field corpus                         | 299 cases; zero measured FP/FN in the six evaluated fields                                                                                                                      |
| Real native-session transport                 | All 11 checks pass: identity, resolve/popularity/membership, history, real photo download, own-bot delivery/live updates, restart idempotency, availability inquiry and cleanup |
| Real bot-only and degraded conversations      | Both exit zero; restart and preset/subscription persistence verified; zero duplicate notifications or leftover messages                                                         |
| Clean committed checkout                      | Lint (including all warnings), formatting and duplication threshold gate pass; the duplication checker still emits the configuration warning below                              |
| Exact-revision cold Docker build              | Linux/arm64 image built; revision/version labels and non-root user verified                                                                                                     |
| Hardened Docker self-checks                   | Both browser launch and real loopback fixture search pass with the documented Compose sandbox setting                                                                           |

The conversation scenarios use a synthetic listing cache over actual Telegram transport. They are not a complete live acquisition-to-notification cohort test. The native checks separately use the production provider and download a real 132,001-byte public photo. Their four marked test messages were deleted. The corpus does not label the entire live archive or evaluate every reconciliation decision.

The original [#146](https://github.com/konard/vietnam-accomodation-search/issues/146#issuecomment-6047489797) and [#147](https://github.com/konard/vietnam-accomodation-search/issues/147#issuecomment-6047490163) cases are verified fixed; they are not reopened for an unrelated new case.

## New confirmed identity false positive and lost-listing false negative

[Issue 150](https://github.com/konard/vietnam-accomodation-search/issues/150) records a distinct remaining path: two correctly parsed units have different explicit property IDs, different floors and different Telegram post URLs, but advertise the same property homepage. Production reconciliation returns one listing instead of two. Actual clink save plus a fresh store restores that incorrect single listing.

The self-authored [diagnostic](../../../experiments/revalidation-pr149-url-identities.mjs) contains no private messages. Its `.invalid` website is never visited. Three controls pass: both unit identities and post URLs parse correctly; a legitimate same-unit repost merges; different units without a common homepage remain separate. Two assertions fail: different units sharing a homepage remain separate in memory and after binary persistence. The manual diagnostic deliberately exits 1 while this defect remains; it is not added as a falsely passing CI test.

The strong URL-alias union runs before the explicit-unit conflict veto applied to weak fingerprints. A shared building/agency/catalog homepage is not necessarily a unit identity. The issue requests a scoped fix with controls that preserve legitimate unit-specific URL aliases, reposts and chronology; no production fix is implemented here. This is a confirmed counterexample, not a population-wide FP/FN rate.

## At least 90 days of public history

The checksum-verified baseline covers `2026-07-08T20:34:53.774Z` through `2026-10-06T20:34:53.774Z`, exactly 90 days, over **66 distinct public sources**: 30 channels and 36 public supergroups, including all enabled default public Telegram seeds. Current production parsing was rerun on all **1,224,694 baseline messages**. Every retained message/album member is accounted for; there are zero parser exceptions and zero age-gate losses. The result contains **194,617 materials**, **155,364 automatic parse results** and **4,379 captionless/photo-only materials**. Automatic acceptance is not independently reviewed rental truth.

A fresh real-session uncapped catch-up completes **66/66 sources**, from `2026-10-07T09:56:39.560Z` through `2026-10-07T21:32:07.235Z`: **6,568 messages**, 1,133 materials, 805 automatic parse results, 34 phase-local photo-only materials, zero parser exceptions. The preceding 6,766- and 3,889-message catch-ups were also reparsed on the current revision: respectively 860 and 464 automatic results, zero parser exceptions/age-gate losses. The older 101-message control replay passes but is not counted again in the union.

Independent page/checkpoint/time-chain checks verify **1,241,917 distinct observed source/message pairs**, zero overlapping IDs and zero checksum failures. Four real albums cross the newest frozen catch-up boundary. Each has ten retained members; four captions are in the preceding window and 23 uncaptioned members in the newest window. Combining each album's retained members through production assembly/parser accounts for all 40 messages and preserves all four offers with zero unresolved photo-only materials or parser errors. Thus four of the newest window's 34 photo-only materials are boundary artefacts, not independent unresolved rentals. Unlike the preceding audit, a claim of zero cross-boundary albums would now be false. A phase-isolated counter is not a full-history semantic result.

This verifies the retained normalized-message cohort, not every Telegram channel, complete MTProto object or old edit/deletion. New-message deltas do not continuously resynchronize earlier edits/deletions. Posts deleted before initial retrieval cannot be recovered. The prior exhaustive media audit found **249 unsupported non-photo items**; text-accounting success does not add support for them. Thousands of captionless materials still lack independently reviewed OCR truth. No universal zero-FP/FN or complete-media claim is warranted.

## OCR and public-preview checks

The original 25,181-byte captionless poster again passes actual Tesseract eng/rus/vie PSM11 and production reconciliation **both on the host and inside the exact new production image**: **13,000,000 VND/month**, with `reviewRequired=true` and `ocr-fields-unverified`. The original 114,621-byte navigation map remains unaccepted in both environments. The Docker OCR probe receives only the two image bytes over stdin, with no credential/private-directory mount. A correct unverified-fields warning should not be suppressed to manufacture a zero-warning result.

The busier real HTML-preview source retains **316 offers** across 12 restarted ten-page calls and reaches **28-day-old** messages. Every call correctly reports partial history and a visible warning. A second source reaches a **95-day-old** cutoff sentinel in six pages and correctly reports complete history with no incomplete-history warning. Neither one successful cutoff nor durable partial progress proves complete 90-day HTML coverage for every source.

## Real full-body storage acceptance

The isolated retained-journal probe uses the original checksum-verified private first-source journal: **3,125 messages, 368 input offers, 110,291 domain records (29,681,658 JSON bytes), 406 traces**, reached cutoff, no cap. It requires actual clink 0.2.11, production-default projection and complete domain/trace/normalized-offer restoration through a fresh store. It refuses initial writes below 8 GiB free and checks a 2 GiB disk floor before imports. The reference offer shape tests representation integrity, not the truth of every semantic merge.

The **production-default run passes**: all 110,291 domain records and 406 traces restore exactly, and every field of all **324 normalized stored offers** matches the reference representation of 368 input posts. PR149 retains substantially more normalized offers than the earlier 35-result run; neither count alone establishes semantic precision/recall.

- Domain persistence: **311,094 ms**; traces: **1,933 ms**; offers: **22,340 ms**.
- Fresh-store full readback: **62,637 ms**.
- Total: **398,045 ms (6.63 minutes)**, **7,417 imports**; no disk-floor or time-budget failure.

No parser replay, runtime suite or Docker build/check was run concurrently with this projection/readback. New temporary projection/reference state was removed after completion; the original journal remains intact.

Even a passing first-source journal round-trip does not complete the full protected acquisition + OCR + real-clink projection cohort. [Issue 143 was reopened](https://github.com/konard/vietnam-accomodation-search/issues/143#issuecomment-6047489417) for that remaining practical acceptance gap. Real local credentials and evidence are available; this is not a missing test-account requirement.

## Release and operational warnings

Exact-main [Actions run 37672925743](https://github.com/konard/vietnam-accomodation-search/actions/runs/37672925743) passes all nine OS/runtime jobs and required real-clink integration but **fails Release Preflight and Pipeline Status**. Preflight has 0 verified, 2 failed, 0 unknown: the absent npm package requires authorized bootstrap `NPM_TOKEN`; Docker Hub image/username/token configuration is missing. Publication jobs are skipped. [Issue 122 remains reopened](https://github.com/konard/vietnam-accomodation-search/issues/122#issuecomment-6047208908). A passing PR workflow with publication skipped is not a successful main release.

Two additional warnings remain:

- [Issue 151](https://github.com/konard/vietnam-accomodation-search/issues/151): the cold production Docker install warns that transitive `prebuild-install@7.1.3` is no longer maintained. The dependency path is `@mtcute/node` → `better-sqlite3` → `prebuild-install`. This is a maintenance warning, not proof of a vulnerability or failed runtime.
- [Issue 152](https://github.com/konard/vietnam-accomodation-search/issues/152): jscpd 5.4.0 warns that `.jscpd.json` contains the unknown field `skipComments`. The gate passes with 477 clones/5.33%, but its intended comment-exclusion setting is not verified. A successful threshold gate does not mean zero duplication or a warning-free configuration.

The hardened Docker browser initially fails when the documented `BROWSER_NO_SANDBOX=1` setting is omitted; a default non-root run also fails on this host. Both checks pass with that setting, which tracked `compose.yaml` already supplies. This is a reproduced supported-configuration requirement, not a new code defect. Chromium's sandbox is then disabled and the hardened container is the isolation boundary, with the risk documented in [deployment guidance](../../deployment.md#browser-sandbox). The locally built image is not registry publication or native amd64 acceptance evidence.

User-owned untracked transcripts are preserved, and not reformatted to make the working-directory check nominally clean. Original evidence/credentials are preserved. Only newly created disposable test projections and marked own-bot messages are cleaned up. No audit bot poller, user client or test container is intentionally left running.

Remaining acceptance: fix/retest #150, address #151/#152, complete practical protected-cohort ingestion/storage, independently review unresolved media and broader live semantic accuracy, and complete authorized exact-revision publication/clean-install/native-platform verification.
