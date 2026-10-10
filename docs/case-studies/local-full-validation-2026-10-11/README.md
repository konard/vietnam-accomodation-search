# Local full validation and latest dependencies — 2026-10-11

## Verdict and scope

The merged fixes in PR #164 pass fresh local regression tests. The latest-dependency candidate is based on `9cec904e7242c44f2cfea03b986eab444eaf4607`; it updates dependency/tool pins, lockfiles, associated version assertions, QA experiments and documentation. It does not implement new application ranking, exhaustive-source selection or native-media retry logic. These production changes remain assigned through issues under the user's QA-only instruction.

**Not fully production-ready for the newly requested “best offers from exactly all supported sources” requirement.** Per-bedroom value ranking and comparable stay prices are missing (#165), exhaustive source completion is not implemented (#166), legacy “rooms” accuracy metrics actually measure bedrooms (#167), and native-media scheduling/retry needs scale acceptance (#170). A successful tested workflow is not a claim that every source, image and field is complete or that global false positives/negatives are zero.

All real credentials, source/account identities, original messages, images, contacts, private cohort membership and detailed workload evidence remain in the ignored, permission-restricted local QA directory. The original checkpoints, journals, user transcripts and existing deployment state are preserved. Telegram writes are limited to the credential owner's bot chat; only QA-created messages are cleaned up. Browser tests use isolated profiles, not personal signed-in browser state. No public-channel writes or access-challenge bypasses are performed.

## Dependency updates

Current npm registry metadata was checked for both the root package and the universal example. All direct npm dependencies match their current latest tags **except the explicit command-stream security hold**. Overrides and script-loaded versions are included, rather than checking only the manifest's direct imports.

Compatible transitive updates were also applied with `npm update` in both projects. Final `npm outdated --all` checks find no installed package with a newer semver-compatible wanted version. Older dependency-constrained majors and intentionally absent optional platform/peer packages are not force-overridden. Examples of refreshed transitive packages include ESLint utilities 4.10.1, cac 7.0.1, flatted 3.4.4, human-id 4.2.2, ip-address 10.7.3, shell-quote 1.12.0, Electron rebuild 4.2.1, node-abi 4.37.0, pkijs 3.4.1 and rolldown 1.2.13. Full runtime and clean-image controls are repeated after this lockfile refresh.

Deno's compatible graph was independently resolved into a fresh private lock, then adopted only after version/security inspection. The normal frozen suite passes with that refreshed lock; no stale transitive resolution or age-policy override is required at test time. Live native identity, public history/media, owner-only sends/updates, combined transport, restart idempotency and owned-message cleanup also pass after the final network-library updates.

| Component                                          | Verified candidate                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| browser-commander                                  | 0.28.0                                                                               |
| Playwright                                         | 1.64.0, matching Chromium installed                                                  |
| command-stream                                     | 1.5.0 consistently in root, browser override and script bootstrap; latest 2.0.0 held |
| links-notation / log-lazy / lino-arguments / use-m | Current latest: 0.25.1 / 1.0.4 / 0.3.0 / 8.16.4                                      |
| ESLint / jscpd / Prettier / teleproto              | 10.12.0 / 5.4.1 / 3.9.10 / 1.230.0                                                   |
| Native SQLite override                             | better-sqlite3 13.0.3                                                                |
| Rust link-cli / clink                              | 1.0.0; local mandatory integration, CI install pin and Docker install pin updated    |
| Container bases                                    | Stable Rust 1.99.0 and Node 24.21.0 Active LTS, exact multi-architecture digest pins |
| Capacitor android/core/ios/cli                     | 8.5.3                                                                                |
| Vite React plugin / Vite / Electron                | 6.1.2 / 8.3.4 / 44.7.0                                                               |
| Example xcode UUID override                        | 14.0.3                                                                               |

The command-stream 2.0.0 trial introduces the ShellJS → fast-glob → micromatch → braces high-severity advisory chain. No patched braces release was available at validation time. The final 1.5.0 candidate and example lockfiles both report **zero npm audit vulnerabilities**. This is not a blind downgrade of unrelated dependencies, and `npm audit fix --force` is not used. Track safe latest adoption in [command-stream #221](https://github.com/link-foundation/command-stream/issues/221) and [application #168](https://github.com/konard/vietnam-accomodation-search/issues/168); advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Node 24 remains the selected production LTS line; adopting Node 26 Current is a separate major-runtime decision. Rust and Node versions/manifests were checked against official releases and exact-version Docker tags, not assumed from older image comments.

Browser-commander 0.28.0 was younger than Deno's default dependency-age hold. An explicit one-time `--minimum-dependency-age=0` install/test regenerated the lock at the user's request for latest versions. Subsequent normal `deno test --frozen --allow-read` passed **without that override**. No global or project dependency-age policy was disabled.

## Completed local acceptance

| Gate                                                       | Result                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node complete suite, mandatory real clink 1.0.0            | 1,345 passed; zero failures, cancellations or skips                                                                                                                               |
| Node product coverage                                      | 100% lines, 96.79% branches, 98.97% functions                                                                                                                                     |
| Bun 1.4.2, repository's 30-second test timeout             | 1,345 passed; zero failures                                                                                                                                                       |
| Deno 2.9.6, normal frozen lock                             | 1,228 passed plus 19 steps; zero failures; 11 documented native/SDK/filesystem ignores                                                                                            |
| Final root and example dependency audits                   | Zero vulnerabilities                                                                                                                                                              |
| Zero-warning lint, tracked formatting, duplication gate    | Pass                                                                                                                                                                              |
| Installed native SDK media/entity/download counterexamples | Pass; real SDK scalar identities and hidden entity evidence retained; bounded streaming download exercised                                                                        |
| Graph retention counterexample, real clink 1.0.0           | Pass; ample-budget graph remains closed/complete, constrained retention is correctly degraded rather than falsely complete                                                        |
| Browser selector drift and browser-commander contracts     | Pass; legacy/current card fixtures, per-call navigation wait controls and early-exit diagnostics                                                                                  |
| Offline native poster example                              | Actual SDK implementation, actual multilingual Tesseract, multipart upload control, fresh clink readback and restart pass                                                         |
| Clean production image, final base pins                    | Non-root/read-only/dropped-capability SQLite, provider construction, Chromium, actual Tesseract and fresh clink pass; CLI browser/search self-checks pass                         |
| Example web / desktop / mobile tooling                     | Vite build, unsigned local Electron package and Capacitor sync pass                                                                                                               |
| Example interactive UI                                     | Desktop/mobile-width arithmetic, no horizontal overflow and no page errors pass                                                                                                   |
| Fresh real public-history catch-up                         | All configured/discovered audit-cohort checkpoints complete; parser-error accounting passes                                                                                       |
| Full retained history replay                               | More than 90 days; checksum/window/source alignment passes; every retained message accounted for; zero parser exceptions                                                          |
| Reviewed 299-case field corpus                             | Zero measured FP/FN for its labelled legacy fields; “rooms” label caveat below                                                                                                    |
| Live public browser route audit                            | 7 success, 3 parse-incomplete; incompleteness remains visible                                                                                                                     |
| Live SearchService reviewed-card matching                  | 39 matched reviewed cards; evaluated labelled fields have zero measured FP/FN; availability has no matched labels and remains not-evaluated                                       |
| Real native captioned-photo workflow                       | Original media identities, actual OCR, fresh durable readback, graph-reference closure, accepted Bot API photo notification, restart deduplication and owned-message cleanup pass |
| Real conversation modes                                    | Final bot-only and degraded-mode scenarios pass through commands, presets, subscription delivery, restart and zero surviving QA conversation messages                             |

The final native source still reports a **degraded** extraction checkpoint, including unresolved OCR/review states and transient missing cached media. Telegram flood waits were observed and honored. Selecting an eligible cached-photo offer proves that transport path works; it does not turn the whole source's degraded result into complete extraction.

The six isolated deployment/cutover transitions pass: first deployment, redeployment, rejected preflight candidate, snapshot rollback, rejected unhealthy candidate and project recreation. Every transition verifies a real owner-bot reply and state preservation; rollback verifies the actual image ID. Owned messages, containers and the temporary credential file are cleaned up. The existing deployment is not touched.

## All-source inventory and limits

The public manifest contains **29 web seeds, only 8 enabled**, and **41 Telegram seeds, one explicitly disabled**. The default web-route QA fixture covers ten property routes, including two additional discovered routes; this is not the entire web seed manifest. Fresh checks of the disabled public web entries do not enable them in production.

Enabled web seeds are Homedy, Nha Trang Land, New Home, Nha-Trang.vn, Your Home, Alo Nhà Đất, Be Jib and Nha Trang Renting. Disabled catalogue entries are Booking.com, Airbnb, Agoda, Traveloka, Expedia, Hotels.com, Trip.com, Hostelworld, Google Hotels, Tripadvisor, Vrbo, Klook, KAYAK, trivago, Skyscanner, Vntrip, iVIVU, Mytour, Batdongsan.com.vn, Nha Tot and HotelMix. Their manifest reasons include previously empty inventories, landing pages, collection failures, consent walls and access challenges; these historical reasons are not substituted for fresh runtime observations.

Fresh disabled-catalogue navigation completed for all 21 entries: the existing QA classifier reports 12 zero-card routes, 5 challenges, 3 rate-limited routes and 1 unexpected navigation error. Raw status evidence further distinguishes HTTP failures from real empty inventory: Hostelworld, Vntrip and iVIVU return 404, and Trip.com returns 502. A zero-card label for these responses is **not evidence of a successful empty search**. No challenge was bypassed and no disabled entry was enabled.

An independent self-authored HTTP-status probe reproduces a QA false positive: HTTP 503 with a recognizable rental card is labelled `success`. Failure responses need explicit categories before empty/card inference. Filed as [#171](https://github.com/konard/vietnam-accomodation-search/issues/171); raw status failures remain visible in this report while the QA classifier awaits correction.

| Disabled route                                                       | Fresh observation                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Booking.com, Airbnb, Agoda, Google Hotels, KAYAK, Skyscanner, Mytour | No recognized rental cards, HTTP 200; not complete inventory acceptance |
| Traveloka                                                            | No recognized cards, HTTP 202; not a final successful result            |
| Hostelworld, Vntrip, iVIVU                                           | HTTP 404, no recognized cards                                           |
| Trip.com                                                             | HTTP 502, no recognized cards                                           |
| Tripadvisor, Klook, trivago, Batdongsan.com.vn, Nha Tot              | HTTP 403/access challenge; stopped without bypass                       |
| Expedia, Vrbo, HotelMix                                              | HTTP 429/rate limited; no rate-limit bypass                             |
| Hotels.com                                                           | Repeated `net::ERR_HTTP2_PROTOCOL_ERROR`; not a successful source       |

Registry ranking caps, geographic selection, finite search budgets, pending sources, partial Telegram previews and cached results prevent an ordinary search from proving exhaustive latest-offer coverage. Native history audit/replay covers the retained configured/discovered cohort, not a guaranteed continuously complete universe of supported sources. See [#166](https://github.com/konard/vietnam-accomodation-search/issues/166).

Text replay cannot recover fields omitted from the old collector, OCR every retained photo, support all non-photo media types, recover messages deleted before retrieval, or independently verify every historical edit/deletion. Captionless OCR requires reviewed field truth; retained classifier agreement is not independent precision/recall.

## Unit-value ranking and metric counterexamples

`experiments/revalidation-unit-value-ranking.mjs` feeds the same self-authored offer through every public seed alias: 12 million VND/month, 2 bedrooms, 3 rooms, 4 beds. All aliases preserve those distinct counts. Existing room and bed ceiling controls pass at 4 million/room and 3 million/bed, including just-below-boundary rejection. This is a normalization control, **not live collection from every source**.

The requested bedroom ceiling/CLI command and per-bedroom value ordering are missing. A 3-bedroom offer at 12 million/month should outrank a 1-bedroom offer at 6 million/month on bedroom value, but total-price ordering chooses the latter. An explicit 30-night comparison also fails to compare nightly and monthly quotes on a common stay basis. Comparable ranking must retain quote basis, duration, unit denominator, fees and provenance, and must not invent bedroom/room/bed counts for unknown or studio values. See [#165](https://github.com/konard/vietnam-accomodation-search/issues/165).

Both `field-corpus-metrics.mjs` and `audit-search-service.mjs` currently populate their metric named `rooms` from `offer.attributes.bedrooms`. The same self-authored 2-bedroom/3-room/4-bed fixture reports metric rooms=2. Existing passing “rooms” results therefore validate bedrooms, not actual rooms, beds, or correct unit-price denominators. Do not relabel reviewed truth blindly; expand the independent corpus and distinguish the fields. See [#167](https://github.com/konard/vietnam-accomodation-search/issues/167).

`experiments/revalidation-native-photo-concurrency.mjs` uses ten fictitious installed-SDK Photo objects and a fake client. All cache successfully, but one album performs ten simultaneous original-message lookups. Shared rate-aware scheduling, media-resolution reuse and resumable transient retry remain a scale feature gap in [#170](https://github.com/konard/vietnam-accomodation-search/issues/170). Its contribution to observed live flood waits is an inference, not a controlled server-side causal claim.

The ranking/metric, concurrency, HTTP-status and trace-privacy diagnostics deliberately exit nonzero while their stated capability gaps remain. They are not added as misleading green production acceptance gates.

## False positives, warnings and upstream follow-up

A real conversation completed but the first cleanup assertion counted an empty Telegram `MessageService` as a surviving QA reply. A separate check found no QA-marked leftovers. QA-only correction excludes explicit service/deleted-placeholder types while retaining blank ordinary messages; a regression test and both live-mode reruns pass. This does not change application authorization or delete unrelated messages. Tracked in [#169](https://github.com/konard/vietnam-accomodation-search/issues/169).

One Bun rerun accidentally used its 5-second default instead of the repository's explicit 30-second test timeout while real ingestion was active. Timeout-induced unfinished tests produced cascading fixture-state errors. The corrected full invocation passed all 1,345 tests. The initial catch-up helper also lacked the explicit history opt-in; it failed before API collection, then the guarded supported command completed. These setup failures are preserved as QA evidence, not counted as production defects.

The first final-lock cutover rerun was correctly rejected by the one-poller guard because the stopped prior QA project's recovery record still reserved its bot token. Read-only container checks confirmed both owned projects were stopped; that explicitly owned temporary-checkout record was archived, not deleted, before a fresh drill. The guard was not bypassed and original deployment records were not changed.

The first strengthened native-photo workflow selected a source whose captioned offers had no media; native identities and actual OCR passed, but the strict photo-notification candidate gate correctly failed. A second source with independently observed captioned-photo material passed the full photo path. The first failure remains preserved, not overwritten or called a photo-delivery pass. Application media-cache directories are now explicitly confined to the fresh QA directory even when a custom store is supplied.

Current upstream probes:

- Browser-commander 0.28.0 passes the application's selector/navigation/launch controls. A self-authored sentinel confirms that `privacy.redactPatterns` is not applied to HTML checkpoint payloads; the manifest configuration is excluded from the scan, so the result is not caused by storing the pattern itself. Fresh reproduction added to [#153](https://github.com/link-foundation/browser-commander/issues/153). Audit traces stay private; no raw checkpoints or contact-bearing artifacts are published. Optional browser traces cannot be treated as privacy-safe out of the box while that issue remains open.
- Links-notation 0.25.1 passes all quote-kind/reference round trips; prior [#332](https://github.com/link-foundation/links-notation/issues/332) is closed and the old failure is not repeated as current.
- `use-m` 8.16.4 still leaves the self-authored stalled response body pending beyond its requested deadline; the application's bounded-fetch control rejects. Fresh evidence added to [#80](https://github.com/link-foundation/use-m/issues/80).
- `test-anywhere` 0.9.1 still reports passing TAP for the options-overload test while its callback executes zero times. Explicit body-execution diagnostic fails; fresh evidence added to [#148](https://github.com/link-foundation/test-anywhere/issues/148). The repository's actual tests use the working overload.
- Latest command-stream 2.0.0 adoption remains blocked by its public security dependency chain, not by an untested preference for an older version.

Install-script allowlist warnings were not blindly bypassed; actual native SDK/image acceptance passed. The example package emits default-icon/unsigned-macOS notices and is not a signed distribution. Capacitor sync does not substitute for physical Android/iOS execution. Deno ignores, live partial parsing, unverified OCR and rate-limit warnings remain explicitly visible.

The package-manager declaration check passes with its expected foreign-lockfile warning: `deno.lock` is intentional for cross-runtime coverage, and the declared npm manager takes precedence. It is not removed merely to silence that warning.

## Handoff

Dependency/tool changes are tracked in [#168](https://github.com/konard/vietnam-accomodation-search/issues/168), QA cleanup in #169, HTTP classification in #171, and application work in #165–167 and #170. No new application feature fix is silently included. The historical October 9 case study remains unchanged; this report describes the newer merged code and dependency candidate.
