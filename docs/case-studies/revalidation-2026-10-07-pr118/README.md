# Real-credential production revalidation of PR #118

Tested production main [`5409ea0`](https://github.com/konard/vietnam-accomodation-search/commit/5409ea06127858be05d2e0f8cd6ad25854e0c419), package 0.12.3, on 2026-10-07 in Vietnam. This continues the [PR #110 revalidation](../revalidation-2026-10-06-pr110/README.md). Production code was not changed. Test experiments and this sanitized evidence are published; production defects are separate GitHub issues for parallel fixes. Existing bot and user credentials were sufficient for the executed real Telegram tests.

**Verdict: not yet production-ready for complete 90-day parsing.** All public channels in the retained cohort have been retrieved across the requested window, but full parsing has confirmed gaps. The broader discussion-group retrieval remains in progress; neither incomplete histories nor unresolved media are counted as passing.

## Executed checks

| Check                                                           | Result                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Node 24.18.0, real clink 0.2.11, clean Git checkout             | 1,197/1,197 pass, no skips; 45.02 seconds                                                       |
| Sequential Node coverage, real clink                            | 1,197/1,197 pass; product lines 100%, branches 96.17%, functions 98.80%; 159.24 seconds         |
| Bun 1.4.2, real clink, clean Git checkout                       | 1,197/1,197 pass; 50.12 seconds; documented 30-second per-test budget                           |
| Deno 2.9.6                                                      | 1,092 tests and 19 steps pass; zero failures; 24 seconds                                        |
| Strict ESLint, full-warning lint, tracked-file formatting       | Pass, zero lint warnings                                                                        |
| Duplication                                                     | Pass, below the 10% gate                                                                        |
| Root and example dependency audits                              | Zero vulnerabilities                                                                            |
| Open CodeQL and Dependabot alerts                               | Zero                                                                                            |
| Example web build                                               | Pass                                                                                            |
| Local npm package installation, parser/import and installed CLI | Pass; no credential or runtime-data files in the 51-file tarball                                |
| Host and hardened-container browser/search self-checks          | Pass                                                                                            |
| Fresh live browser audit                                        | All 10 sites pass; 51 matched reviewed cards; every evaluated field has precision/recall 1.0    |
| Real Telegram bot-only and degraded conversation E2E            | Both pass, with restart persistence, no duplicate delivery, and zero leftover test messages     |
| Real native Telegram capabilities                               | All ten checks pass; four created messages deleted, zero leftovers                              |
| Native/public raw 90-day transport comparison                   | 3,054 IDs and text bodies match exactly; zero missing IDs in either direction and no duplicates |
| Real-data Docker deployment, redeployment, rollback             | Healthy in 92, 89, and 56 seconds respectively; within the 300-second budget                    |

The full credentialed-root Node run was 1,196/1,197: its security test falsely scanned ignored retained runtime lockfiles (#120). A clean **Git clone**, not an archive without `.git`, passed all tests. Initial archive-based checks failed the Git-dependent docs test and were setup failures, not application acceptance. Sequential reruns removed cross-suite resource contention. Shell-default Node 20 was not used for supported-runtime acceptance.

The current Docker build is exact-revision linux/arm64, Node 24.21.0, clink 0.2.11, non-root, approximately 597 MB. Deployment used an isolated copy of approximately 3.8 GiB of actual retained data and the actual bot token. Hardened filesystem/capability settings, readiness and state retention were exercised. The final bot container was stopped; no competing test poller remains. Native amd64 execution, real published package/OCI pulls and token rotation are not established by this local drill.

## Ninety-day public history coverage

The raw retrieval experiment freezes its window at `2026-10-06T20:34:53.774Z`, with an exact 90-day cutoff of `2026-07-08T20:34:53.774Z` (Vietnam local July 9 through October 7). Its retained cohort contains **17 public channels and 23 public discussion groups**. It does not join communities or read private conversations. Channels are prioritized, but groups remain in scope.

Each source is paginated without a message cap until an older-than-cutoff sentinel or actual empty history is received. Descending IDs, pagination progress, checksummed page payloads, frozen cutoff and independent source checkpoints are verified. Interrupted processes resume retained pages rather than declaring truncated histories complete. Raw messages and extracted contacts remain in the ignored private evidence directory, not this repository report.

At this published checkpoint, **all 17 public channels and one public group are complete**. Those 18 complete sources contain:

| Observation                                               |             Count |
| --------------------------------------------------------- | ----------------: |
| Retrieved messages / distinct message IDs                 | 144,101 / 144,101 |
| Assembled materials                                       |            24,019 |
| Accounted message IDs across materials                    |           144,101 |
| Text offers extractable at publication time               |            21,983 |
| Offers returned with the actual frozen current date       |            17,674 |
| Historical text offers rejected by the two-month age gate |             4,309 |
| Parser exceptions                                         |                 0 |
| Media-only materials unresolved by the text pass          |               121 |
| Albums with different non-empty captions                  |                 1 |

**This is not a completed 40-source acceptance pass.** The remaining groups are still being collected, including high-volume histories already exceeding 100,000 messages. This document will be updated from final durable reports; partial group pages are deliberately excluded from the complete-source totals above.

Message-ID accounting is not semantic recall. The one multiple-caption album was independently reviewed: it advertises two different apartments, and production drops the second caption (#130). Likewise, zero parser exceptions does not mean every eligible listing has correct fields.

The production native adapter independently returned exactly the same 3,054 IDs and text bodies as the first complete source. That successful comparison used a one-second manual consumer delay per 100 messages and briefly removed competing history requests. An earlier native run failed on an actual 22-second flood wait; the default SDK handles short waits but the production iterator does not recover longer ones (#128). A successful throttled check is not a fix for the failed run.

### Images and protected audit

The first five complete sources contain 33 captionless materials. Every material was downloaded and inspected with local Tesseract `eng+rus+vie`: zero download/OCR exceptions, 22 materials with no readable text, and one visually confirmed rental poster. Without OCR, production returns `photo-only-ocr-unavailable`; actual OCR supplied to the same reconciliation yields an offer. Production ingestion does not wire in an OCR function (#129). The poster's visible 13M/month rent was distorted by OCR and correctly left unknown by the parser; enabling OCR alone is not accurate field acceptance. Additional completed sources have media awaiting this supplemental pass.

The **unmodified protected audit** now runs with the actual user session and real clink storage, confirming the #111 collection-name fix. One full source at its calendar-three-month cutoff returned 3,134 messages, 232 accepted offers, 139 empty-parser age-gate errors, 15 excluded materials and 20 review materials. Actual storage persist/query/edit/delete/round-trip checks all passed. Its overall acceptance remained false. Its internal segment and recall measurements are defective (#126), and custom-folder resolution incorrectly sends a dialog-filter ID as a peer-folder ID (#127). Telegram distinguishes [custom dialog filters](https://core.telegram.org/api/folders) from the archive folder accepted by [messages.getDialogs](https://core.telegram.org/method/messages.getDialogs). The native SDK's custom-folder implementation uses client-side filters and is not implicated by this audit-specific failure.

## False positives, false negatives and warnings

The existing reviewed 299-case corpus meets every configured field gate with zero false positives/negatives, including 21 explicit unavailable cases. Its former mixed-layout room false positive (#116) is fixed. The live browser match set also has perfect evaluated-field scores, but availability has no positive cases there and is explicitly **not evaluated**. Neither cohort represents independently reviewed ground truth for every retrieved Telegram message.

Current live review confirms examples outside those fixtures:

- **Listing false negatives:** rental villas containing `ищущих` are misclassified as requests; Nha Trang houses mentioning a view of Dalat are rejected as wrong-city (#125); one captionless rental poster is unparsed (#129); a second independent listing in an album is dropped (#130).
- **Field false negatives:** qualified Russian five-bedroom descriptions and a one-year minimum stay (#123); shared one-bedroom layout across floor-price variants (#124); full property code (#131); six explicitly styled Unicode rents (#132); English ordinal floors (#133); explicit named-month/ISO availability dates (#134).
- **Confirmed field false positives:** the bedroom count on the line after `17th floor` is invented as floor 3 (#133); a shortened property-code prefix is returned instead of the full reference (#131).
- **Audit false alarms:** a qualitative high floor plus `50m²` is incorrectly treated as a missing numeric floor; monetary deposits are incorrectly demanded as month counts; footer-wide pet policy, elevator-served floors, and whole-house bedrooms do not necessarily describe the selected rental option (#121). Keyword warnings are review candidates, not measured false-negative counts.
- **Uncertain source, not a confirmed parser defect:** one retained caption explicitly quotes both 8M main rent and 7M rent under additional expenses. The parser preserves the 7M–8M range; a bounded reference helper sees only 8M. Its mismatch is excluded from confirmed price-error counts.

Replaying all 1,232 retained prior offers extracted all of them. All 653 sold-out posts remained unavailable, with none `availableNow`; one location remained unknown. The additive surcharge bug (#112) is fixed. Of 833 bounded rent-reference cases, 832 match, with only the contradictory 7M/8M source above remaining. This is a reference-consistency check, not all-source human-reviewed price recall.

## Production issues for parallel fixes

| Issue                                                                    | Confirmed remaining finding                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| [#119](https://github.com/konard/vietnam-accomodation-search/issues/119) | Collector, parser, native ingestion and acceptance policy hard-code two months; cannot satisfy full 90-day parsing. |
| [#120](https://github.com/konard/vietnam-accomodation-search/issues/120) | Local security test scans ignored private runtime lockfiles/artifacts and falsely fails.                            |
| [#121](https://github.com/konard/vietnam-accomodation-search/issues/121) | Expected-field heuristics produce false floor/deposit and other scope warnings.                                     |
| [#122](https://github.com/konard/vietnam-accomodation-search/issues/122) | Actual release preflight still fails; publishing configuration and release are absent.                              |
| [#123](https://github.com/konard/vietnam-accomodation-search/issues/123) | Qualified five-bedroom and one-year minimum-stay extraction misses.                                                 |
| [#124](https://github.com/konard/vietnam-accomodation-search/issues/124) | Shared layout is lost across per-floor rent variants.                                                               |
| [#125](https://github.com/konard/vietnam-accomodation-search/issues/125) | Request substring and global other-city matches exclude valid rentals.                                              |
| [#126](https://github.com/konard/vietnam-accomodation-search/issues/126) | Protected ledger measures `undefined` and omits empty-parser listings from a recall denominator.                    |
| [#127](https://github.com/konard/vietnam-accomodation-search/issues/127) | Valid custom folder fails through incorrect raw dialog-folder semantics.                                            |
| [#128](https://github.com/konard/vietnam-accomodation-search/issues/128) | Native iterator lets a real longer flood wait abort backfill before live ingestion starts.                          |
| [#129](https://github.com/konard/vietnam-accomodation-search/issues/129) | Captionless rental needs production OCR integration and reviewed OCR quality controls.                              |
| [#130](https://github.com/konard/vietnam-accomodation-search/issues/130) | Multiple independent rental captions in one album silently lose the second property.                                |
| [#131](https://github.com/konard/vietnam-accomodation-search/issues/131) | Unicode-dash property code is truncated.                                                                            |
| [#132](https://github.com/konard/vietnam-accomodation-search/issues/132) | Mathematical-bold Unicode rent becomes unknown.                                                                     |
| [#133](https://github.com/konard/vietnam-accomodation-search/issues/133) | Ordinal floor is unknown or misbound to next-line bedrooms.                                                         |
| [#134](https://github.com/konard/vietnam-accomodation-search/issues/134) | Named-month and ISO availability dates remain unknown.                                                              |

Prior fixes #111, #112, #113, #115 and #116 are revalidated. The previous release issue's automatic closure did not establish successful publication: the actual tested-main [release run](https://github.com/konard/vietnam-accomodation-search/actions/runs/37439590697) reports zero verified and two failed publishing prerequisites. Repository release secrets/variables/releases were absent when checked. No publish credentials or production token were changed.

## Reproduction and retained evidence

Manual, opt-in experiments:

- [Resumable uncapped public history audit](../../../experiments/telegram-90-day-coverage-audit.mjs), minimum 90 days, explicit credential/cohort/private-state paths and bounded concurrency.
- [Captionless-media supplement](../../../experiments/telegram-90-day-media-audit.mjs), checksummed completed sources only, local `eng+rus+vie` OCR, private cached results.
- [Offline collector controls](../../../experiments/test-telegram-90-day-coverage-audit.mjs), no network/credentials, covering accounting, worker bounds/order and media failure handling.
- [Independent reduced regressions](../../../experiments/revalidation-pr118-regressions.mjs), 16 current defect checks fail and four negative/control checks pass. Exit 1 explicitly means reported defects remain, not that the collector fixture gate failed.
- [Existing real-credential conversation wrapper](../../../experiments/telegram-local-credential-e2e.mjs), bot-only and degraded modes.

Private logs, checksummed raw history, media, OCR output, storage graphs, container state and reports remain under `.vietnam-accomodation-search/local-revalidation-pr118-2026-10-07/`. Original prior journals and canonical data were preserved. No credentials, session strings, numeric account identities, contact details, browser profiles or raw public/private conversations are committed.

Complete broad-group retrieval and media review, fix the separately assigned defects, extend independent reviewed ground truth, then rerun protected acceptance. Passing unit/coverage/browser/E2E checks is valuable evidence but does not override the confirmed parsing gaps or failed release gate.
