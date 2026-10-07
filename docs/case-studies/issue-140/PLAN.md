# Issue 140 requirements and implementation plan

This single PR tracks every requirement from issues 119–139 and includes each required closing reference. Code changes do not satisfy the external release and real-session acceptance gates by themselves. All issue bodies and comments were read on 2026-10-07. Already resolved or externally blocked acceptance must be stated explicitly in the PR; no follow-up PR is planned.

## Work checklist

- [x] Verify prepared branch, clean status, contributing guidelines and issue/PR discussion.
- [x] Read all 21 issue bodies and comments, and recent related merged PRs.
- [x] Research primary documentation and compare existing components.
- [x] Add minimum failing regressions before fixes, including shared call paths.
- [x] Implement parser/normalization/classifier and album fixes.
- [x] Implement history/retry/public-peer/media/checkpoint fixes.
- [x] Correct audit evidence, folder resolution, local workflow and clink preflight.
- [x] Verify release prerequisites without reporting missing credentials as success.
- [x] Run local full tests, formatting, lint, duplication, file/syntax/docs checks and real clink checks.
- [x] Preserve atomic commits after checks, verify latest main is included and restrict pushes to issue-140-635e3b1d32be.
- [x] Review the implementation diff and prepare the final PR title/body with all closing references and evidence.
- [x] Inspect timestamp/SHA of CI; save failing logs to ci-logs and analyze concrete errors.
- [x] Add meaningful controls for both CI coverage failures without lowering the 100% gate.
- Track final-head CI on [PR 141](https://github.com/konard/vietnam-accomodation-search/pull/141); await all commands, confirm a clean tree and mark ready after checks pass. Its description records the final mutable CI status.
- [ ] External acceptance: real-session 90-day cohort/retry parity, original private poster and actual release publication remain blocked by unavailable credentials/data.

Experiments use finite datasets and bounded child processes. Large logs are retained locally. No private runtime evidence is committed. Files over 1500 lines are read in chunks.

## Requirements, solutions and controls

### #119: At least 90-day public history cannot be fully parsed: collector and parser hard-code two months

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/119).

Proposed implementation: Use a shared frozen UTC history window (90 days by default; configurable days/since) in parsing, collectors, durable ingestion, audit and resume state. Keep older extracted offers historical/unknown availability. Test boundary, catch-up, interrupted checkpoints and >3,000 messages with LinksStore.

Full requirement context (including every comment):

# Requested 90-day public-channel ingestion is blocked by hard-coded two-month parser/collector gates

Verified on main `5409ea06127858be05d2e0f8cd6ad25854e0c419`, 2026-10-07 local, with the existing authorized Telegram user session. This is a capability gap against the owner's explicit requirement to fully cover at least the last 90 days, not an assertion that the former documented two-month default was unintended.

The uncapped, read-only history audit reached the 90-day date boundary on the first public source, retaining and accounting for all 3,054 messages / 395 album-or-message materials. Of 362 materials eligible for rental text extraction, 232 produce an offer at the current audit time and 130 return null solely because of the age gate. All 362 parse when evaluated at their publication time. No parser exception occurred.

Three hard-coded boundaries need to be addressed together:

- `src/telegram-parser.js`: `parseTelegramOffer` rejects messages older than `twoMonthsBefore(now)` before extracting any text, without a configurable history window.
- `src/telegram-history.js`: `TelegramHistoryCollector.collect` always requests and filters two months.
- `experiments/audit-telegram-accommodations.mjs`: the runner accepts `--months 3`, but acceptance still requires `options.months === 2`; older eligible materials then become empty-parser terminal errors.

Offline reproduction:

```js
import { classifyTelegramPost, parseTelegramOffer } from './src/index.js';
const message = {
  date: new Date('2026-07-10T00:00:00Z'),
  messageId: 1,
  sourceId: 'telegram:synthetic-history-window',
  text: 'For rent: 2 bedroom apartment in Nha Trang, 8 million VND/month.',
};
console.log(classifyTelegramPost(message.text).eligible); // true
console.log(
  parseTelegramOffer(message, { now: new Date('2026-10-07T00:00:00Z') })
); // null
console.log(Boolean(parseTelegramOffer(message, { now: message.date }))); // true
```

Required acceptance:

1. An explicit >=90-day collection and extraction configuration, with one frozen UTC boundary propagated consistently.
2. Preserve historical messages and extraction results without falsely presenting stale/unavailable offers as currently available.
3. Boundary, paging, checkpoint/resume, and greater-than-3,000-message tests using real storage; age-related omissions must be explicit rather than parser success.
4. A complete real-credential public-cohort pass reaching the boundary or exhausting each source, with raw-message accounting, exceptions, review/media unknowns, and independent extraction review reported separately.

Private raw pages and checkpoints are retained locally, not attached. The reusable diagnostic is being committed as `experiments/telegram-90-day-coverage-audit.mjs`. Its historical text pass deliberately does not change the production gate and does not establish current availability or independent ground-truth recall.

Comment requirement/evidence:

One more production boundary confirmed by source inspection: `MtcuteTelegramIngestion.start()` in `src/telegram-mtcute.js` also subtracts exactly two calendar months before filtering retained events and requesting backfill. The >=90-day configuration must propagate through this actual durable ingestion path as well as `TelegramHistoryCollector`, `parseTelegramOffer`, and the audit acceptance gate. A diagnostic collector obtaining older text does not establish production backfill support.

Comment requirement/evidence:

Completed uncapped real-session audit and independent checksum/parser replays now cover all 66 distinct canonical public communities (30 channels, 36 groups), including every currently public default seed. The frozen exact 90-day window contains 1,224,694 accounted source/message pairs; publication-time diagnostic parsing yields 150,996 classifier-eligible results versus 104,701 at the frozen current date, a difference of 46,295 age-gate rejections. These are conditional parser results, not independently verified rental counts. A final 66-source catch-up adds 101 messages through 2026-10-06T23:05:53.709Z. Two messages preserved from an intermediate phase no longer return on exact-ID requests; deduplicated observations across all retained phases total 1,224,797, with no claim of an immutable deleted-message archive. The test-only experiments and sanitized report are published at https://github.com/konard/vietnam-accomodation-search/commit/f6e5eb5156ca19d83ebfac9488713707f85100f9 ; report: docs/case-studies/revalidation-2026-10-07-pr118/README.md. Production code remains unchanged.

### #120: Local security workflow test falsely audits ignored runtime lockfiles and scans private browser artifacts

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/120).

Proposed implementation: Discover tracked lockfiles with git ls-files rather than walking private runtime directories. Test ignored locks and tracked application locks without deleting retained artifacts.

Full requirement context (including every comment):

# Security-workflow test scans ignored runtime evidence and fails in a credentialed local checkout

Verified on main `5409ea0`, Node 24.18.0, real clink 0.2.11. The full local suite reports 1,196 passed / 1 failed out of 1,197.

`tests/security-workflow.test.js:listPackageLocks()` recursively traverses every directory except `.git` and `node_modules`. It enters the ignored `.vietnam-accomodation-search/` runtime directory, including an isolated validation checkout retained from the prior test pass, and expects its private lockfiles to appear in the production CI audit matrix.

Actual mismatch:

```text
matrix: examples/universal-app/package-lock.json, package-lock.json
scan:   .vietnam-accomodation-search/.../isolated/examples/universal-app/package-lock.json,
        .vietnam-accomodation-search/.../isolated/package-lock.json,
        examples/universal-app/package-lock.json, package-lock.json
```

The synchronous scan took 37.29 seconds because it also traversed retained browser-profile/runtime data. These files are untracked and explicitly ignored by `.gitignore`, ESLint, Prettier, and duplication checks. They are not shipped application dependencies or missing CI coverage.

Reproduce by placing a small `package-lock.json` beneath an ignored runtime subdirectory and running `node --test tests/security-workflow.test.js`. Do not delete retained private test evidence to make the test pass.

Required fix: derive the expected audit set from tracked/package-managed repository files (or explicitly exclude all runtime/artifact roots), retain the fail-closed check for actual application/example locks, and add an ignored-runtime regression. This is a test false positive and local workflow defect, not a newly discovered dependency vulnerability. Both current root/example npm audits report zero vulnerabilities.

### #121: Live audit falsely reports missing floor: high-floor + 50m² is mistaken for a numeric floor

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/121).

Proposed implementation: Use explicit same-clause typed signals, including monetary deposits, explicit boolean policies and selected-option scope. Preserve independent diagnostic signals for real floor misses.

Full requirement context (including every comment):

# Live audit's expected-floor heuristic mistakes apartment area for a floor number

Verified on main `5409ea0` during the real 90-day public-channel audit. The first source reports 194 heuristic `floor` misses; manual inspection shows repeated posts saying `Высокий этаж. 50m²` (high floor, 50 square metres), not an explicit numeric floor. These must not all be counted as parser false negatives.

`experiments/telegram-accommodation-audit-lib.mjs` has an `EXPECTED_SIGNALS` floor regex that accepts up to ten non-digits after `этаж`, crossing punctuation into `50m²`. `missingExpectedDetails()` therefore expects a numeric `attributes.floor`, although `parseListingText()` correctly leaves the unstated floor unknown and extracts `areaM2: 50`.

Small reproduction:

```js
import {
  expectedDetails,
  missingExpectedDetails,
} from './experiments/telegram-accommodation-audit-lib.mjs';
import { parseTelegramOffer } from './src/index.js';
const text =
  'Сдаётся студия в Нячанге. Высокий этаж. 50m². Аренда 8 млн VND/месяц.';
const offer = parseTelegramOffer({ date: new Date(), text });
console.log(expectedDetails(text)); // includes floor
console.log(offer.attributes.areaM2, offer.attributes.floor); // 50, undefined
console.log(missingExpectedDetails(offer, text)); // includes floor
```

Required fix: associate floor signals with an explicit numeric floor expression, reject area/price/room-number spillover and qualitative floor descriptors, cover RU/EN/VI punctuation/newline boundaries, and preserve genuine numeric-floor miss reporting. Review existing live-audit missing-field totals before interpreting them as extraction recall. The historical collector intentionally labels these counters as heuristics, not reviewed precision/recall.

Comment requirement/evidence:

Additional verified false-warning patterns from the second fully retrieved public source (68,111 messages):

- `Deposit: 20 million VND` is correctly represented as `attributes.deposit`, but `missingExpectedDetails()` only checks `depositMonths` and reports a miss anyway. A monetary deposit is not a stated number of months.
- `Лифт (этажи 1–3)` describes the elevator's served floors, not a specific apartment floor; the heuristic expects `attributes.floor` anyway.
- The recurring navigation footer `👉 АРЕНДА С ЖИВОТНЫМИ` links to other pet-friendly inventory; generic keyword presence does not establish this listing's boolean pet policy. Similarly, a mention of utilities/individual utilityCharges is not always an explicit `utilitiesIncluded` boolean.
- A whole two-bedroom house versus a cheaper first-floor-only open space legitimately leaves the cheaper option's bedrooms unknown. Whole-post expected-field presence must respect the selected property option.

The current audit's counters are diagnostic indicators, not reviewed false-negative counts. Extend the #121 fix to respect value types, footer/option scope, and alternatives instead of requiring one narrow attribute whenever a broad keyword appears. Floor example and genuine numeric-field negative controls remain required.

### #122: Release still blocked on PR118 main: actual preflight fails and no publishing configuration or release exists

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/122).

Proposed implementation: Verify current repository publishing settings, release-mode preflight, releases and artifacts. Keep missing credentials/external publication visibly blocked; preserve fail-closed gates and supply an owner configuration runbook.

Full requirement context (including every comment):

# Release acceptance is still unmet on PR118 main despite issue114 being closed

Successor to #114, automatically closed by PR #118's aggregate closing references. The implementation report itself states publishing acceptance is unmet. This new check confirms the current external state, not just historical failure.

Actual main commit: `5409ea06127858be05d2e0f8cd6ad25854e0c419`.

Actual main workflow: https://github.com/konard/vietnam-accomodation-search/actions/runs/37439590697, created `2026-10-06T08:57:12Z`. Its Release Preflight fails at `2026-10-06T08:57:17Z` with **0 verified, 2 failed, 0 unknown**:

- npm package does not exist; the first publication requires authorized bootstrap `NPM_TOKEN`.
- Required native linux/amd64 + linux/arm64 images have no configured `DOCKERHUB_IMAGE` / account / publishing token.

Fresh read-only CLI checks on 2026-10-07 local show repository secrets `[]`, variables `[]`, and releases `[]`. Root and example dependency audits and the main Security / Example app / Broken Link Checker workflows pass; those do not establish actual publication.

Keep acceptance visibly open until authorized owner configuration is present and the exact release commit passes real release-mode preflight, publishes npm/GitHub/OCI artifacts, verifies both native platform manifests/digests, and passes a clean install of the actual published package. Do not replace real authentication/write probes with report-mode success or automatically close this issue solely through aggregate code-only closing references.

Existing Telegram credentials are available locally and native Telegram tests have actually passed. A separate Telegram test account is not a prerequisite for resolving this publishing blocker. Bot token rotation is not verified and was not performed.

Comment requirement/evidence:

The pushed test-only checkpoint 066394607942dfe43f166eb2cef07bfd8d639c1d reproduces the missing publishing-prerequisite failure again in actual Actions run https://github.com/konard/vietnam-accomodation-search/actions/runs/37539841580 . Release Preflight fails at Probe every release credential; release and publishing remain skipped. The real Rust clink integration succeeds. A separate Windows Node test timeout also fails this run and is being reported independently; the workflow failure must not be attributed solely to release credentials.

### #123: Live rental field false negatives: 5 отдельные спальни and minimum lease of 1 year become unknown

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/123).

Proposed implementation: Bound room qualifiers to the same clause, recognize RU/EN/VI explicit lease years, convert to months, and exercise normalized Telegram/search filters with negative controls.

Full requirement context (including every comment):

# Real rental posts lose explicit bedroom counts and year-based minimum stays

Verified on current main `5409ea0` by independently inspecting the private 90-day history of the first public rental channel. Two house posts explicitly state `5 отдельные спальни` and `Аренда от 1 года`. The rent remains correctly recognized in USD, but `attributes.bedrooms` and `attributes.minimumStayMonths` are both undefined. These are actual field false negatives, not the floor heuristic false alarms in #121.

Minimal anonymized reproduction:

```js
import { parseListingText } from './src/index.js';
const text = `СДАЁТСЯ ДОМ В НЯЧАНГЕ.
5 отдельные спальни / 3 санузла.
1415$ в месяц.
Аренда от 1 года.`;
const details = parseListingText(text);
console.log(details.attributes.bedrooms); // undefined; expected 5
console.log(details.attributes.minimumStayMonths); // undefined; expected 12
```

Control: replacing `5 отдельные спальни` with `5 спальни` and `1 года` with `12 месяцев` gives bedrooms 5 and minimum stay 12. Public message contacts, addresses, and identifiers are omitted from this issue.

`bedroomCount` only accepts a number directly adjacent to its label (or a narrow word-number expression); a common qualifying adjective interrupts it. `minimumStayMonths` recognizes month expressions but not an explicit year minimum.

Required fix: support bounded same-clause qualifiers between a room count and room label, convert explicit lease years into months, and add RU/EN/VI variants with negative controls for IDs, area/floor digits, unrelated footer service prices, and cross-line/cross-option borrowing. Verify both `parseListingText` and the shared normalized-offer / Telegram / search-filter paths. Preserve unknown values where the source does not actually state a count or duration.

The existing 299-case corpus has zero measured misses, but does not establish coverage of these live phrasings. Add independently reviewed cases rather than adjusting aggregate gates to hide them.

### #124: Per-floor rent variants erase explicitly shared one-bedroom layout after PR118

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/124).

Proposed implementation: Separate per-floor/contract variants with shared layout from distinct property alternatives; keep partial-floor layout unknown. Test both price orders and fees.

Full requirement context (including every comment):

# Shared one-bedroom layout is lost for per-floor rent variants

Verified on current main `5409ea0` by independent review of a real public rental post in the 90-day audit. The post states both `Квартира с 1 спальней` and `1 Спальня`, with 13M/month for the first floor and 13.5M/month for floors 2–3. These are floor variants of the same stated one-bedroom layout. The current parser selects the correct 13M rent but leaves bedrooms undefined.

Minimal anonymized reproduction:

```js
import { parseListingText } from './src/index.js';
const text = `Квартира с 1 спальней в Нячанге.
О квартире:
1 Спальня
40 м²
Балкон
Условия аренды:
Цена: 13 млн VND / месяц (первый этаж)
При аренде квартиры на 2–3 этаже: 13.5 млн VND / месяц
Депозит: 1 месяц.`;
console.log(parseListingText(text).attributes.bedrooms); // undefined; expected 1
```

`selectedRentalLayout()` introduced for #116 treats different price contexts as mixed properties when any candidate context merely mentions a property kind. The second floor clause says `квартиры`, so it trips the mixed-option branch; the selected first-price context has no immediately adjacent descriptor and loses the shared count higher in the listing.

Required fix: distinguish genuine different-property/layout alternatives from per-floor or contract/occupancy variants. Preserve explicitly shared layout facts through intervening apartment-details/lease-section lines, while retaining #116's correct unknown-bedroom behavior for an actually separate cheaper apartment versus more expensive studio. Cover selected prices in both orders, same/shared layouts, true different layouts, and monetary fee/footer contamination. No source labels or aggregate gates should be relaxed.

Important negative control from this same source: a 25M whole two-bedroom house versus an 18M first-floor-only open space does NOT justify assigning the whole-house two-bedroom count to the cheaper partial floor. That unknown is correct and should not be counted as a field false negative merely because the whole post mentions bedrooms.

### #125: Valid rental false negatives: ищущих matches request and view/description city overrides Nha Trang location

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/125).

Proposed implementation: Use Unicode word boundaries for request verbs and explicit location evidence with incidental view/travel/footer exclusions. Test classification, reconciliation and searchable offers.

Full requirement context (including every comment):

# Classifier rejects real Nha Trang rentals because incidental prose matches request/other-city tokens

Verified on main `5409ea0` by independently reviewing all eight non-offer classification exclusions in the second fully retrieved 90-day public rental source. Four were valid residential rental materials incorrectly filtered: two villa posts marked `request`, and two explicitly Nha Trang house posts marked `wrong-location`.

1. **Request false positive / rental false negative:** a six-bedroom villa advertisement says `Подходит для семей, ищущих тихое и безопасное место` (suitable for families seeking a quiet, safe place). `REQUEST` contains unbounded `ищу`, matching the beginning of `ищущих`. The advertiser is offering a rental, not requesting accommodation.
2. **Location false positive / rental false negative:** a house explicitly says `Дом с 2 спальнями на Севере Нячанга`, with a Nha Trang location section and 30M/month rent, but an amenity line `Вид на Далат` matches `OTHER_VIETNAM_CITY` anywhere in the post. Incidental view/description text overrides the actual stated property location.

Anonymized minimal reproductions:

```js
import { classifyTelegramPost } from './src/index.js';
console.log(
  classifyTelegramPost(`Сдаётся новая вилла с 6 спальнями в Нячанге.
Подходит для семей, ищущих тихое и безопасное место.
Цена: 70 млн VND / месяц.`)
);
// actual request / eligible false; expected offer / eligible true

console.log(
  classifyTelegramPost(`Сдаётся дом с 2 спальнями на Севере Нячанга.
Локация: Север Нячанга.
Вид на Далат.
Цена: 30 млн VND / месяц.`)
);
// actual wrong-location / eligible false; expected offer / eligible true
```

Required fix: word/grammatical boundaries and context-sensitive intent; prioritize explicit property location and distinguish incidental city references in views, trips, transfers and agency footers. Preserve real `Ищу квартиру` requests and genuinely located Da Nang/Dalat/Hanoi rentals as negative controls. Exercise the public classifier, reconciliation, ingestion and search paths; add independently reviewed cases rather than adjusting gates.

The existing 299-case corpus is green but does not include these live exclusion patterns. Private source text/IDs/contacts are retained locally and are not attached. A third inspected source example was correctly excluded for business-only use; that valid exclusion is not part of this defect count.

### #126: Protected audit produces undefined segment coverage and omits empty-parser offers from recall denominator

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/126).

Proposed implementation: Build ledger from offer.raw.text, validate source spans/hashes and represent absent bodies as errors. Count eligible empty/failed/OCR attempts independently from terminal dispositions.

Full requirement context (including every comment):

# Protected audit segment evidence accounts for "undefined" instead of listing text, and drops empty-parser offers from its denominator

Verified on current main `5409ea0` by running the unmodified real-credential protected audit with real clink, a fresh three-month state, and one fully collected public source.

Actual result: 3,134 messages; 232 accepted, 139 terminal parser errors, 15 excluded and 20 review materials. Real storage persisted/query/edit/delete/roundTrip checks all pass. The overall acceptance correctly remains false, but two internal evidence counters are misleading:

1. **Fake segment coverage.** Every accepted offer contributes exactly one `reviewedUnknown` segment; 232 total, zero mapped. `offerLedger()` in `experiments/telegram-live-audit-runtime.mjs` calls `createSegmentLedger(offer.text, ...)`. `normalizeOffer()` deliberately has no top-level `text`; the source body is `offer.raw.text`. `createSegmentLedger()` stringifies the missing value to the literal `undefined`, hashes it, and counts it as a fully accounted unknown segment. The real multi-line listing is absent from the evidence.
2. **False eligible-offer denominator.** `auditSource()` sets `relevantOffers = batch.offers.length + count(offer-extraction-failed)`, but omits `offer-extraction-empty`. The three-month run reports `parserOffers: 232, relevantOffers: 232` despite 139 otherwise eligible old materials returning null. It can appear to have perfect parser recall in summaries, although the terminal-error gate catches the underlying failure.

Reproduce the first issue offline with `auditTelegramBatch()` on a two-line current rental message. Assert the segment ledger accounts for the two actual source lines, not a nine-character `undefined` value. A direct `parseTelegramOffer()` result has no `offer.text` and does have `offer.raw.text`.

Required fix:

- Build ledger evidence from the actual bounded source body, verify line/hash/position provenance, and represent truly missing body text as an explicit error/unknown rather than invented text with 100% coverage.
- Count all eligible extraction attempts, including empty results, exceptions and OCR paths, in the denominator; publish excluded/review/degraded states separately.
- Add real normalized-offer contract tests and a null-parser regression; assert nontrivial multi-line mapping and eligibility accounting, not just internally consistent terminal totals.
- Keep overall failed acceptance and privacy protections intact. A green 299-case field corpus or a completed source history scan is not proof that the live semantic-segment evidence is valid.

Private raw journals and graph records are retained locally. No production fix was made during this testing pass.

### #127: Valid custom-folder audit falsely fails: dialog-filter ID is sent as getDialogs peer-folder ID

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/127).

Proposed implementation: Evaluate custom filters client-side using explicit peers and normal/archive dialogs, respecting exclusions and category flags. Never send filter ID >1 to getDialogs.

Full requirement context (including every comment):

# Valid custom Telegram folder always produces FOLDER_ID_INVALID and a false audit acceptance failure

Verified on main `5409ea0` with the actual existing authorized user session. The named accommodation folder exists, its explicit peers resolve, private dialogs are excluded, and public source discovery succeeds. Nevertheless, the protected audit reports `folder.resolutionErrors: 1` and `noFolderResolutionErrors: false`.

Independent read-only probe confirms the reason:

```text
folderFound: true
customFolder: true
client.getDialogs({ folder: filter.id, limit: 500 })
  -> FolderIdInvalidError, code 400, FOLDER_ID_INVALID
```

`resolveFolderEntities()` in `experiments/audit-telegram-accommodations.mjs` passes the custom **dialog filter** ID to the server's **peer folder** parameter. These are different concepts. Telegram's [official dialog-folder documentation](https://core.telegram.org/api/folders) states peer folders are the normal/archive categories (0/1), while UI custom folders are dialog filters with include/exclude rules. [messages.getDialogs](https://core.telegram.org/method/messages.getDialogs) documents the invalid-folder RPC error.

The catch comment acknowledges custom folders may be fully represented by includePeers but still increments a generic resolution error, so a supported/valid setup cannot satisfy the audit's strict acceptance gate.

Required fix: use explicit pinned/include peers and supported client-side dialog-filter evaluation for custom folders; apply their type/include/exclude/archive rules correctly; only pass valid peer-folder IDs to `getDialogs`. Distinguish an optional unsupported enumeration surface from a genuinely inaccessible selected public source. Keep private-user histories outside audit scope. Add tests with a real custom-folder ID >1, native 0/1 folders, include/exclude peers, and actual inaccessible-channel errors.

This warning is a tooling/API mismatch, not proof that the user supplied bad credentials or that a different test account is required. No folder membership or messages were modified during diagnosis.

### #128: Native public-history iteration aborts on a real 22-second FLOOD_WAIT instead of resuming

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/128).

Proposed implementation: Retry iterator consumption with full cancellable FLOOD_WAIT duration, bounded attempts/elapsed budget and offset continuation. Preserve catch-up phase, deduplication, checkpoints and failure traces.

Full requirement context (including every comment):

## Observed on current main

Revision `5409ea06127858be05d2a2b71159aef6427433af`, Node 24.18.0, actual authorized user session, read-only public history. No synthetic RPC response was used for the failing run.

Calling `MtcuteTelegramProvider.history(source, { since: ninetyDayCutoff })` and consuming its async iterator terminated with:

```text
RpcError (420 FLOOD_WAIT_%d): Telegram API error 420: FLOOD_WAIT_22
at messages.getHistory
at iterHistory
at src/telegram-mtcute.js:362
code: 420
seconds: 22
```

The external audit was concurrently reading other public histories, so the fact that Telegram rate-limited the account is expected. The defect is that native history does not wait the requested duration and resume the read. No independent driver credential is needed to reproduce it.

## Impact / code evidence

`MtcuteTelegramProvider.history()` iterates `client.iterHistory()` without a retry boundary around iterator consumption. `TelegramCapabilityRouter.history()` retries obtaining the iterator, but subsequent iteration errors escape that boundary. `MtcuteTelegramIngestion.start()` handles this by recording a startup failure, destroying the provider, and rethrowing before installing live updates. Checkpoints help a later restart but do not recover the current run.

This makes normal long public-history backfills vulnerable to transient rate limits and can prevent live ingestion startup. Do not mark interrupted history complete or silently omit the affected source.

## Requested fix / acceptance

- Honor the full Telegram flood-wait duration, with an explicit cancellable bounded retry policy for iterator consumption, not only iterator creation.
- Resume/checkpoint without duplicate or missing message IDs and preserve new-message catch-up semantics.
- Distinguish exhausted or excessive retry budgets from completed history; preserve diagnostic traces.
- Test actual mtcute-shaped RPC errors (`code: 420`, `seconds`, parameterized `text`) and interrupted multi-page iteration, including cancellation.
- Re-run a real public history window and compare its ID set with the independent retained raw pages.

No production code was changed. Credentials, session strings, identities, public-contact data and raw private artifacts are not included in this issue.

Comment requirement/evidence:

Independent real transport comparison completed after pausing competing history RPCs and throttling the manual consumer by 1 second per 100 messages:

- Native production provider: 3,054 distinct messages in the exact frozen 90-day window.
- Independent retained raw transport: 3,054 distinct messages.
- Missing IDs in either direction: 0.
- Different text bodies: 0.
- No external retry was needed for this throttled run; the SDK automatically honored one short 3-second wait.

This verifies pagination/normalization parity for the completed source. It does **not** invalidate the original real 22-second wait failure: the default SDK handles short waits but lets the longer wait escape, and the production adapter has no iterator-consumption retry. The successful manual consumer was deliberately throttled; production code remains unchanged.

### #129: Captionless rental poster is unparsed: production ingestion supplies no OCR, and real OCR misses its rent

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/129).

Proposed implementation: Wire bounded media OCR into historical/live/legacy ingestion, preserving media/status provenance and durable review outcomes. Use sparse Tesseract OCR or injected extractor; keep captioned albums text-only.

Full requirement context (including every comment):

## Confirmed real public rental excluded from production extraction

Current main `5409ea06127858be05d2e0f8cd6ad25854e0c419`, Node 24.18.0, existing authorized Telegram session. A read-only 90-day history replay found a captionless single-image rental advertisement. The image was downloaded from the real public source and visually reviewed locally.

The image clearly advertises a studio in central Nha Trang, 35 square meters, availability from 01/10/26, furnishings/amenities, and **13 million VND/month**. There is no caption containing this information. No provider contact was messaged.

Production `reconcileTelegramMaterials()` without OCR returns:

```json
{ "accepted": 0, "reason": "photo-only-ocr-unavailable", "state": "degraded" }
```

Supplying actual local Tesseract `eng+rus+vie` output to the same production reconciliation yields one rental offer with extracted bedroom/availability/amenity data. This is a confirmed rental-recall gap, not merely an automated photo-only alarm.

## Runtime integration gap

`MtcuteTelegramIngestion.start()` calls `reconcileTelegramMaterials(sourceMessages, { extract, targetLocation })` but does not provide an OCR function. Its live-update path similarly cannot recover text from this listing image. The older Telegram history collector is text-driven as well. Keeping raw media and a degraded review reason is useful but is not full message parsing.

## OCR quality warning

The real OCR output distorted the price line (`13 млн VND / месяц` on the visibly clear image became an unparseable line including `15 xem VND / wes`). The parser correctly left price unknown rather than inventing a cheap or incorrect amount. Enabling OCR alone is therefore not proof of accurate price extraction: retain provenance, mark low-confidence fields for review, and add visually reviewed image fixtures. Do not hard-code the mistaken OCR amount as expected rent.

In the first five completed public histories, 33 captionless materials were inspected: one visually confirmed rental, 22 with no readable OCR text, and zero download/OCR exceptions. The remaining photo-only materials must not automatically be called missed rentals.

## Requested acceptance

- Provide a bounded/cancellable production media extraction path and wire it into historical and live reconciliation.
- Persist original-media provenance, extraction status, and explicit reviewed/degraded outcomes; no silent loss or falsely complete coverage.
- Cover real captionless rental posters in reviewed precision/recall evidence, including unreadable photos, unsupported media, OCR failures and misread amounts.
- Keep textual-caption albums from unnecessarily OCRing every apartment photo.
- Verify the real captionless listing appears with correct/reviewed fields, or has a durable explicit review state until those fields are confirmed.

No production code was changed. Private image, OCR output, raw message identifiers, credentials, account identities and contact details remain local and are not attached here.

Comment requirement/evidence:

Additional local real-image quality experiment, no production change: the same visually reviewed poster has an explicit 13M/month rent. Tesseract eng+rus+vie at --psm 6 still yields unknown price; --psm 11 produces text that the unchanged native parser correctly extracts as 13,000,000 VND/month. Both classify as an offer. This suggests sparse-text segmentation can recover this particular poster, not that one configuration is validated across all photos. The original full 40-source supplement has now assessed all 2,277 captionless materials with zero download/OCR exceptions, 115 unsupported non-photo items and 26 automatic classifier/parser-positive materials. Those 26 are not all independently verified rentals, and the confirmed map false-price issue #135 remains a release blocker before OCR integration.

Comment requirement/evidence:

Final supplement completed across all 66 audited public communities: all 4,379 captionless materials assessed, zero download/OCR exceptions, 249 unsupported non-photo media items, 3,132 materials with no readable OCR text, and 57 automatic classifier/parser-positive materials (not 57 independently verified rentals). The original 40-source cohort contributes 2,277 materials; the catalog supplement contributes 2,102. A final cached replay matches these counts. The test-only reader now handles absent SDK message slots with an offline control; a closing retention probe found two earlier captioned posts no longer available, without inferring why. Production deletion-event handling already exists and is not asserted broken. Test artifacts and sanitized report are committed on main at https://github.com/konard/vietnam-accomodation-search/commit/f6e5eb5156ca19d83ebfac9488713707f85100f9 . No production implementation was changed.

### #130: Multi-listing Telegram album silently drops its second independent rental caption

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/130).

Proposed implementation: Preserve distinct caption text with member provenance; split independent rental captions, combine complementary text, deduplicate repeats and review mixed/conflicting captions. Update all consumers and edits.

Full requirement context (including every comment):

## Real 90-day public history evidence

Current main `5409ea06127858be05d2e0f8cd6ad25854e0c419`, existing authorized session, retained checksummed public history. One completed public channel contains a Telegram album with **two different rental captions describing different apartments**:

- Apartment A: central area, five guests, two bedrooms, floor 28, USD 36/day or USD 655/month, its own property code.
- Apartment B: different area, four guests, two bedrooms, USD 29/day or USD 525/month, a different property code.

Both captions independently classify as eligible rental offers. They are not duplicate captions or a continuation of one property's description.

`assembleTelegramAlbums()` retains both members, but its emitted material uses `text: texts[0] || ''`. The second caption never reaches classification or extraction. Normal reconciliation accepts one listing and does not flag this multi-listing conflict.

Consequently, counting all member message IDs as accounted can still conceal lost listing content and recall. The independent 90-day audit flags `multipleDifferentAlbumCaptions`; this live example confirms the alarm is substantive rather than a harmless repeated caption.

## Requested fix

- Preserve every distinct non-empty caption with member-level provenance.
- When one album advertises multiple independently priced properties, extract distinct listings or persist an explicit review outcome; do not silently overwrite/ignore the second offer or combine its fields into the first property.
- Keep identical repeated captions deduplicated and ordinary single-caption apartment-photo albums as one material.
- Add reviewed controls for different-property captions, complementary captions, repeated captions, edits, and mixed rental/non-rental captions.
- Make coverage evidence distinguish accounted message IDs from preserved/extracted caption content.

No production code was changed. Raw message identifiers, contact details, images and private credentials remain local; the independently reviewed descriptions above are anonymized.

### #131: Explicit property code containing an en dash is truncated to its numeric prefix

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/131).

Proposed implementation: Capture full explicitly labeled identifiers across Unicode dash variants, retaining original text and excluding contacts.

Full requirement context (including every comment):

## Confirmed field extraction error

Current main `5409ea06127858be05d2e0f8cd6ad25854e0c419`; independently reduced from a real public rental caption in the uncapped 90-day audit.

```js
parseListingText(
  'Квартира в Нячанге. Аренда 655 USD/месяц.\nКод объекта: 414–75414.'
).attributes.propertyId;
// actual: '414'
// expected: full code '414–75414' (normalizing its en dash to '-' is acceptable)
```

The full source code is explicitly printed in the advertisement. A code truncated to its numeric prefix identifies neither the original source reference nor necessarily a unique property. This is a confirmed field false negative for the full code and a false positive for the shortened reference, not an unknown field.

## Requested acceptance

- Capture the whole explicitly labelled property identifier, including common Unicode hyphen/dash variants and permitted letters/digits.
- Preserve original source provenance; if normalizing punctuation, retain a consistent canonical identifier without truncation.
- Test ASCII hyphens, en/em/non-breaking dashes, adjacent punctuation, and code-like phone/contact distractors.
- Revalidate reviewed live property references; do not infer additional characters absent from the source.

No production code was changed. The minimal example contains no credentials, session strings, numeric account identity, source username or contact information.

### #132: Mathematical-bold Unicode rent becomes unknown in six real apartment listings

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/132).

Proposed implementation: Normalize lexical text with NFKC for parsing, keep original contacts/URLs/IDs/text and map normalized UTF-16 spans to original evidence. Test fees, styled terms and variants.

Full requirement context (including every comment):

## Six independently reviewed live rent false negatives

Current main `5409ea06127858be05d2e0f8cd6ad25854e0c419`, existing authorized session, complete 90-day public-channel history. Six accepted apartment captions display rent using mathematical bold Unicode digits and letters. The rental amounts are legible but every corresponding `parseTelegramOffer()` price is null.

Minimal reproduction:

```js
const text = 'For rent: 1 bedroom apartment in Nha Trang.\n𝟏𝟖𝐦𝐢𝐥𝐥𝐢𝐨𝐧 𝐕𝐍𝐃/𝐦𝐨𝐧𝐭𝐡';
parseTelegramOffer({ text, date: now }, { now }).priceVnd; // null
// Identical plain-ASCII rent text returns 18000000.
```

The reviewed native monthly values in the six captions are 18M, 16M, 9M, 11M, 27M, and a 14M/15M contract-dependent pair. Fee lines use ordinary characters and must not become substitutes for missing rent. The amount is explicit source text, not inferred from unrelated fees.

## Requested fix / controls

- Match equivalent compatibility-styled digits, amount words, currencies and periods on a normalized lexical representation.
- Preserve original text, contact/URL/identity strings and segment provenance; normalization can change UTF-16 offsets and must not silently invalidate evidence spans.
- Test styled/plain-equivalent rent, styled contract duration, additive surcharges and management/internet fee distractors.
- Retain native currency/period and contract option association; do not guess a fee as rent or collapse independent variants.

No production code was changed. These anonymized examples contain no authentication material or public contact details.

### #133: Ordinal floor is lost and next-line bedroom count is invented as floor

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/133).

Proposed implementation: Recognize ordinal floors and restrict binding to the same clause; scope floor to the chosen property. Test unit/count/area distractors.

Full requirement context (including every comment):

## Confirmed floor false positive and false negative

Current main `5409ea06127858be05d2e0f8cd6ad25854e0c419`. Independently reduced from a real apartment caption in a completed public 90-day history:

```js
parseListingText(`For rent: 3-bedroom apartment in Nha Trang.
Unit 1702 is on 17th floor
3 bedrooms 2 bathrooms`).attributes.floor;
// actual: 3
// expected: 17
```

The source explicitly states floor 17. The regex does not recognize `17th floor`; its forward `floor\s{0,8}...digits` alternative crosses the newline and consumes the next line's bedroom count. This is not an uncertain source or a qualitative-floor warning: it invents a wrong numeric floor.

Other reviewed captions state the 20th, 45th, 6th, and 15th floors, which are left unknown, including a styled 15th-floor phrase. Handle lexical Unicode normalization separately from field binding.

## Requested acceptance

- Recognize common English ordinal floor expressions, including the `st`, `nd`, `rd`, and `th` suffixes.
- Do not bind a floor label backward/forward across an unrelated new line or property/room count.
- Test valid ordinal floors, explicit labelled floors, bedroom/bathroom/unit-number distractors, multi-option listings, and qualitative high floors.
- Preserve source evidence and choose the floor belonging to the selected property rather than another option.

No production code was changed. The minimal synthetic reference is anonymized and contains no credentials or personal contact details.

### #134: Explicit English named-month and ISO availability dates remain unknown

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/134).

Proposed implementation: Recognize ISO and English month/ordinal availability anchored to explicit labels; document reference-year and rollover handling, validate dates and keep contradictory ranges unknown.

Full requirement context (including every comment):

## Confirmed explicit availability date extraction gap

Current main `5409ea06127858be05d2e0f8cd6ad25854e0c419`. Real accepted apartment captions in a completed public 90-day history include `Available on 9th October`, `Available on 8th November`, and `Available on 21st October`. None produces `attributes.availableFrom`.

Minimal deterministic control with a known publication/reference year:

```js
const now = new Date('2026-10-07T00:00:00Z');
parseTelegramOffer(
  {
    date: now,
    text: 'For rent: apartment in Nha Trang, 9 million VND/month. Available on 9th October.',
  },
  { now }
).attributes.availableFrom;
// actual: undefined
// expected: '2026-10-09'
```

The equivalent explicit numeric day/month/year spelling is supported. `isoDate()` currently recognizes only numeric day-first forms; ordinary English month names/ordinal days are not parsed. ISO `Available from 2026-10-09` is also left unknown and should have a control.

## Requested acceptance

- Parse common English named-month dates and explicit ISO forms as availability fields with source provenance.
- Use an explicit reference date for omitted years, with documented rollover/ambiguity handling; do not silently guess around contradictory ranges.
- Cover `Available on/from`, ordinal suffixes, abbreviated/full month names, year boundaries and dates in unrelated contact/contract lines.
- Keep contradictory source ranges unknown or reviewed. One live caption says November through January 2026 in an inconsistent range; that case is intentionally not counted as a confirmed exact-date false negative.

No production code was changed. Source identifiers, contact details, identities and private credentials are excluded.

### #135: Real OCR map travel time becomes accepted 19 EUR/month rent with no review

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/135).

Proposed implementation: Reject route/time/distance/unit currency artifacts; require explicit rental evidence for OCR prices and durable review for unverified OCR. Test map/receipt/UI negatives and posters.

Full requirement context (including every comment):

## Real image, actual OCR, unmodified protected batch

Current production revision `5409ea06127858be05d2e0f8cd6ad25854e0c419`; existing authorized session, retained checksummed public history. A captionless two-image album published September 28 contains a navigation-map screenshot showing a villa destination and **19 minutes / 9.3 km**. The original image was downloaded and visually reviewed locally. It contains no EUR rent.

Actual local Tesseract `eng+rus+vie` output misreads the transport icon before the duration as a euro symbol, producing a line like:

```text
Sample Villa
€ 19 phút - 9,3 km
```

Supplying those actual image OCR fragments to the unchanged `auditTelegramBatch()` with the real current frozen date yields:

```json
{
  "accepted": 1,
  "price": { "amount": 19, "currency": "EUR", "period": "month" },
  "reviewQueue": []
}
```

The historical-publication-date replay gives the same result. Both actual images are within the reconciler's default three-photo OCR limit. No mock RPC or invented OCR text was used for the live evidence. The shortened text above is an anonymized deterministic reducer.

## Impact and scope

This is a confirmed **price false positive**: map travel duration becomes a falsely cheap monthly apartment rent. Villa-name property evidence plus an OCR currency glyph is enough for the classifier to label the material an offer. Context might explain why a property channel shared a navigation map; it cannot make 19 minutes a valid 19 EUR monthly rent.

The protected live audit has an OCR path and accepts this false price without a review reason. Native production ingestion currently supplies no OCR (#129), so this issue does not claim that its current no-OCR path already displays the map as rent. It must be fixed/tested before enabling that planned extraction path, and before treating OCR accepted counts as reviewed recall.

## Requested acceptance

- Require field-specific rental-price evidence and reject currency-like OCR glyphs bound to route duration/distance or other non-price units.
- Keep low-confidence OCR/currency evidence unknown or reviewed; retain original-image provenance rather than treating OCR strings as ground truth.
- Add visually reviewed map/receipt/phone/UI negative controls and genuine rent-poster positives, including OCR misread currencies/amounts.
- Ensure no accepted rental has 19 EUR/month from the map travel-time line; a durable review outcome or unknown price is preferable to a fabricated amount.
- Keep semantic/manual review separate from automated OCR-positive counters in acceptance reports.

No production code was changed. Private image, exact coordinates, contact/source/message identifiers, account identities and credentials are not attached.

### #136: Nine real vehicle sales, rentals and requests are accepted as monthly accommodation offers

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/136).

Proposed implementation: Require housing context, expand sale/request verbs and exclude non-housing rentals without excluding housing with incidental vehicle amenities. Revalidate stored/searchable results.

Full requirement context (including every comment):

## Nine manually reviewed current false-positive accommodation listings

Current main `5409ea06127858be05d2e0f8cd6ad25854e0c419`, actual user credentials, complete 90-day public mixed-group history. A risk-targeted review of ten accepted posts mentioning vehicle/goods terms found **nine non-housing posts and one legitimate studio listing**. These are not random-sample precision estimates; all nine false positives are independently readable full captions and were published September 2–26, inside the actual production two-month gate.

The nine are motorcycle sales, installment purchase, motorcycle rentals, and one motorcycle-seeking request. All nine currently return `classifyTelegramPost(...).eligible === true` and actual `parseTelegramOffer()` accommodation offers. Six have vehicle purchase/rental amounts treated as monthly accommodation rent, including 10M, 15M, 15.5M, 42M and a 1,150–6,500 VND tariff range. The other three have unknown prices but still become accommodation offers. One motorcycle-sale caption is even tagged `kind: house`, despite advertising only a vehicle.

Minimal independently reduced examples:

```text
Сдам байк в аренду 50сс. 2.5 млн VND/месяц.
```

```text
Продаю Honda SCR. Байк не сдавался в аренду. Цена 10 млн VND.
```

```text
Хочу взять мотоцикл в аренду в Нячанге. Знает кто, где можно?
```

All are incorrectly classified as eligible rental offers. The second becomes 10M VND/month in `parseTelegramOffer()`, despite a sale price and negated prior rental history.

## Cause / requested acceptance

`classifyTelegramPost()` accepts `RENTAL.test(text)` without requiring accommodation context. Its sale pattern also misses `Продаю`; rental-negation/history and vehicle-seeking context do not protect the eligibility branch. Generic word fragments in kind detection can further manufacture a housing type; an inferred kind is not proof of a housing rental.

- Require actual accommodation rental intent, or explicitly persist a reviewed/unknown result when context is insufficient.
- Keep vehicle rentals/sales/installments/requests and other non-housing goods out of accommodation results.
- Recognize sale and seeking variants, negated rental claims, and references to past rental use without turning them into offers.
- Do not simply exclude any text containing `байк`/`motorbike`: the tenth reviewed post is a genuine studio rental saying the center is ten minutes away by motorbike and must remain eligible.
- Add reviewed mixed-public-group positives/negatives, not only property-channel happy paths, and verify final stored/searchable offer kinds and native prices.
- Re-evaluate automated eligible/accepted counters: those counts can currently include non-housing false positives and are not human-reviewed recall.

No production code was changed. Source usernames, message/account identifiers, contacts and credentials remain private; examples above are anonymized.

### #137: Public Telegram seed resolves to a User; public ingestion lacks a peer-type history guard

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/137).

Proposed implementation: Disable stale phuquoc_rental seed with reason; validate declared public community type and username before history/media requests while keeping explicit private capabilities separate.

Full requirement context (including every comment):

## Actual public-catalog preflight

Current production revision `5409ea06127858be05d2e0f8cd6ad25854e0c419`, existing real authorized session. Cross-checking all configured Telegram seeds against the completed retained-history cohort found 27 additional configured handles. Actual read-only `getEntity()` checks resolve 26 as public `Channel` communities; **`telegram:phuquoc_rental` resolves as `User`, not a channel/group**.

The seed is declared in `DEFAULT_TELEGRAM_SOURCES` with `type: telegram` and `access: public-preview`. It is not disabled. The audit deliberately **did not request this user's history**, join a private community or send a message. No private conversations were read for this finding.

## Confirmed metadata defect and code-derived routing risk

The configured supposedly public-history seed points to a user peer. In `MtcuteTelegramProvider.history()`, `resolvePeer(peer, true)` is followed by `client.iterHistory(peer)` without validating that a declared public source resolved as a public community. The public ingestion startup loop delegates its selected sources to that history method without a corresponding public-peer gate.

Generic native history can legitimately support explicitly authorized private capabilities. But a catalog entry labelled public-preview must not cause implicit private-user-dialog retrieval. If the account has a conversation with the resolved user, feeding this seed to public-source ingestion could traverse that dialog and treat its messages as public accommodation input. This is a code-derived risk, **not a claim that an actual private-data leak was observed**. Even with no existing dialog, the stale seed is not a working public accommodation source and should not consume source coverage/budget as one.

## Requested acceptance

- Verify/disable or replace this stale public-community seed using actual current metadata, with a clear unavailable/non-community status.
- Validate declared public sources at the ingestion boundary before requesting history; distinguish public channels/groups, private groups, and users.
- Keep any deliberately authorized private-history feature explicit and separate; do not globally break generic user history or silently join communities.
- Test a public-labelled source resolving to `User`, a basic/private group, renamed/unavailable handle, and a valid public channel/group, without reading actual third-party private histories.
- Reconcile audit source coverage against the configured catalog/registry; a successful 40-source retained cohort was not coverage of all configured seeds. The 26 additional valid public communities are now being collected across the same uncapped 90-day window in a separate supplement.

No production code was changed. Only the already-published catalog ID and peer class are included; no numeric account ID, phone, profile, credentials, session strings or private message content is attached.

Comment requirement/evidence:

Additional read-only verification: installed @mtcute/core resolvePeer(client, peerId, force = false) confirms that the third argument true forces fresh resolution; it is not a public-community filter. Telegram messages.getHistory accepts generic InputPeer (including inputPeerUser): https://core.telegram.org/method/messages.getHistory and https://core.telegram.org/type/InputPeer . This supports the code-derived boundary-risk description, not an observed private-history leak. The test-only collectors now reject a User before any history or media request; an offline mock verifies zero such history calls. No third-party private history was read.

### #138: Binary-storage preflight accepts an incompatible clink executable and fails only during writes

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/138).

Proposed implementation: Run a tiny isolated clink import/export compatibility probe before canonical writes; reject missing/incompatible executables actionably, support overrides and compatible future versions.

Full requirement context (including every comment):

## Real local revalidation

Tested production revision 5409ea06127858be05d2e0f8cd6ad25854e0c419, supported Node 24.18.0. This machine has two actual executables named clink: the pinned Rust 0.2.11 implementation and an older independently installed .NET 2.2.2 CLI. A fresh clean-clone suite accidentally put the .NET command first on PATH: 1,193 tests passed, four actual binary-storage tests failed on missing exported verified.lino files or invalid expected normalization. This run is an incompatible dependency/setup failure, not a regression caused by the new audit files.

A separate direct real-process check confirms LinkCliMirror.preflight() accepts both binaries. Its implementation only executes --help and checks exit status. The incompatible command has a different CLI contract and is not the supported Rust binary; accepting it is a preflight false positive. Storage fails later with ENOENT, obscuring the actual operator configuration problem.

## Requested fix and acceptance

- Verify the selected executable has the supported command/capability contract before actual application storage writes (version/implementation check and/or a small isolated import/export probe).
- Reject an incompatible same-name executable with an actionable dependency/version diagnostic, without exposing data or touching canonical application state.
- Preserve deliberately configured compatible command paths and supported future versions; do not assume that any executable named clink with successful --help is compatible.
- Test an incompatible help-success executable, a missing executable, the actual supported Rust 0.2.11 binary, and an explicit command override.

The suite is being rerun with the verified Rust binary first on PATH. Existing clean Git Node/Bun runs and sequential coverage with that real binary already passed. No production code was changed; this issue reports the confirmed preflight validation gap separately from the setup error.

### #139: Actual Windows Node CI times out in command-stream literal-argument check

Source: [issue and comments](https://github.com/konard/vietnam-accomodation-search/issues/139).

Proposed implementation: Inspect failed Windows logs and command-stream implementation; preserve literal argv assertion with bounded subprocess cancellation and diagnostics. Verify actual Windows CI without raising timeout.

Full requirement context (including every comment):

## Observed on pushed test-only checkpoint

Actual Actions run https://github.com/konard/vietnam-accomodation-search/actions/runs/37539841580 at 066394607942dfe43f166eb2cef07bfd8d639c1d fails Test (node on windows-latest). Production code remains identical to 5409ea06127858be05d2e0f8cd6ad25854e0c419.

The test `version-and-commit.mjs passes the commit message as one argument` / `keeps quotes, backslashes, and substitutions literal` exceeds the 30,000ms per-test timeout (30,002.8774ms). It is in tests/version-and-commit.test.js and calls loadCommandStream(), then the real command-stream printf literal-argument round trip. The suite reports one cancelled test and exits 1, finishing in 91s of its 300s overall budget. This is distinct from the missing release credentials in #122. It is not evidence that shell injection occurred or that commit text was corrupted: the assertion never completed.

Node on macOS/Linux, Bun on all three OSes, Deno matrix jobs and required real clink integration passed in this run. The same complete suite passed locally on macOS with supported Node 24.18.0 and real Rust clink 0.2.11, 1,197/1,197, zero explicit skips.

## Requested investigation / acceptance

- Reproduce or instrument the Windows Node command-stream import, subprocess startup, stream completion and cleanup boundaries to find the stall; do not merely raise the timeout or remove the literal-argument safety assertion.
- Ensure hung child processes have a bounded cancellation path and useful diagnostics.
- Rerun the actual Windows Node job, ideally repeated, and distinguish environmental timing/flakiness from a Windows runtime/shell compatibility defect.
- Preserve verification that quoting, backslashes and substitutions remain literal.

Only the observed timeout is confirmed; its precise root cause is not established by this local macOS audit. No production code was changed.
