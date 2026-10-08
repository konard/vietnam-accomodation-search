# Issue 153: requirements, research, implementation, and acceptance

This single [PR 154](https://github.com/konard/vietnam-accomodation-search/pull/154)
addresses aggregate [issue 153](https://github.com/konard/vietnam-accomodation-search/issues/153).
Every child issue and comment was read on 2026-10-08. Code fixes and acceptance
evidence are distinct: publishing and the protected full-cohort audit remain
unverified in this workspace. The required aggregate closing references are not
evidence that either operational gate passed.

## Complete requirement and solution matrix

Each row identifies a requirement, possible solutions, the selected plan, and
its verification or remaining prerequisite. Requirements from later comments
take precedence over superseded initial measurements.

| ID     | Requirement                                                                                    | Possible solutions and selected plan                                                                                                                    | Result / evidence                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 153.1  | Read all five issues and all comments.                                                         | Retrieve issue bodies and paginated comments, including the successive independent retests.                                                             | Completed; findings below distinguish storage-only acceptance from the full audit.                                                                                         |
| 153.2  | Implement the requested work in one PR.                                                        | Update the prepared branch and existing PR; preserve forward-moving commits.                                                                            | PR 154 contains the code, tests, CI changes, and this report.                                                                                                              |
| 153.3  | Include a separate closing keyword for 153 and every child.                                    | Use six separate `Fixes` lines in the PR description.                                                                                                   | Required block retained; unresolved acceptance is explicitly disclosed.                                                                                                    |
| 153.4  | State explicitly when a problem is already resolved or not reproducible.                       | Reproduce new defects and consult the latest original-data retests before changing existing optimizations.                                              | The original storage bottleneck has a passing prior retest; full-cohort acceptance remains open.                                                                           |
| 122.1  | Verify current release failure, rather than cite only historical failures.                     | Inspect current main SHA, run timestamps, repository configuration, and real release-mode preflight.                                                    | Main run 37692842006 and local release-mode probe still reject missing prerequisites.                                                                                      |
| 122.2  | Obtain authorized npm bootstrap credentials for the absent package.                            | First publish with an owner-authorized token; then register npm OIDC trusted publishing.                                                                | No npm credential is present here; no package publication is claimed.                                                                                                      |
| 122.3  | Configure Docker Hub image, username, and publishing token.                                    | Use the existing repository-variable and secret contracts. Do not invent registry settings.                                                             | Repository variable and secret listings are empty.                                                                                                                         |
| 122.4  | Test the exact release commit with real preflight.                                             | Use the existing release preflight and immutable release-identity collector.                                                                            | Local probe fails honestly; an actual release commit cannot be verified before publication.                                                                                |
| 122.5  | Publish npm, GitHub release, and OCI artifacts.                                                | Existing Changesets and release workflow already implement publication. Configure prerequisites and execute the existing path.                          | GitHub release list is empty; publication acceptance remains unmet.                                                                                                        |
| 122.6  | Verify native amd64 and arm64 manifests and immutable digests.                                 | Existing native publishing matrix and release-identity checks; add native PR build/provider checks for earlier compatibility feedback.                  | PR native builds verify compatibility, not published manifests. Registry digest evidence remains unavailable.                                                              |
| 122.7  | Clean-install and verify the actual published package.                                         | Existing registry smoke and provenance checks against an immutable published version.                                                                   | Checkout installs and local images cannot substitute for this still-unavailable evidence.                                                                                  |
| 122.8  | Keep acceptance visibly open; do not replace authentication/write probes with report success.  | Retain the failing release preflight and document the aggregate closing-reference conflict explicitly.                                                  | No preflight bypass, report-mode substitution, credential change, or direct default-branch merge.                                                                          |
| 122.9  | Do not require a separate Telegram account or assert unverified token rotation.                | Separate publishing credentials from Telegram runtime capabilities.                                                                                     | No Telegram-account prerequisite or token-rotation claim is introduced.                                                                                                    |
| 143.1  | Profile the actual full-body ledger with real Rust clink.                                      | Reuse the checksummed retained-journal probe when private input is available; otherwise run a finite, clearly labelled synthetic probe.                 | Actual clink 0.2.11 used locally; original private journal is absent from this worker.                                                                                     |
| 143.2  | Retain durable progress while projection proceeds.                                             | Preserve acquisition journals/checkpoints and existing opt-in binary-projection progress events; do not remove verification to improve apparent timing. | Existing durable acquisition/projection implementation retained; profiler supports opt-in progress.                                                                        |
| 143.3  | Preserve raw source bodies; never restore literal undefined text.                              | Keep full-body domain records and exact fresh-store comparisons.                                                                                        | Synthetic full-body records, traces, and normalized offers restore exactly.                                                                                                |
| 143.4  | Isolate timing from Docker/browser/parser workloads and preflight adequate disk.               | Existing retained-journal probe requires 8 GiB startup headroom and a 2 GiB import floor; synthetic probe runs separately with bounded inputs/heap.     | Local synthetic timing finished before the Docker build and runtime suites started.                                                                                        |
| 143.5  | Complete original-journal persistence AND fresh-store readback.                                | Use `experiments/revalidation-pr145-real-ledger.mjs` against the private checksummed journal; compare every field and normalized reference offers.      | Prior PR149 retest passed 110,291 records, 406 traces, and 324 normalized offers in 398,045 ms; this branch cannot repeat unavailable private input.                       |
| 143.6  | Demonstrate practical uncapped full protected-cohort acquisition + OCR + persistence.          | Existing protected acquisition/native ingestion/OCR pipeline, adequate resources, and complete per-source/cohort evidence.                              | Still unmet: protected credentials, journal, and original cohort are not present here. A synthetic or retained first-source pass is not this acceptance.                   |
| 143.7  | Keep private bodies, contacts, sessions, and source IDs private.                               | Commit only self-authored fixtures and sanitized measurements.                                                                                          | No protected data is committed; temporary stores are cleaned.                                                                                                              |
| 143.8  | Do not interpret old resource-limited attempts as proof of a current isolated code regression. | Honor later successful retries and preserve resource/timing context. Avoid speculative production retuning based on synthetic shard counts.             | No unsupported claim of a new projection defect or full-cohort success.                                                                                                    |
| 150.1  | Reproduce loss of A1702/floor 17 and A1802/floor 18 sharing a property website.                | Run the existing independent diagnostic and add minimal parser fixtures before changing union logic.                                                    | Reproduced before the fix; original five-check diagnostic now passes with actual clink.                                                                                    |
| 150.2  | Distinguish unit-detail links from building/catalog/agency URLs.                               | Classify URL path/query evidence with the standard URL parser; retain shared links as provenance while excluding them from unit joins.                  | `src/offer-url-identity.js` handles homepages, common container pages, detail paths, ID queries, and Telegram post aliases.                                                |
| 150.3  | Prevent shared URLs overriding distinct explicit IDs in the same source namespace.             | Defer all non-message URL joins until explicit identity constraints are available.                                                                      | Shared links do not join units; detail-link candidate groups are vetoed before union when identities conflict.                                                             |
| 150.4  | Cover legacy learned URL aliases as well as newly parsed URLs.                                 | Apply classification centrally to all `offerIdentityKeys`, including persisted `url:` aliases.                                                          | Regression injects a learned shared URL key; both units survive.                                                                                                           |
| 150.5  | Prevent an unidentified URL/fingerprint bridge from collapsing conflicting units.              | Evaluate the entire candidate group before merging; retain existing fingerprint conflict checks.                                                        | Three-order bridge regression preserves all three candidates.                                                                                                              |
| 150.6  | Preserve same-unit reposts and price updates.                                                  | Continue explicit source-scoped identity joins and tested price-history merging.                                                                        | Positive controls and existing identity/chronology suites retained.                                                                                                        |
| 150.7  | Preserve cross-source aliases.                                                                 | Retain namespace-aware identifiers and guarded fingerprint matching.                                                                                    | Different source-local IDs can still match when physical evidence agrees.                                                                                                  |
| 150.8  | Preserve official-site matching when identity is established.                                  | Allow guarded detail-link matching; retain explicit and physical evidence matching on shared pages.                                                     | Official detail repost positive control passes.                                                                                                                            |
| 150.9  | Preserve correctly updated edits.                                                              | Treat the same Telegram post as a message identity even when edited attributes change.                                                                  | Same-post edit in either order retains the latest unit attributes.                                                                                                         |
| 150.10 | Test parsing → persistence → search in both orders and independent writes.                     | Parse both posts, write separately, add a same-unit repost, reopen a fresh store, and search.                                                           | New integration test returns two units in both orders; real-clink execution also passes.                                                                                   |
| 150.11 | Preserve existing positive controls and expected result two.                                   | Run the existing standalone diagnostic unchanged and the identity suites.                                                                               | No expectation was weakened; no population-wide FP/FN claim is made.                                                                                                       |
| 151.1  | Identify the deprecated installation path accurately.                                          | Inspect npm metadata and locked tree, then compare maintained upstream implementations.                                                                 | Original path: mtcute 0.32.3 → SQLite 12.11.1 → prebuild-install 7.1.3. Latest mtcute 0.32.4 still requests SQLite 12.                                                     |
| 151.2  | Evaluate an upstream-supported native addon installation update.                               | Compare SQLite 13's shipped N-API binaries with source compilation and changing Telegram providers.                                                     | Select upstream SQLite 13.0.3 through a narrowly scoped mtcute override; preserve the existing provider.                                                                   |
| 151.3  | Do not suppress warnings or blindly override without compatibility evidence.                   | Test the exact wrapper's migrations, WAL, auth-key expiry/deletes, transactions, and restart before accepting the scoped override.                      | Real provider tests pass; no warning filters or `--loglevel` suppression added.                                                                                            |
| 151.4  | Verify clean npm installation and all applicable dependency locks.                             | Synchronize npm and Deno resolution; inspect the independent example lock.                                                                              | Clean root installation has no prebuild-install. npm/Deno locks remove the deprecated dependency; example lock never contains it.                                          |
| 151.5  | Verify actual SQLite and Telegram provider use.                                                | Instantiate real mtcute SqliteStorage and the production client without authenticating or sending.                                                      | New provider tests and image smoke checks exercise real addon calls.                                                                                                       |
| 151.6  | Verify native image builds.                                                                    | Native Linux amd64 and arm64 PR runner matrix; architecture-scoped caches and concurrency prevent one matrix entry cancelling the other.                | Native CI includes tool/browser/search/storage/health checks and the SQLite/provider smoke.                                                                                |
| 151.7  | Preserve truthful maintenance/security claims and supported runtimes.                          | Match Node minimum to SQLite 13's requirement; keep the existing Telegram provider and document root-override limits.                                   | Node minimum and current README/Telegram instructions now say 22.13; no vulnerability claim. Published consumers need upstream mtcute adoption or their own root override. |
| 152.1  | Reproduce the ignored `skipComments` warning despite a passing clone gate.                     | Invoke the installed jscpd with tracked configuration rather than validate JSON alone.                                                                  | Warning reproduced before the change.                                                                                                                                      |
| 152.2  | Determine the supported equivalent.                                                            | Use supported `mode: weak`, the documented equivalent of `--skip-comments`.                                                                             | Tracked unsupported setting removed; actual checker accepts every setting.                                                                                                 |
| 152.3  | Preserve threshold and minimum-size semantics.                                                 | Keep threshold 10, minTokens 30, minLines 5, formats, ignores, and reporters unchanged.                                                                 | Configuration regression asserts all three limits; no raised threshold or added code ignores.                                                                              |
| 152.4  | Prevent silently ignored settings and verify comment/code behavior.                            | Run real checker debug validation; compare comment-only weak/strict fixtures and duplicate executable code.                                             | Weak comments pass, strict comments fail, duplicate code fails threshold 0; no unknown-field warning.                                                                      |

## Primary-source research and component choices

- [jscpd CLI reference](https://jscpd.dev/reference/cli) documents weak mode and
  the `--skip-comments` alias. JavaScript's tokenizer already excludes comments
  across modes; a Python fixture supplies a meaningful strict-mode positive
  control while production scanning remains JavaScript. Adding an independent
  clone detector would add maintenance without improving this configuration fix.
- [better-sqlite3 13.0.0](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
  introduces N-API and shipped platform binaries, removes prebuild-install,
  and requires Node 22.13+. [13.0.3](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3)
  includes subsequent fixes. The [upstream maintenance discussion](https://github.com/WiseLibs/better-sqlite3/issues/1463)
  identifies version 13 as the resolution. This is an upstream installation
  path tested against the wrapper, not merely a version-number substitution.
- [mtcute storage documentation](https://mtcute.dev/guide/topics/storage)
  describes the Node SQLite provider. Its 0.32.4 wrapper uses APIs retained in
  SQLite 13: constructor, pragma, prepare, and transaction. Replacing mtcute
  with a web/alternate transport or Node's built-in SQLite would require a new
  provider/integration and broader behavioral tests; it is unnecessary here.
  Root overrides are not applied to a package installed as someone else's
  dependency, as [npm documents](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).
  The change resolves maintained checkout/Docker installation. Warning-free
  published consumers require mtcute to adopt 13 or the consumer to apply the
  same tested root override; bundling a native dependency was not introduced.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
  supports the existing OIDC publication workflow after authorized bootstrap
  and registration. An authentication library cannot supply absent owner
  credentials or prove that registry writes occurred.
- URL classification uses the standard URL parser and existing namespace-aware
  union/find conflict checks. An entity-resolution/fuzzy-matching library would
  not establish whether a property's homepage identifies a rental unit and
  could weaken explicit conflict constraints.
- Real projection continues to use the existing Rust clink 0.2.11 adapter,
  compact identifiers, durable journals, and bounded sharding. Switching to a
  different database or dropping raw bodies would change the storage contract
  and would not satisfy the requested real-clink acceptance.

## Reproduction and validation

Before changing production behavior, the new shared-URL regression failed, the
installed-checker configuration test failed, and the native dependency test
resolved SQLite 12.11.1. Logs are retained locally in ignored `ci-logs/`.

```bash
# Original independent counterexample, unchanged; requires actual clink.
node experiments/revalidation-pr149-url-identities.mjs

# New end-to-end identity regression including fresh binary store and search.
REQUIRE_REAL_CLINK=1 node --test tests/issue-150-shared-urls.test.js

# Actual installed checker and provider compatibility probes.
node --test tests/duplication-config.test.js tests/mtcute-sqlite.test.js

# Full appropriate verification, as required by repository contributing rules.
npm run check
REQUIRE_REAL_CLINK=1 npm run test:coverage
bun test --timeout 30000
deno test --frozen --allow-read

# This deliberately fails while real publication prerequisites are absent.
PREFLIGHT_MODE=release bash scripts/preflight-credentials.sh
```

All producers, normalization, store writes/readback, and search use the central
`deduplicateOffers` path. No parallel URL-union implementation was found.
Both current lockfiles and production Docker installs are checked. Historical
case studies are preserved as historical evidence, rather than rewritten to
claim they originally used the updated dependency.

## Measured projection evidence and limits

Two isolated, finite, self-authored full-body probes used actual clink 0.2.11,
24 input offers, 5,976 domain records, 24 traces, and 1,460,819 JSON bytes.
Both verified every field through a fresh store. They ran with a 2 GiB Node
heap and bounded 1..368 input/32..2048 shard parameters.

| Maximum links/shard | Imports | Domain write | Fresh read |     Total |
| ------------------- | ------: | -----------: | ---------: | --------: |
| 512                 |     415 |    55,867 ms |  13,611 ms | 75,872 ms |
| 2,048               |     101 |    31,554 ms |  54,652 ms | 90,240 ms |

The restarted reader uses production defaults. Changing the writer's shard
configuration can cause fresh readback to reproject into that default layout;
the larger-shard experiment therefore is not a like-for-like steady-state
optimization result. Fewer imports did not mean faster complete verification.
No production shard default was changed on this evidence.

The latest original-data result in [issue 143's comment](https://github.com/konard/vietnam-accomodation-search/issues/143#issuecomment-6047610931)
already passed the retained first source: 110,291 records, 29,681,658 JSON bytes,
406 traces, and 324 normalized offers from 368 posts in 6.63 minutes. It remains
separate from the complete protected acquisition + OCR + real persistence
cohort. This worker's available paths and environment contain no copy of that
private journal or usable protected credentials. This says nothing about their
availability on the issue author's machine.

## Release evidence and outstanding acceptance

Main run [37692842006](https://github.com/konard/vietnam-accomodation-search/actions/runs/37692842006),
created 2026-10-07T21:56:12Z on `b0b4aca479e39cd462d55dd916aff8448348272e`,
fails real release preflight. Downloaded local log lines 151 and 153 identify
the absent npm/bootstrap prerequisite and Docker Hub configuration; line 155
reports 0 verified, 2 failed, 0 unknown. Fresh secret, variable, and release
listings are empty. Local real-mode preflight likewise fails; its OIDC status
is unknown outside Actions and is not presented as authentication success.

The prepared-branch initial run [37752173242](https://github.com/konard/vietnam-accomodation-search/actions/runs/37752173242)
is on `61a63700450bfc04fd563b9d1081db0dce0aaff2`, created
2026-10-08T08:47:22Z. Its actionable PR failure is missing Changesets, at local
downloaded log lines 10747–10748; its pipeline reports `changeset-check` at 11031. This PR adds one patch Changeset. Release preflight separately still reports
the absent external configuration at line 167; release reporting is not hidden.

Remaining operational acceptance is concrete: authorized bootstrap and Docker
Hub configuration, an exact release-commit real preflight/publication run,
immutable native manifests/digests and clean registry install, and a complete
protected cohort audit with the original private input, OCR, adequate isolated
resources, durable progress, and fresh real-clink readback. Existing scripts
support these steps; unavailable external inputs prevent claiming completion.

## Completed local verification

| Check                                                             | Result                                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Node 24.21.0, mandatory real clink, complete coverage suite       | 1,311 passed; 100% product line coverage, 96.52% branch coverage, 98.95% function coverage         |
| Bun complete suite                                                | 1,311 passed, zero failures                                                                        |
| Deno frozen-lock read-only suite                                  | 1,206 passed plus 19 steps, zero failures                                                          |
| Lint, formatting, real duplication gate                           | Passed; 5.34% duplicated lines below the unchanged 10% limit; no ignored-setting warning           |
| Cold native amd64 Docker build                                    | Passed; no deprecated prebuild-install warning, actual shipped SQLite and production client passed |
| Hardened native image browser and application search              | Passed; search found the fixture offer                                                             |
| Native image size and Rust tool                                   | 1,471 MiB below the existing 1,600 MiB budget; clink 0.2.11                                        |
| Pinned actionlint with shellcheck; status gates; file line limits | Passed                                                                                             |

The first complete Node attempt hit an existing CDN-dependent Docker-argv
test's 30-second deadline; that test passed unchanged on a focused retry and
the final complete rerun. Its timeout was not increased. A strict-comment
fixture initially had fewer than the configured 30 tokens; the corrected
40-comment fixture supplies a real positive control. Those initial attempts
are preserved alongside the passing final logs. Native arm64 and exact-head
remote CI results are recorded in the PR after the push.

The first implementation CI run correctly rejected two Changesets at log line
253: the repository requires exactly one per PR. Their release notes were
combined into one patch Changeset, retaining all three fixes.
