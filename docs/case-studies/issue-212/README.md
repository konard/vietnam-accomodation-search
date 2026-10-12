# Issue 212: requirements, research and acceptance evidence

This single [PR 213](https://github.com/konard/vietnam-accomodation-search/pull/213)
addresses the two reproducible code defects in issues 210 and 211. The original
host and independent reviewers required by issues 183 and 193 are unavailable in
this workspace. Those operational requirements remain **unfulfilled**. Fixing a
guard, passing finite tests, or automatically closing an issue does not establish
original-host acceptance. No new production/global-best claim is made.

All four issue bodies and their comments were read, together with the merged
[PR 209 report](../pr209-original-host-revalidation-2026-10-12/README.md), the
[PR 204 report](../issue-203/README.md), contributing guidelines and the current
acceptance/operator implementations. The latest original-host report explicitly
preserves failures and does not certify either outstanding operational gate.

## Complete requirement map and solution plans

“Retained” means the existing implementation remains in place; it does not mean
the required live acceptance passed. Every item below is in the scope of this PR.

| ID     | Requirement                                                                                                                                               | Options and selected solution/verification plan                                                                                                                                                                                                   | Outcome                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 212.1  | Read every listed issue and all comments; fully implement their requests.                                                                                 | Read 183/193/210/211, including the latest original-host evidence. Implement demonstrated defects; evaluate operational gates against actual available evidence.                                                                                  | Reading and code fixes complete; original-host requirements remain unfulfilled.            |
| 212.2  | Perform all work in one PR, with no deferred implementation PR.                                                                                           | Use only the prepared issue branch and existing PR 213.                                                                                                                                                                                           | All delivered changes are in PR 213.                                                       |
| 212.3  | Close the parent and every listed issue in the description.                                                                                               | Include the required closing block plus `Fixes #212`. Explain unresolved operational acceptance prominently.                                                                                                                                      | Closing block included; automatic closure is not acceptance.                               |
| 212.4  | Use one complete closing keyword per issue, verbatim.                                                                                                     | Five separate `Fixes` lines; do not combine issue numbers after one keyword.                                                                                                                                                                      | Description includes the exact requested four-line block.                                  |
| 212.5  | Explicitly identify issues already resolved or not reproducible while keeping their closing references.                                                   | Distinguish reproducible code defects, existing working controls and unavailable operational evidence.                                                                                                                                            | Neither 183 nor 193 is declared resolved or non-reproducible.                              |
| 183.1  | Establish fetch, terminal pagination and parsing separately for every supported source.                                                                   | A queue/crawler library can schedule requests but cannot prove a challenged source is exhausted. Retain `source-acceptance.mjs`, web pagination evidence and the source inventory; collect every supported source on the original host.           | Existing gates retained; fresh universal live completion unavailable.                      |
| 183.2  | Preserve challenged, rate-limited, pending, inaccessible, not-found, zero-card and parse-incomplete outcomes explicitly.                                  | Retry only within existing bounds or mark incomplete/excluded; do not turn a finite route fixture into live evidence or bypass access controls.                                                                                                   | Existing fail-closed outcomes retained; no successful live outcomes invented.              |
| 183.3  | Complete at least 90 days of native history, media, photo-only OCR/review and latest-offer catchup.                                                       | Resume the original frozen cohort/window and native checkpoints under the original disk/time guards; retain failed attempts. Older text replay and smaller sources cannot replace fresh completion.                                               | Original snapshots/configuration/media unavailable; unfulfilled.                           |
| 183.4  | Account for every retrieved message with zero parser exceptions, and reject missing numeric evidence.                                                     | Retain strict numeric whole-cohort completion from PR 209 and the held-lock/private-evidence regressions.                                                                                                                                         | Existing controls verified; no new live whole-cohort result.                               |
| 183.5  | Verify fresh binary store, graph and media readback, real eligible photo notification and restart.                                                        | Use existing real-photo acceptance with an eligible real cached-photo candidate; stop honestly if selection fails. Do not seed a synthetic candidate or reopen a receipt defect without reproducing it.                                           | Real credentials/media unavailable; notification/restart unverified.                       |
| 183.6  | Obtain independent blinded bedroom/room/bed, quote-basis and period labels.                                                                               | Use the existing private review pack and blank label template, or independently operated Label Studio without prediction prelabels. A human reviewer must inspect original material; no predictions/arithmetic become ground truth.               | Independent labels/reviewers unavailable; unfulfilled.                                     |
| 183.7  | Measure offer/field precision and recall with positive evidence; exclude unknown/nonpositive denominators and preserve billing scopes.                    | Retain the independent-review metric gate and value-pricing rules. Validate the finite controls separately; publish only sanitized metrics once real reviews exist.                                                                               | Existing finite controls retained; measured live FP/FN unavailable.                        |
| 183.8  | Keep global best/cheapest unverified until live catalogue and truth gates pass.                                                                           | Retain source inventory acceptance and explicitly report incomplete rather than infer coverage from tests, arithmetic, old replay or merged PRs.                                                                                                  | Unverified status retained.                                                                |
| 183.9  | Preserve credentials/config/deployment/private material; unchanged time/disk guards, four-worker maximum and public read-only scope; exact owned cleanup. | Use protected evidence, original guard settings and existing ownership ledgers. Never contact landlords or bypass source controls.                                                                                                                | No original private state accessed or altered; guard constants unchanged.                  |
| 183.10 | Diagnose live resolution rate limiting without hammering requests, erasing failed evidence or widening retries.                                           | Normalize known SDK shapes in both diagnostics and runtime retries; retain bounded cause traversal and long-wait deferral.                                                                                                                        | Implemented and verified without live requests under 211.                                  |
| 193.1  | Configure the original private environment through the existing operator, with explicit authority.                                                        | Existing `telegram authorize-owner --env-file /private/original.env` derives the owner. A new auth library or a temporary configured copy cannot repair the original deployment. Run only against the original file under the required authority. | Original environment/access and explicit original-file authority unavailable; unfulfilled. |
| 193.2  | Use the existing authenticated session/owner identity; do not require a new token, session or independent identity.                                       | Retain the existing operator, numeric owner derivation and legacy credential alias support.                                                                                                                                                       | Existing controls retained; no replacement credentials requested.                          |
| 193.3  | Invoke an actual privileged command using the original configuration.                                                                                     | Run the existing owner-only conversation acceptance against the configured original environment; record a boolean result privately.                                                                                                               | Cannot run against absent original configuration.                                          |
| 193.4  | Verify an unrelated recipient remains unauthorized and keep public access closed.                                                                         | Retain access checks and owner allowlists; run existing negative controls. Never auto-authorize everyone to satisfy readiness.                                                                                                                    | Existing automated controls retained; original-host negative control unverified.           |
| 193.5  | Never publish IDs, credentials, sessions or environment contents; do not represent a temporary-copy pass as original acceptance.                          | Private local evidence and boolean public reports only. Preserve the QA-only boundary documented in the issue.                                                                                                                                    | No private material published; limitation explicit.                                        |
| 210.1  | Provide a bounded, explicitly owned clean-cache capacity bootstrap/recovery path.                                                                         | Requiring cached images deadlocks; weakening the guard violates the requirement. Prefer supported cached helpers, otherwise pull only `busybox:1.37.0` with the existing 30-second command bound and cancellation.                                | Implemented in the shared capacity helper.                                                 |
| 210.2  | Check host backing capacity before bootstrap and guest capacity before heavy acquisition.                                                                 | Keep the Desktop backing-image resolver and guard order: exclusive lock → 8 GiB host preflight → small helper → 8 GiB guest preflight → heavy work.                                                                                               | Finite ordering and rejection tests pass.                                                  |
| 210.3  | Preserve preflight/runtime floors and serialization.                                                                                                      | Leave the 8 GiB preflight, 2 GiB runtime floor, polling bounds and per-host lock unchanged.                                                                                                                                                       | Existing guard constants and tests retained.                                               |
| 210.4  | Reserve exact image/helper ownership before acquisition, stop producers, delete only acquired resources and preserve pre-existing images/shared cache.    | Reuse `QaDockerCleanup`: save a protected image journal before pull and helper reservation before create; remove the helper before its acquired tag. Avoid force image removal, pruning and arbitrary user-image fallback.                        | Empty-cache, pre-existing tag, shared image ID and producer-order controls pass.           |
| 210.5  | Repeat a clean run twice without relying on retained helper images.                                                                                       | Exercise the same bootstrap twice; compare Docker inventory after each run. Update the real guest experiment to use the shared guard rather than duplicate helper/image setup.                                                                    | Finite two-run control passes; actual platform results recorded below.                     |
| 210.6  | Cover setup failures and signals.                                                                                                                         | Inject partial-pull/create/start failures; send actual SIGINT/SIGTERM to a finite child during owned acquisition (IPC on Windows). Wait for the producer before cleanup.                                                                          | Automated controls pass.                                                                   |
| 210.7  | Retain ownership journals and lock when cleanup fails; allow exact recovery.                                                                              | Recover labelled helper first, validate the companion journal's run ID and exact image reservation, then use the existing exact cleaner. Failed removal/verification retains evidence and the lock.                                               | Cleanup-failure/recovery control passes.                                                   |
| 210.8  | Run real image smoke and credential-pinned cutover only after the guard; finite doubles cannot replace these results.                                     | Retain existing image/cutover callers of `qaDockerStoragePaths` and `acquireQaStorageGuard`. Use appropriately provisioned CI for image builds and the original credential-pinned host for cutover.                                               | Original Desktop/cutover acceptance remains unverified; no substitute claim.               |
| 210.9  | Keep diagnostics private and preserve exact independent inventory.                                                                                        | Use boolean reports and protected optional Docker error evidence; compare baseline inventory after attempted acquisition.                                                                                                                         | Default debug remains off; real attempt preserves inventory.                               |
| 211.1  | Recognize real numeric-code SDK flood waits directly and through bounded causes.                                                                          | A blanket 420 rule includes frozen and unrelated flood errors. Use validated known Teleproto `FloodWaitError` fields and mtcute `RpcError` normalized text/seconds, shared with runtime retries.                                                  | Actual installed SDK classes pass direct/nested tests.                                     |
| 211.2  | Emit only finite source-resolution/rate-limited/FLOOD_WAIT metadata.                                                                                      | Whitelist phases/types/codes; do not publish seconds, messages, requests, sources or arbitrary strings.                                                                                                                                           | Sanitized metadata verified.                                                               |
| 211.3  | Cover frozen/other flood subclasses, malformed/unknown codes, cyclic causes and unsafe custom shapes (including revoked proxies).                         | Reject ambiguous shapes and noninteger/out-of-range seconds; use bounded descriptor reads without custom getters/coercion. Limit causes to four children and two levels.                                                                          | Automated negative/privacy controls pass.                                                  |
| 211.4  | Keep retry/cancellation bounds; long waits remain deferred/incomplete.                                                                                    | Use the shared shape check in `classifyTelegramError`; never clamp an SDK-mandated long wait into an earlier retry. Retain existing elapsed/delay/attempt limits.                                                                                 | Long SDK wait makes one attempt and no sleep; cancellation remains immediate.              |
| 211.5  | Retain passing held-lock/private-evidence controls from 205.                                                                                              | Run `issue-205-diagnostics.test.js` with new regressions; retain evidence and lock handling.                                                                                                                                                      | Focused controls pass.                                                                     |
| 211.6  | Preserve actual failed source outcomes; successful next-page probes do not complete history.                                                              | Change error normalization only, not source completion, retry limits, source membership or frozen-cohort evidence.                                                                                                                                | No history evidence or completeness checks rewritten.                                      |

## Online component research and decisions

Research was checked against primary documentation on 2026-10-12 and the actual
installed SDK source, rather than assuming all numeric 420 errors are equivalent.

- [Telegram RPC errors](https://core.telegram.org/api/errors) distinguish numeric
  error codes from error types, including flood waits. This supports validating
  both class/fields and code instead of treating every 420 as `FLOOD_WAIT`.
- [GramJS FloodWaitError](https://gram.js.org/beta/classes/errors.FloodWaitError.html)
  documents numeric code 420 and a seconds field. Installed Teleproto's
  `RPCErrorList.js` adds `name=FloodWaitError`, `errorMessage=FLOOD` and numeric
  seconds; frozen, slow-mode and two-factor waits share the numeric code but
  have different fields. Existing Teleproto is sufficient; another SDK adds
  no diagnostic value.
- [mtcute error handling](https://mtcute.dev/guide/intro/errors) provides flood
  handling within a threshold. Installed mtcute normalizes `FLOOD_WAIT_600` to
  `text=FLOOD_WAIT_%d` and `seconds=600`. The new shared validator covers this
  supported native SDK too. Its SDK behavior does not authorize wider audit
  retry budgets.
- [Docker image pull](https://docs.docker.com/reference/cli/docker/image/pull/)
  supports explicit image references. The small already-supported BusyBox
  version is sufficient; downloading BuildKit solely to measure free space is
  unnecessary. This uses the existing versioned tag, not an invented digest.
- [Docker image removal](https://docs.docker.com/reference/cli/docker/image/rm/)
  explains that removing a tag from a multiply tagged image removes that tag.
  Existing exact tag ownership therefore preserves baseline aliases and shared
  layers without global pruning or force image deletion.
- [Testcontainers](https://node.testcontainers.org/features/containers/) and
  [Ryuk](https://github.com/testcontainers/moby-ryuk) supply container lifecycle
  cleanup. Their additional helper lifecycle would itself need bootstrap and
  does not replace this repository's exact image/cache ownership journals.
  Reusing the existing cleaner avoids another daemon/helper/dependency.
- [Crawlee enqueueLinks](https://crawlee.dev/js/api/3.13/core/function/enqueueLinks)
  can discover and queue pagination links, with same-origin strategies. It
  cannot prove every inaccessible/challenged catalogue exhausted, nor provide
  independent labels. Retain the existing browser adapters and terminal evidence;
  do not migrate collectors without a reproduced implementation defect.
- [Label Studio prediction integration](https://labelstud.io/guide/ml.html)
  can display predictions as prelabels. For this issue they must be omitted
  during independent blind review. A private deployment could support human
  annotation, but installing it or auto-labeling cannot supply the missing
  reviewer attestations. The existing blank private template already supports
  the required workflow.

## Implementation scope and reproduction

`qaDockerStoragePaths` is shared by image acceptance, Desktop revalidation,
guest-capacity acceptance, cleanup matrix and cutover. Fixing its preparation
hook covers all callers. The guest experiment now runs twice through that hook,
avoiding duplicate Desktop helper creation. A configured custom helper remains
cache-only: a missing/invalid custom image does not authorize an arbitrary pull.

`safeAcceptanceFailure` is shared by source acceptance and Telegram history
audits. The same validated SDK check also repairs the runtime retry classifier:
the actual Teleproto English message did not contain the prior text pattern.
No new credential/SDK dependency, source access, messaging or UI change is needed.

Before implementation, the new regressions failed on clean-cache bootstrap,
actual SDK metadata and an unsafe diagnostic getter. Logs are retained outside
tracked files. The minimal actual-SDK reproducer remains reusable:

```sh
node scripts/test-with-cleanup.mjs node experiments/revalidation-teleproto-flood-diagnostics.mjs
node scripts/test-with-cleanup.mjs node --test --test-concurrency=1 tests/issue-210-capacity-bootstrap.test.js tests/issue-211-flood-diagnostics.test.js
QA_DOCKER_CAPACITY=1 node scripts/test-with-cleanup.mjs node experiments/issue-208-docker-guest-capacity.mjs
```

The third command uses the actual available daemon and real capacity floors.
It is not automatically an original macOS Desktop result. Optional
`QA_DOCKER_DEBUG_FILE=/private/docker-failure.json` stores raw Docker failure
evidence locally with private permissions; leave it unset for public reports.

## Validation and remaining acceptance

- Node's ordinary suite passed 1,503 tests before the final additional controls.
  The final coverage suite passed 1,506 tests with 100% product line coverage,
  96.95% branch coverage and 98.78% function coverage.
- Bun's full suite passed 1,505 tests. All 15 final focused bootstrap, SDK and
  held-lock/private-evidence regressions also passed after the last changes.
- Frozen Deno passed 1,391 tests and 19 steps, with 11 existing native-only
  exclusions; all 15 final focused tests passed. Native filesystem and actual
  process-signal controls execute under Node, retaining Deno's read-only profile.
- `npm run check` passed lint, formatting and duplication (5.01%, below the
  existing 10% threshold). The actual installed-SDK reproducer also passed.
- The actual local Docker attempt pulled and created the owned helper, then
  failed at startup because the nested daemon could not enter its invalid
  cgroup-v2 domain. Exact independent Docker inventory was restored and strict
  teardown passed. Repeating the environmental failure confirmed the same
  limitation; no host Docker settings or capacity floors were changed.
  This is **not** a guest-capacity, original Desktop, image-smoke or cutover pass.

The initial prepared SHA `38d9211` failed the changeset check on
[run 38194709644](https://github.com/konard/vietnam-accomodation-search/actions/runs/38194709644).
The downloaded log reports `No changeset found in this PR` at lines 5715–5716,
and the pipeline identifies `changeset-check` at lines 15038–15039. Logs remain
in ignored `ci-logs/`. Both fixes now share exactly one added patch changeset;
manifest versions are left to the automated release workflow. Current native
image/clink and runtime CI evidence is linked from
[PR 213 checks](https://github.com/konard/vietnam-accomodation-search/pull/213/checks);
it must correspond to the final pushed SHA, rather than the initial failed run.

Original live source histories, photo material and independent labels are not
available here. The original private configuration is also absent. Consequently
183 and 193 remain operationally unresolved, and original Desktop/image-smoke/
credential-pinned cutover acceptance for 210 is not certified by finite tests.
No previously passed live results are relabelled as new results. The required
closing references in PR 213 are administrative; merging them does not change
these factual limitations.
