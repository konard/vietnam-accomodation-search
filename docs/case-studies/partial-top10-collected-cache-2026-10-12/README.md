# Collected-cache shortlist and cleanup revalidation

Original-host QA on October 12–13, 2026, on `c4bd1df` plus this QA-only handoff.
No production parser, ranking, deduplication or cleanup fix is included. The
requested ranking is Nha Trang, cheapest advertised total rent per month.

## Delivered locally

`data/` is persistent, git-ignored and excluded from formatting, lint and
duplication scanning. Directories are private; files are owner-readable only.
Credentials stay in their original env files, not in this cache or public report.
Tests must not delete this user-requested cache as a temporary fixture.

The cache consolidates retained, checksum-verified continuous 90-plus-day raw
history and completed deltas through `2026-10-12T14:03:28.334Z`, latest web review
observations and any already-downloaded media. Canonical offers were reparsed
from the latest seven days. Original collection times remain original; offline
parsing is not a new live observation. Missing source/media/OCR/quality coverage
is not relabeled complete. Failed snapshots and original evidence were preserved.

`data/top-10-nha-trang-monthly-reviewed.md` and matching JSON contain ten manually
reviewed, distinct original Telegram posts, direct links, monthly rent, lease
conditions and advertised future availability. All ten selected posts were checked
directly with the real authorized user session; successful previous checks were
reused, and new checks were batched per public source. No joining, posting,
landlord inquiries or owner-chat test messages were used for this shortlist.

The reviewed subset excludes obvious fee, scale, service/guide and duplicate
errors and the expired web detail pages checked. It is not an automatic production
acceptance result, a global optimum across all supported sources, an all-in cost
or landlord-confirmed availability. Studios are not invented one-bedroom units;
unknown/nonpositive denominators remain excluded. Selected current rent amounts,
periods and whole-property scope passed actual production parsing/comparison.
Fresh reviewed-JSON readback preserves ten direct links and their quotes.

Production canonical readback **failed**: two distinct studio posts collapsed,
leaving nine records. The failed canonical store is retained, while the reviewed
JSON keeps original posts separate. No fake unit identifiers were added to make
that assertion pass. See issue 238.

## Cache/resource evidence

Cache preparation and cache-only ranking made zero target API requests. Automatic
candidate ranking uses production `SearchService` with `refresh: false` and a
collector/fetch trap. It is explicitly unreviewed: a minimum-price screen does
not fix parser defects. See [cache-only instructions](../../local-cache.md).

The initial combined cache bootstrap persisted data, then exhausted Node's
default heap while holding raw/normalized material and reopening the store. This
is a failed transaction, not a successful bootstrap. Separate canonical readback
and ranking processes passed. The exact dead child was matched to the OOM log and
owned guard metadata; its stale guard was recoverably quarantined, not broadly
deleted. Persistent data and failed-run evidence were retained. No Docker
resources were acquired in this cache run.

The user's screenshot exposed unprefixed cutover replies missed by the previous
final chat audit. Exact original run/sequence, bot sender and recorded time-window
provenance identified the owned replies. Producers were stopped; exact native
IDs were deleted, then independently paged readback verified their absence and
preservation of unrelated messages. Previous clean-chat claims were withdrawn.
The recognition regression remains open; this recovery does not prove every
historical message or future cutover test cleans itself automatically.

## New focused issues and reusable cases

No comments or reopened issues were used. Descriptions carry sanitized evidence;
actual raw messages, contacts, private IDs and source workloads stay local.

| Issue                                                                   | Reproduced defect / missing capability               | Offline case                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| [227](https://github.com/konard/vietnam-accomodation-search/issues/227) | Unprefixed cutover replies survive cleanup/audit     | `revalidation-cutover-unmarked-replies.mjs`   |
| [228](https://github.com/konard/vietnam-accomodation-search/issues/228) | Memory-bounded cache import/access needed            | Actual default-heap OOM and separate readback |
| [229](https://github.com/konard/vietnam-accomodation-search/issues/229) | Contradictory/tiny literal rent scale ranks cheapest | `revalidation-contradictory-rent-scale.mjs`   |
| [230](https://github.com/konard/vietnam-accomodation-search/issues/230) | Management/combo fees become rent                    | `revalidation-management-fee-rent.mjs`        |
| [231](https://github.com/konard/vietnam-accomodation-search/issues/231) | Expired/rented web cards appear fresh                | Actual original-detail-page checks cached     |
| [232](https://github.com/konard/vietnam-accomodation-search/issues/232) | Market guides/service posts become offers            | `revalidation-market-guide-intent.mjs`        |
| [233](https://github.com/konard/vietnam-accomodation-search/issues/233) | Selected cheap quote has a different variant link    | `revalidation-price-link-context.mjs`         |
| [234](https://github.com/konard/vietnam-accomodation-search/issues/234) | Wrapped money token loses leading digit              | `revalidation-wrapped-rent-token.mjs`         |
| [235](https://github.com/konard/vietnam-accomodation-search/issues/235) | Alternative bed counts become definite               | `revalidation-alternative-bed-count.mjs`      |
| [236](https://github.com/konard/vietnam-accomodation-search/issues/236) | Explicitly absent washer becomes present             | `revalidation-negated-washer.mjs`             |
| [237](https://github.com/konard/vietnam-accomodation-search/issues/237) | Per-person fees change rent quote basis              | `revalidation-fee-quote-basis.mjs`            |
| [238](https://github.com/konard/vietnam-accomodation-search/issues/238) | Shared agency contact collapses distinct studios     | `revalidation-agency-contact-merge.mjs`       |

An additional [issue 239](https://github.com/konard/vietnam-accomodation-search/issues/239)
tracks readiness polling that survives a timeout and prevents suite completion.
The initial full-suite attempt encountered expected sandbox-denied local
listening/process/npm access; these are not classified as production defects.
Its timed-out readiness worker nevertheless stayed alive. The exact owned
wrapper/tree was journaled, gracefully stopped and independently verified gone
before rerunning with local access. The failed attempt is not counted as a
passing full suite. Failed bind/startup, never-ready, cancellation and normal
readiness regression cases are requested in that new focused issue.

The ten offline assertions intentionally fail against current production behavior.
They are diagnostic experiments, not weakened passing tests or automatically
included release-suite tests. Every strict wrapper verified temporary teardown,
no temporary residue and no pending recovery journal even after failure. Fixture
cleanup is not evidence of external-resource cleanup; those boundaries were
checked separately. Focused cleanup/identity/value/reconciliation tests: 52 passed.

Full local Node 24.18.0 strict coverage suite: **1,525 passed**, zero failures or
skips, 100% lines, 96.99% branches and 98.78% functions. Full local Bun 1.4.3 strict
suite: **1,525 passed**, zero failures. Both final wrappers verified temporary
teardown, no leftover fixtures and zero pending recovery journals. Node's owned
compile cache was removed by its runner; persistent collected data was preserved.

Full zero-warning ESLint, tracked/new-file formatting, duplication threshold and
diff checks passed. The root and example npm freshness checks both returned no
outdated dependencies; the root audit reports zero advisories. Browser Commander
0.31.2 remains installed and current. The failed format invocation on ignore files
and the initially incorrect duplication executable path were corrected; neither
failed setup invocation is counted as a passing check.

## Readiness conclusion

Final real-credential paged owner-chat readback verifies the exact deleted IDs
and recorded run replies are absent and unrelated recorded messages remain.
The read-only native client is destroyed. Original configuration hashes match;
owned workers, Docker containers/images/builders, storage/deployment locks,
checkout traces and successful recovery namespaces are absent. Persistent data
and failed/recovery evidence remain deliberately retained.

The older whole Docker baseline equality check **does not pass**: a pre-existing
unrelated Ubuntu image is absent. Private inventory comparison finds no added
resources and no other difference. This cache run acquired no Docker resources;
the unrelated image is neither reacquired nor its removal attributed to the QA
run. Exact owned-resource absence is a separate result, not a claim of whole
host inventory restoration. No shared Docker pruning was performed.

The local partial shortlist and persistent warm cache are delivered. Full
production readiness is **not** established. The new issues above and previously
reported deployment/access/all-source acceptance blockers remain; see the
[corrected original-host report](../pr219-original-host-revalidation-2026-10-12/README.md).
No independent all-source false-positive/false-negative or complete media/OCR
attestation is claimed. Fixes stay assigned through issues as requested.
