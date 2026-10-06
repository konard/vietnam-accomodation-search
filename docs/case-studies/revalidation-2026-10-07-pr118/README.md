# Real-credential production revalidation of PR #118

Tested production main [`5409ea0`](https://github.com/konard/vietnam-accomodation-search/commit/5409ea06127858be05d2e0f8cd6ad25854e0c419), package 0.12.3, on 2026-10-07 in Vietnam. This continues the [PR #110 revalidation](../revalidation-2026-10-06-pr110/README.md). Production code was not changed. Test experiments and this sanitized evidence are published; production defects are separate GitHub issues for parallel fixes. Existing bot and user credentials were sufficient for the executed real Telegram tests.

**Verdict: not yet production-ready for complete 90-day parsing.** All **66 public communities—30 channels and 36 groups—are retrieved and replayed across the frozen 90-day window**, accounting for **1,224,694 messages** with zero parser exceptions. Full semantic parsing nevertheless has confirmed gaps. Unresolved media and unreviewed classifier-positive results are not counted as fully parsed housing listings.

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

The full credentialed-root Node run was 1,196/1,197: its security test falsely scanned ignored retained runtime lockfiles (#120). A clean **Git clone**, not an archive without `.git`, passed all tests. Initial archive-based checks failed the Git-dependent docs test and were setup failures, not application acceptance. Sequential reruns removed cross-suite resource contention. Shell-default Node 20 was not used for supported-runtime acceptance. A fresh clean-clone rerun after test checkpoint `0663946`, with required real Rust clink 0.2.11 first on `PATH`, passed all 1,197 tests with no skips in 32.22 seconds. A preceding incorrectly ordered `PATH` selected an installed .NET clink 2.2.2 and failed four binary-storage tests; that was an incompatible-dependency setup failure. A separate direct real-process check found production preflight accepts both incompatible and supported executables (#138).

The current Docker build is exact-revision linux/arm64, Node 24.21.0, clink 0.2.11, non-root, approximately 597 MB. Deployment used an isolated copy of approximately 3.8 GiB of actual retained data and the actual bot token. Hardened filesystem/capability settings, readiness and state retention were exercised. The final bot container was stopped; no competing test poller remains. Native amd64 execution, real published package/OCI pulls and token rotation are not established by this local drill.

A fresh actual default-paced browser/search run completed all **37 matching sources across three passes**: 19 successes in 185.07 seconds, 14 in 185.69 seconds, and the final four in 121.88 seconds. Earlier passes correctly reported shared-budget timeouts/pending sources and resumed only unfinished sources; a single pass was not complete acceptance. Real binary storage persisted and reloaded all 193 offers. Restart/cache-first search took 2.82 seconds and returned zero explicitly unavailable offers. Browser Telegram public previews are not 90-day native histories; those are independently covered below.

Actual checkpoint CI [37539841580](https://github.com/konard/vietnam-accomodation-search/actions/runs/37539841580) passed Node on Linux/macOS, Bun and Deno across all three OSes, real clink integration, lint/format and line limits. It failed both release preflight (#122) and the Windows Node command-stream literal-argument check's 30-second timeout (#139). The timeout is confirmed, but its exact cause and whether it is intermittent are not established by this macOS audit; it is not evidence of shell injection. Runtime-specific tests also contain explicit early returns for unsupported capabilities, so a runner's zero explicit skips is not proof that every platform exercised every integration. The root `npm run check` encountered a formatting warning in the user's untracked session transcript, which was preserved; this is not a tracked product-format defect.

## Ninety-day public history coverage

The raw retrieval experiment freezes its window at `2026-10-06T20:34:53.774Z`, with an exact 90-day cutoff of `2026-07-08T20:34:53.774Z` (Vietnam local July 9 through October 7). The original cohort contains 17 public channels and 23 public discussion groups; its catalog supplement adds 13 channels and 13 groups. The combined scope is **30 public channels and 36 public groups**. It does not join communities or read private conversations. Channels are prioritized, but groups remain in scope.

Each source is paginated without a message cap until an older-than-cutoff sentinel or actual empty history is received. Descending IDs, pagination progress, checksummed page payloads, frozen cutoff and independent source checkpoints are verified. Interrupted processes resume retained pages rather than declaring truncated histories complete. Normalized message-body snapshots, scalar media identifiers and extracted contacts remain in the ignored private evidence directory, not this repository report. These snapshots are not complete MTProto objects or an archive of messages deleted before retrieval.

Independent closing entity checks confirm **66 distinct canonical public peers**, with no alias duplicates or channel/group type changes; no private history was requested. Separate offline checksum/ID/date/accounting and unchanged-parser replays passed for all 40 original and all 26 supplemental sources, reproducing every saved per-source count exactly.

**All 66 sources are complete**, with no failed or pending raw-history sources. The frozen 90-day retrieval and unchanged production-parser replay contain:

| Observation                                               |                 Count |
| --------------------------------------------------------- | --------------------: |
| Retrieved messages / distinct source-and-message-ID pairs | 1,224,694 / 1,224,694 |
| Assembled materials                                       |               194,616 |
| Accounted message IDs across materials                    |             1,224,694 |
| Classifier-eligible parse results at publication time     |               150,996 |
| Parse results returned with the frozen current date       |               104,701 |
| Historical parse results rejected by the age gate         |                46,295 |
| Parser exceptions                                         |                     0 |
| Media-only materials unresolved by the text pass          |                 4,379 |
| Albums with different non-empty captions                  |                     1 |

This is a **completed 66-source raw retrieval and production-parser replay**, not a passing protected acceptance gate. The original 40-source cohort returned 577,643 messages and the 26-source supplement returned 647,051. The largest source alone returned 214,243 messages. Parser exceptions, duplicate IDs within a source and unaccounted members are zero, but the semantic defects below remain.

The final **66/66-source closing catch-up**, ending at `2026-10-06T23:05:53.709Z`, retrieved **101 additional messages**, assembled into 23 materials and 17 classifier-eligible parse results, with zero parser exceptions and zero captionless materials. Its independent checksum/parser replay passed. Comparison against the retained original pages confirms zero overlapping message IDs and zero albums split across the frozen boundary. The initial window and closing delta contain **1,224,795 distinct source-and-message-ID pairs**, covering at least 90 days through that closing snapshot. Separate phase reports preserve the original frozen counters.

**Observed retention warning:** the intermediate 40-source catch-up retrieved nine messages, but only seven are returned in the final phase. Fresh exact-ID requests for the other two return no message (the SDK represents those slots as `undefined`); their earlier snapshots remain in private evidence. Across **all retained phases**, the deduplicated observed union is therefore **1,224,797 message pairs**, not a claim that all remain visible now. No withdrawal reason or rental availability is inferred. The test-only media reader now tolerates absent SDK slots, with an offline regression; production deletion-event handling already exists and is not asserted broken. Messages deleted before their first retrieval and a continuously current historical archive cannot be proved from these snapshots.

The default catalogs contain 41 Telegram seeds. Fourteen are in the original cohort; resolving the remaining 27 with the actual session found 26 additional public communities and one **User**, not a public channel/group (#137). Only entity metadata was requested for that User; no private history was read. The completed finite audit scope covers **all 40 currently public default seeds plus 26 retained discovery sources**. It is not an assertion about every global Telegram community or unbounded future discovery. Non-Nha-Trang catalog sources use the native ingestion classifier's unrestricted geographic scope.

Code inspection also found no public-community type guard at the native public-source history boundary: the SDK's `resolvePeer(peer, true)` boolean forces resolution and does not restrict peer type. Telegram's [history method](https://core.telegram.org/method/messages.getHistory) accepts [InputPeer](https://core.telegram.org/type/InputPeer), including user peers. This is a code-derived private-routing risk, **not an observed private-history leak**. The experiment rejects non-public-community entities before history or media requests.

Message-ID accounting is not semantic recall. Classifier-eligible counters include confirmed non-housing false positives (#136), so the table is not a count of independently verified housing offers. The one multiple-caption album was independently reviewed: it advertises two different apartments, and production drops the second caption (#130). Likewise, zero parser exceptions does not mean every eligible listing has correct fields.

Publication-time parsing is a diagnostic replay, not a production age-policy fix. The original retained folder cohort uses its Nha-Trang audit classifier scope; catalog supplement entries follow native ingestion focus rules. These counters describe unchanged parser behavior under those declared scopes, not independently measured all-message housing recall.

The production native adapter independently returned exactly the same 3,054 IDs and text bodies as the first complete source. That successful comparison used a one-second manual consumer delay per 100 messages and briefly removed competing history requests. An earlier native run failed on an actual 22-second flood wait; the default SDK handles short waits but the production iterator does not recover longer ones (#128). A successful throttled check is not a fix for the failed run.

### Images and protected audit

Both media supplements are complete: **all 4,379 captionless materials assessed across 66 sources, zero download/OCR exceptions, 249 unsupported non-photo media items, and 3,132 materials with no readable OCR text** (including unsupported media). The original cohort contributes 2,277 materials and the catalog supplement 2,102. Actual local Tesseract `eng+rus+vie` produces 26 and 31 automatic historical classifier/parser-positive materials respectively: **57 automatic positives, not 57 verified rentals**. Non-photo items were explicitly marked unsupported and were not downloaded or interpreted as photos.

The supplemental experiment OCRs all available photos in a material. The protected production audit defaults to three photos, so supplemental positives depending on later images are not proof that the unchanged protected path would recover them. The two-image map and single-poster examples are within that default limit.

The first five sources contain 33 captionless materials, including one visually confirmed rental poster. Without OCR, production returns `photo-only-ocr-unavailable`; actual OCR supplied to the same reconciliation yields an offer. Production ingestion does not wire in an OCR function (#129). The poster's visible 13M/month rent was distorted by default OCR and correctly left unknown by the parser. A real-image experiment with unchanged parser and Tesseract `--psm 11` recovered **13,000,000 VND/month**, while `--psm 6` still left it unknown. Sparse-text mode still misread the map as 19 EUR/month (#135), so recovering this poster is not a validated global OCR configuration.

The ongoing image review also visually verified a September 28 navigation map showing **19 minutes / 9.3 km**, with no EUR rent. Actual OCR misreads the travel icon as `€`; the unchanged protected batch accepts **19 EUR/month** with no review reason (#135), including at the frozen current date. Its two images are within the default three-photo OCR limit. Native ingestion currently has no OCR and does not already display this false price; the protected OCR path does, and the mistake must be controlled before OCR integration. Automated OCR-positive counts are not human-reviewed rental recall. Non-photo documents/videos remain explicitly unsupported rather than being counted as fully parsed.

The **unmodified protected audit** now runs with the actual user session and real clink storage, confirming the #111 collection-name fix. One full source at its calendar-three-month cutoff returned 3,134 messages, 232 accepted offers, 139 empty-parser age-gate errors, 15 excluded materials and 20 review materials. Actual storage persist/query/edit/delete/round-trip checks all passed. Its overall acceptance remained false. Its internal segment and recall measurements are defective (#126), and custom-folder resolution incorrectly sends a dialog-filter ID as a peer-folder ID (#127). Telegram distinguishes [custom dialog filters](https://core.telegram.org/api/folders) from the archive folder accepted by [messages.getDialogs](https://core.telegram.org/method/messages.getDialogs). The native SDK's custom-folder implementation uses client-side filters and is not implicated by this audit-specific failure.

## False positives, false negatives and warnings

The existing reviewed 299-case corpus meets every configured field gate with zero false positives/negatives, including 21 explicit unavailable cases. Its former mixed-layout room false positive (#116) is fixed. The live browser match set also has perfect evaluated-field scores, but availability has no positive cases there and is explicitly **not evaluated**. Neither cohort represents independently reviewed ground truth for every retrieved Telegram message.

Current live review confirms examples outside those fixtures:

- **Listing false negatives:** rental villas containing `ищущих` are misclassified as requests; Nha Trang houses mentioning a view of Dalat are rejected as wrong-city (#125); one captionless rental poster is unparsed (#129); a second independent listing in an album is dropped (#130).
- **Field false negatives:** qualified Russian five-bedroom descriptions and a one-year minimum stay (#123); shared one-bedroom layout across floor-price variants (#124); full property code (#131); six explicitly styled Unicode rents (#132); English ordinal floors (#133); explicit named-month/ISO availability dates (#134).
- **Confirmed false positives:** nine current vehicle sales/rentals/requests become accommodation offers in a risk-targeted ten-post review (#136); the tenth is a genuine studio mentioning travel by motorbike and must stay eligible. A map's travel time becomes 19 EUR/month in the real OCR audit (#135). The bedroom count on the line after `17th floor` becomes floor 3 (#133), and a shortened property-code prefix substitutes for the full reference (#131). The risk-targeted sample is not a random all-source precision estimate.
- **Audit false alarms:** a qualitative high floor plus `50m²` is incorrectly treated as a missing numeric floor; monetary deposits are incorrectly demanded as month counts; footer-wide pet policy, elevator-served floors, and whole-house bedrooms do not necessarily describe the selected rental option (#121). Keyword warnings are review candidates, not measured false-negative counts.
- **Uncertain source, not a confirmed parser defect:** one retained caption explicitly quotes both 8M main rent and 7M rent under additional expenses. The parser preserves the 7M–8M range; a bounded reference helper sees only 8M. Its mismatch is excluded from confirmed price-error counts.

A separate real rich-text probe sampled 500 public messages across five sources: 141 hidden Telegram-link entities were observed. All 11 explicit contact-link candidates already expose visible `@username` contacts and match their actual link targets after parsing. Those links are not confirmed contact false negatives; the remaining rich-link/UI semantics are not claimed as comprehensively parsed. Two adversarial 100,000-whitespace parser controls completed in 65.71 ms and 18.32 ms; this is bounded performance evidence for those patterns, not exhaustive fuzzing.

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
| [#135](https://github.com/konard/vietnam-accomodation-search/issues/135) | Actual OCR map travel time becomes an accepted 19 EUR/month rent.                                                   |
| [#136](https://github.com/konard/vietnam-accomodation-search/issues/136) | Real vehicle sales/rentals/requests are accepted as accommodation offers.                                           |
| [#137](https://github.com/konard/vietnam-accomodation-search/issues/137) | Configured public seed resolves to a User; native public-source routing lacks a community-type guard.               |
| [#138](https://github.com/konard/vietnam-accomodation-search/issues/138) | Binary-storage preflight accepts an actual incompatible same-name clink executable.                                 |
| [#139](https://github.com/konard/vietnam-accomodation-search/issues/139) | Actual Windows Node CI literal-argument check times out; root cause remains unverified.                             |

Prior fixes #111, #112, #113, #115 and #116 are revalidated. The previous release issue's automatic closure did not establish successful publication: the actual tested-main [release run](https://github.com/konard/vietnam-accomodation-search/actions/runs/37439590697) reports zero verified and two failed publishing prerequisites. Repository release secrets/variables/releases were absent when checked. No publish credentials or production token were changed.

## Reproduction and retained evidence

Manual, opt-in experiments:

- [Resumable uncapped public history audit](../../../experiments/telegram-90-day-coverage-audit.mjs), minimum 90 days, explicit credential/cohort/private-state paths and bounded concurrency.
- [Captionless-media supplement](../../../experiments/telegram-90-day-media-audit.mjs), checksummed completed sources only, local `eng+rus+vie` OCR, private cached results.
- [Offline collector controls](../../../experiments/test-telegram-90-day-coverage-audit.mjs), no network/credentials, covering accounting, worker bounds/order and media failure handling.
- [Independent reduced regressions](../../../experiments/revalidation-pr118-regressions.mjs), 19 current defect checks fail and five negative/control checks pass. Exit 1 explicitly means reported defects remain, not that the collector fixture gate failed.
- [Existing real-credential conversation wrapper](../../../experiments/telegram-local-credential-e2e.mjs), bot-only and degraded modes.

Private logs, checksummed raw history, media, OCR output, storage graphs, container state and reports remain under `.vietnam-accomodation-search/local-revalidation-pr118-2026-10-07/`. Original prior journals and canonical data were preserved. No credentials, session strings, numeric account identities, contact details, browser profiles or raw public/private conversations are committed.

Complete independent semantic/media review, fix the separately assigned defects, extend reviewed ground truth, then rerun protected acceptance. Passing unit/coverage/browser/E2E checks and complete raw-history retrieval are valuable evidence but do not override the confirmed parsing gaps or failed release/Windows CI gates.
