# Requirements, research, and acceptance for issue 117

Scope: [parent #117](https://github.com/konard/vietnam-accomodation-search/issues/117), all six sub-issues, and [PR #118](https://github.com/konard/vietnam-accomodation-search/pull/118). All issue comments, PR conversation comments, inline review comments, and reviews were read; they were empty at initial inspection. The reported release baseline is `e220d9f4e2359dcb8f69329a02cf68c6688f9966`, previously validated in PR #110. This checkout also includes main's subsequent credentialed-revalidation record, `a5441d21a22801bfd1d2a2b71159aef6427433af`.

## Complete requirement inventory and solution choices

### Parent issue

1. Read every listed issue and all its comments: done.
2. Address all six issues in one PR: all implementation and investigation is in #118; operator-controlled acceptance remains explicitly blocked below.
3. Close the parent and each child with a separate closing keyword: preserve the parent-provided block in the PR description, with the unresolved publishing acceptance prominently disclosed.
4. Use full closing syntax separately for each issue: `Fixes #111` through `Fixes #116`, and `Fixes #117`.
5. Explicitly identify already-resolved or unreproducible issues: none of the reported defects was already resolved; all five code defects were reproduced. The absent publishing configuration was independently confirmed.

### #111: invalid protected-audit checkpoint collection

| Requirement                                           | Solution and evidence                                                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use a valid collection name                           | Replace all three reader/writer uses with `audit-cohorts`.                                                                                                                                                                       |
| Apply the name consistently to new audits and resumes | Check the actual runner's read and both write sites against actual `LinksStore`, including reloading from a fresh instance.                                                                                                      |
| Consider migration only if real legacy data exists    | No migration: the unchanged store rejects `audit-cohort` before writing, so the original runner could not create that collection. No legacy cohort is present in this checkout. Existing valid `audit-cohorts` data is retained. |
| Preserve independent storage validation               | Leave `validKind` unchanged and assert that singular `audit-cohort` remains invalid.                                                                                                                                             |
| Add an integration regression with real storage       | New cohort test uses actual `LinksStore`; existing completed-source resume regression now persists its checkpoint with actual storage and reloads it from another instance.                                                      |
| Verify a live source chunk                            | Blocked: no Telegram bot/API/user-session credentials are available in this checkout or its environment.                                                                                                                         |
| Verify resume on a retained store                     | Offline completed-source resume runs with a real retained store and fails if it fetches or projects again. Live retained-store acceptance remains blocked by the same credentials.                                               |

Alternatives considered: weakening `validKind`, adding a singular-name alias, or migrating an assumed legacy file. The consistent plural name fixes the caller while keeping the existing storage contract intact.

### #112: additive charges selected as rent

| Requirement                                                  | Solution and evidence                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproduce the exact 7.8M/6.8M/+500k message                  | A failing Telegram-parser regression records the original behavior before implementation.                                                            |
| Exclude a conditional surcharge from standalone rent options | Recognize additive signs and surcharge labels during candidate classification.                                                                       |
| Keep the existing minimum-option policy                      | Select 6.8M with a 6.8M–7.8M range; recognize occupancy-specific prices as actual rent options.                                                      |
| Handle Russian additive/extra charges                        | Cover `надбавка`, `доплата`, and signed amounts.                                                                                                     |
| Handle English additive/extra charges                        | Cover `surcharge`, `extra rent`, suffix `extra`, and `plus`.                                                                                         |
| Handle Vietnamese additive/extra charges                     | Cover `phụ thu`, `trả thêm`, and `cộng thêm`.                                                                                                        |
| Preserve legitimate low shared-room rents                    | Explicit 500k RU/EN/VI rents remain valid. No new price floor is imposed.                                                                            |
| Verify cheapest-first effects                                | A genuine 800k shared room sorts before the 6.8M apartment.                                                                                          |
| Verify low maximum-price subscriptions                       | Exercise actual `PresetService`, `SubscriptionScheduler`, and `SearchService`; the surcharge listing is excluded while the shared room is delivered. |
| Apply through the shared parser                              | `parsePrice`, normalized web listings, Telegram ingestion, search, and subscriptions all consume the same candidate rules.                           |

Alternatives considered: increasing the minimum valid rent, computing term-dependent totals, or splitting every contract option into offers. Price floors would reject genuine rooms; totals/splitting require a larger data-model change. Candidate classification addresses the reported bug without changing identifiers or the minimum-option policy.

### #113: Bun independently loads the checkout's dotenv file

| Requirement                                                  | Solution and evidence                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Isolate the subprocess despite a cleared environment         | Run both environment-token and file-token checks, and the missing-token check, with `cwd` set to the test's existing temporary directory.                                                              |
| Do not rely on the parent's `--no-env-file` reaching a child | The child has an isolated working directory; no propagation assumption is made.                                                                                                                        |
| Add a synthetic `.env` regression                            | Run the existing fingerprint test from a temporary checkout directory containing a synthetic bot token. The nested Bun parent uses `--no-env-file`; the original test fails and the fixed test passes. |
| Keep real user credential files in place                     | No real `.env` is read, modified, moved, or deleted.                                                                                                                                                   |
| Preserve Node/Bun/Deno behavior                              | Use standard subprocess `cwd`; Deno retains the existing read-only/no-subprocess boundary.                                                                                                             |
| Check other occurrences                                      | Inventory subprocess tests and inspect cleared-environment assertions; both fingerprint subprocess sites are corrected.                                                                                |

Alternatives considered: a Bun-specific child flag, changing global Bun dotenv policy, or deleting credentials for tests. The standard `cwd` option is supported across subprocess-capable runtimes and limits the change to this test.

### #114: actual publishing acceptance

| Requirement                                                                     | Finding and plan                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configure actual npm bootstrap authentication                                   | `NPM_TOKEN` is absent. A token owned by an authorized npm publisher must be supplied through repository secrets; there is no token available to install here.                                                                                                        |
| Configure required native image publication                                     | `DOCKERHUB_IMAGE`, `DOCKERHUB_USERNAME`, and `DOCKERHUB_TOKEN` are absent. The owner must provide the intended image namespace/account and a token with write permission.                                                                                            |
| Pass Release Preflight on the release commit                                    | Preserve the existing real write/authentication probes. Local release-mode preflight exits 1: 0 verified, 2 failed, 1 unknown. The OIDC unknown is expected outside Actions. PR report-mode success does not establish release readiness.                            |
| Verify a real npm release                                                       | Not met: the package is not published and no publishing credential is available. Use the existing workflow after configuration; verify registry version/integrity and a clean installed CLI.                                                                         |
| Verify a real GitHub release                                                    | Not met: `gh release list` is empty. The release workflow must publish the versioned release with the tested commit identity.                                                                                                                                        |
| Verify linux/amd64 and linux/arm64 images                                       | Not met: registry configuration is missing. Verify the manifest and both platform digests through existing release identity checks after publication.                                                                                                                |
| Do not skip executable Telegram tests because separate test accounts are absent | No separate-account requirement was introduced. Existing local-credential harness supports the owner's bot/user; neither credential is available in this workspace. The prior PR #110 results are historical evidence, not a current execution.                      |
| Do not claim bot token rotation without evidence                                | Rotation is not verified; no token was supplied or rotated.                                                                                                                                                                                                          |
| Do not treat code-only closing references as acceptance                         | Publishing acceptance is explicitly **unmet**. The parent's required closing-reference block conflicts with #114's request to remain open until release acceptance. PR #118 discloses this conflict; closing syntax must not be interpreted as a successful release. |

The exact main run [37394041592](https://github.com/konard/vietnam-accomodation-search/actions/runs/37394041592) was created at `2026-10-06T00:26:45Z` for baseline SHA `e220d9f4e2359dcb8f69329a02cf68c6688f9966`. Downloaded `ci-logs/release-main-37394041592.log` confirms npm bootstrap failure at line 151, required native-image configuration failure at line 153, and the 0-verified/2-failed verdict at line 155. This is an external configuration blocker; changing the code to report success would remove an existing release safeguard.

Execution plan when actual credentials exist: configure repository `NPM_TOKEN` and `DOCKERHUB_TOKEN` secrets plus `DOCKERHUB_IMAGE`/`DOCKERHUB_USERNAME` variables; bootstrap npm publication through the existing workflow; configure npm trusted publishing for `.github/workflows/release.yml`; rerun release preflight on the exact release commit; inspect the real npm/GitHub/OCI artifacts and install the published package. Continue using the PR workflow instead of pushing directly to main. No release, default-branch merge, fabricated secret, or replacement credential is created by this PR.

### #115: native member-count fallback

| Requirement                                                | Solution and evidence                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retain inexpensive basic metadata when a count exists      | Return `membersCount` or compatible `participantsCount` immediately, including zero.                                                                                                                                                           |
| Retrieve full metadata when basic count is absent          | Use installed mtcute's `getFullChat` and read its count.                                                                                                                                                                                       |
| Return explicit unknown only when count cannot be obtained | Return `members: null` if full metadata has no count or cannot be fetched.                                                                                                                                                                     |
| Cover basic absence plus full availability                 | Assert null/basic to 678/full fallback and compatible count fields.                                                                                                                                                                            |
| Cover failure/unknown/zero behavior                        | Assert basic zero, both count fields, empty full metadata, and failed full retrieval.                                                                                                                                                          |
| Verify source ranking/discovery                            | Enrich missing public-peer counts before discovery ranking, deduplicate full requests within one discovery run, and assert a recovered 678-member source ranks ahead of a 42-member source. Private users remain outside community processing. |
| Run a credentialed smoke check                             | Blocked by absent Telegram credentials. The previously observed 678 is a synthetic regression expectation, not a live count claim.                                                                                                             |

Alternatives considered: always requesting full metadata, using the basic count alone, or adding a second Telegram SDK. A conditional fallback uses the installed SDK, keeps its fast path, and makes the recovered metadata available to discovery as well as direct popularity calls.

### #116: layout borrowed from another price option

| Requirement                                              | Solution and evidence                                                                                                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Associate kind/bedrooms with the selected price          | Retain rental candidate clause context; detect distinct property options and read their local layout, including an immediately preceding descriptor.                                                                 |
| Preserve unknown bedrooms for the cheaper unnamed layout | The 12M apartment has no bedroom count; the 15M studio marker is excluded.                                                                                                                                           |
| Avoid fabricating an offer from two options              | Shared normalization and direct listing parsing use the selected option's layout. An explicitly supplied price selects its matching option; an unmatched price preserves unknown.                                    |
| Keep single-option studios                               | Retain zero bedrooms.                                                                                                                                                                                                |
| Keep explicit 1BR/2BR semantics                          | Cover both price orders, a cheaper studio versus 2BR, and a descriptor on a separate line.                                                                                                                           |
| Handle inline and differently labelled options           | Comma-separated options and alternatives without a rent label remain distinct layouts. Preserve the rent parser's labelled-price preference when selecting layout.                                                   |
| Match supplied price identity                            | Currency and period must match as well as amount; mismatches preserve unknown layout.                                                                                                                                |
| Keep shared layout for contract-price variants           | A 2BR property with two contract rents stays 2BR. Duplicate web price text stays one property.                                                                                                                       |
| Resolve tied options conservatively                      | Conflicting bedroom counts at the same minimum rent remain unknown.                                                                                                                                                  |
| Add exact reviewed-corpus regression                     | Assert no miss for `tg-arendaotshahnoza-006`, independently of the aggregate gate.                                                                                                                                   |
| Verify affected filters                                  | Zero-bedroom plus 13M maximum search/subscription filters no longer match the invented cheap studio.                                                                                                                 |
| Apply throughout the codebase                            | Both `parseListingText` and `normalizeOffer` use the same option selection; Telegram parsing, browser normalization, filters, and subscriptions inherit it. Public declarations include the optional selected price. |

Alternatives considered: splitting posts into separately identifiable offers, discarding every bedroom in multi-price listings, or keeping whole-post extraction. Splitting changes persistent identities and deduplication; blanket removal loses valid shared contract layouts. Local option association preserves the existing one-post offer model while leaving unstated values unknown.

## Online research and existing components

Primary sources were checked during implementation:

- [Bun environment-variable documentation](https://bun.sh/docs/runtime/environment-variables) explains automatic `.env` loading and the per-invocation `--no-env-file` flag. [Node subprocess documentation](https://nodejs.org/api/child_process.html) provides `cwd` and `env` as separate controls. This supports isolating the child working directory even when its environment is cleared.
- [mtcute Chat documentation](https://ref.mtcute.dev/classes/_mtcute_node.index.Chat) explicitly recommends `getFullChat` when `membersCount` is unavailable. The installed `@mtcute/core` declarations confirm full metadata supplies this property. No SDK replacement or version change is needed. [Official session conversion](https://mtcute.dev/guide/advanced/session-convert) supports the existing local credential workflow if a retained GramJS session is supplied.
- [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) explains OIDC repository/workflow configuration. [Docker Hub GitHub Actions documentation](https://docs.docker.com/build/ci/github-actions/push-multi-registries/) provides authenticated publication using the existing Docker actions. These components already exist in the repository; neither service can infer or create the owner's absent credentials.
- [Microsoft Recognizers-Text](https://github.com/microsoft/Recognizers-Text) provides JavaScript/TypeScript currency recognition. Its documented language coverage does not provide this application's combined RU/EN/VI rent-option semantics. It extracts entities rather than associating a selected price with a property's bedrooms.
- [Duckling](https://github.com/facebook/duckling) provides money/duration entities and composable language rules, but requires Haskell integration or a service and custom domain rules for rent versus surcharge and rental-option association. Neither entity library alone fixes these defects. Extending the existing shared, deterministic candidate parser avoids another runtime/service and keeps reviewed multilingual behavior testable.
- Existing `LinksStore`, indexed checkpoints, `test-anywhere`, Changesets, Telegram metadata APIs, and release identity/preflight scripts are reused. Collection naming is a local `LinksStore` contract, rather than an upstream Links Notation limitation.

## Validation

Before implementation, the new Node regression suite had 23 failures out of 32 checks; the synthetic credential fixture independently failed under Bun. Logs are retained in ignored `ci-logs/`.

The complete 299-case reviewed corpus now has zero misses: all evaluated fields have precision and recall 1.0, including 208 correct bedroom cases and 21 explicit unavailable cases. Corpus labels and aggregate thresholds were not changed.

Local validation uses Node 26.10.0, Bun 1.4.2, and Deno 2.9.6. Node passes all 1,197 tests with **100% product line coverage**. Bun passes all 1,197 tests. Both full suites use the actual `clink` 0.2.11 binary with `REQUIRE_REAL_CLINK=1`. Deno passes all 1,092 checks within its existing read-only boundary. `npm run check`, full ESLint with zero allowed warnings, the tracked-file size check, and changeset frontmatter validation pass. Current-head CI results are recorded in PR #118 after its runs finish.

Run Deno separately from Bun/Node in this shared checkout: `nodeModulesDir: auto` regenerates the dependency layout, and concurrent Bun resolution produced an ESLint `find-up` error. Restoring the npm installation and serializing Deno eliminated that local execution interference. Source edits during an earlier coverage run also made that run unsuitable as final evidence; the final stable-source run passes the unchanged 100% gate.

Live Telegram source-chunk/resume, native popularity smoke, token rotation, and real publishing remain unverified for the documented credential reasons. PR report-mode preflight success must not be reported as release-mode acceptance.
