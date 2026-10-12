# Recovery, cutover preflight and original-host acceptance

This report covers [parent #218](https://github.com/konard/vietnam-accomodation-search/issues/218)
and every requirement in [#214](https://github.com/konard/vietnam-accomodation-search/issues/214),
[#215](https://github.com/konard/vietnam-accomodation-search/issues/215),
[#216](https://github.com/konard/vietnam-accomodation-search/issues/216) and
[#217](https://github.com/konard/vietnam-accomodation-search/issues/217), in
[PR #219](https://github.com/konard/vietnam-accomodation-search/pull/219).
The issue bodies, all issue comments and all three PR comment/review types were
read. The latest related merged PRs #213 and #209 and their retained case reports
were also reviewed.

The reproducible recovery and cutover ordering defects are fixed. A further
reproducible source-review defect is fixed: billing scope and currency were
unmeasured, and a positive-only sample could pass. Finite regression results
are software evidence. They do not complete the original-host operator change,
credential-pinned deployment transitions or independently labelled live cohort.
None of the four issues is described as already resolved or unreproducible.

## Every requirement and its solution plan

“Implemented” refers to code and finite controls. “Original QA pending” requires
the original local QA environment and supplied accounts. Each child issue
explicitly assigns original-host/account revalidation to its local QA agent;
the fixing agent is to provide regression coverage and tool integrations rather
than access that host manually.

| ID    | Requirement                                                                                                                                                                           | Solution and execution plan                                                                                                                                                                                                                                                                   | Evidence/status                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 218.1 | Read every selected issue and its comments and implement its requests.                                                                                                                | Trace each child independently; inventory requirements here; implement reproduced defects; identify the original-host evidence boundary.                                                                                                                                                      | All four bodies/comments read; code fixes implemented; operational gates explicitly pending below.                                                                                                                                                |
| 218.2 | Keep all work in a single PR rather than defer children to another PR.                                                                                                                | Use existing PR #219 and branch `issue-218-f52e657d8241` for code, regressions, research and operator plans.                                                                                                                                                                                  | This PR; no additional PR.                                                                                                                                                                                                                        |
| 218.3 | PR description closes the parent and each child on merge.                                                                                                                             | Keep individual `Fixes #214` through `Fixes #218` references as requested. State the pending operational evidence prominently; do not equate automatic closure with acceptance.                                                                                                               | PR description; merging is outside this task.                                                                                                                                                                                                     |
| 218.4 | One full closing keyword per issue.                                                                                                                                                   | Use five individual lines; no grouped shorthand.                                                                                                                                                                                                                                              | PR description.                                                                                                                                                                                                                                   |
| 218.5 | Explicitly identify issues already resolved or not reproducible, retaining their references.                                                                                          | Reproduce #214/#215; retain #216/#217's operational status and newly demonstrated review-gate defects.                                                                                                                                                                                        | No issue was declared resolved before this change or unreproducible.                                                                                                                                                                              |
| 214.1 | Coordinate the runner and callers through explicit owned metadata or a protected namespace outside disposable TMPDIR.                                                                 | Introduce `qaRecoveryNamespace` and `qaRecoveryDirectory`; propagate the namespace to nested wrappers; store exact external ownership evidence there.                                                                                                                                         | Implemented; two-wrapper regression.                                                                                                                                                                                                              |
| 214.2 | Preserve exact journals/locks after external teardown fails; no evidence erasure, broad prune or weaker guard.                                                                        | Register protected-directory disposal before external-resource disposal; retain when that scope records cleanup failure. Leave exact Docker ownership, capacity lock and recovery verification in place.                                                                                      | Marker, image, guest lock/two-journal and browser-profile failure controls. No pruning or guard changes.                                                                                                                                          |
| 214.3 | Automatically clear disposable fixtures on success, assertion/setup failure and signals; only identified recovery evidence survives external failure.                                 | Keep recursive disposable TMPDIR deletion. Empty-only deletion of a runner-owned recovery namespace prevents an outer wrapper from erasing retained journals. Successful resource disposal removes its protected directory.                                                                   | Success, setup failure, assertion failure, SIGINT and SIGTERM controls; no residue.                                                                                                                                                               |
| 214.4 | Prove exact recovery removes only acquired resources, verifies the baseline and then removes journals.                                                                                | Restore actual `QaDockerCleanup`/capacity recovery APIs with finite daemon doubles; independently verify unrelated resources and baseline before deleting the exact retained directory.                                                                                                       | Nested image/guest recovery tests and independent parent readback.                                                                                                                                                                                |
| 214.5 | Cover nested wrappers and actual Docker/image/guest callers rather than one cleanup scope.                                                                                            | Move image acceptance, guest-capacity, populated Docker matrix and live message recovery journals to the shared helper; leave already durable `.deploy`/private-log journals in place. Move default audit browser profiles too, after reproducing their identical erasure.                    | Caller audit and regression fixture invoking actual image cleaner, capacity bootstrap/storage guard and browser ownership APIs. Actual daemon startup failed locally; exact baseline restored. CI/original QA supplies successful host execution. |
| 214.6 | Distinguish temporary teardown from external teardown and keep failed acceptance failed until recovery succeeds.                                                                      | Preserve the compatibility temporary audit, add `temporaryTeardownVerified`, `externalTeardownVerified` and `recoveryRequired`; retained evidence forces exit failure. Absence of evidence reports external verification as unknown, never true.                                              | Tests independently require failed exit, surviving journal and temporary deletion; subsequent exact recovery succeeds.                                                                                                                            |
| 215.1 | Keep shared-token override fail-closed for real pre-existing containers/pollers.                                                                                                      | Apply the existing guard to the independent inventory before capacity acquisition. Do not introduce a name/label exclusion list.                                                                                                                                                              | Ordinary competing poller and spoofed capacity-helper names both rejected before acquisition.                                                                                                                                                     |
| 215.2 | Capture the boundary before helper acquisition or identify only an independently verified exact helper.                                                                               | Select earlier boundary capture in `acquireDrillStorageGuard`; retain the real helper in later inventories.                                                                                                                                                                                   | Actual storage guard/capacity bootstrap APIs with finite daemon model show empty boundary and helper present after acquisition.                                                                                                                   |
| 215.3 | Keep a Docker baseline covering acquired resources and promptly release all resources on preflight failure.                                                                           | Keep `QaDockerCleanup`'s post-helper baseline unchanged. Register a second full pre-helper inventory audit before the guard so it runs after guard/helper/image/lock disposal.                                                                                                                | Partial acquisition failure control; all-container/image/lock restoration control; changed final baseline fails acceptance.                                                                                                                       |
| 215.4 | Run original credential-pinned first-deploy, redeploy, restart, failed readiness, rollback and snapshot transitions with unchanged guards.                                            | Original local QA runs `deploy-cutover-drill.mjs` with original bot/user pins, existing verified peer, isolated owned project and all transitions. Retain 8 GiB preflight, 2 GiB floor and existing operation bounds.                                                                         | Guard/transition tests pass; actual original-host transitions remain Original QA pending.                                                                                                                                                         |
| 215.5 | Independently compare complete original Docker inventory immediately on exit and retain evidence on any failed external disposal.                                                     | Use the early inventory audit after every scope exit; compare containers, networks, volumes, image references and builders. Preserve `.deploy` ledger and capacity recovery lock on failure.                                                                                                  | Implemented; finite baseline mismatch and real local failed-bootstrap baseline restoration controls. Original macOS inventory acceptance pending.                                                                                                 |
| 216.1 | With explicit original-change authority configure intended private owner/user/chat identifiers using the existing operator.                                                           | Original operator uses the existing authenticated session and `telegram authorize-owner --env-file`, or legacy read-only `configure-private-owner.mjs --env-file ... --user-env ...`; modify only the selected original environment after local authorization.                                | Existing operator and credential-alias/pin controls retained; original environment absent here. Original QA pending.                                                                                                                              |
| 216.2 | Exercise actual privileged commands under that original configuration and reject an unrelated recipient.                                                                              | Restart the original service with the selected file, verify privileged command receipt and authorization separately from GetMe, then test unrelated-recipient rejection through the same private policy. Use the independently pinned existing owner-bot dialog.                              | Existing registered-handler/private-owner tests; no authenticated live original result claimed. Original QA pending.                                                                                                                              |
| 216.3 | Preserve credentials/session values and deployment history; keep public access closed.                                                                                                | Existing atomic operator unions approved private recipients, checks concurrent edits and preserves other environment bytes; do not rotate/convert sessions or remove deployment records.                                                                                                      | Existing operator/CLI tests; no original configuration or records present or changed.                                                                                                                                                             |
| 216.4 | Publish only finite boolean results, never numeric Telegram IDs, secrets, membership/workloads, bodies or private environment contents.                                               | Keep inputs, review packs and failure detail in protected local files; report original-configuration authorization and privileged-command verification as distinct booleans.                                                                                                                  | This report and generated test controls contain no account data. Live publication pending Original QA.                                                                                                                                            |
| 217.1 | Establish fetch, terminal pagination and parse completion separately for every supported source; preserve challenge/quota/inaccessible/empty/incomplete outcomes.                     | Keep existing `source-acceptance.mjs` per-source evidence and explicit diagnostic categories; collect inventory-wide and review each source. A queue/crawler can help scheduling but cannot certify terminal pages or turn exclusions into completion.                                        | Existing pagination/diagnostic/source gate tests; new gate retains incomplete states. Live inventory acceptance pending.                                                                                                                          |
| 217.2 | After the actual cooldown resume the original frozen cohort/window for at least 90 days, latest catchup and every native item including photo-only OCR/review, under existing guards. | Reuse original cohort and checkpoint directories with `telegram-90-day-coverage-audit.mjs`, native ingestion and latest catchup. Retain provider wait/deadline and disk limits; account for every native message/album/media item and independently review OCR.                               | Existing resumable history, wait classification, retention and native-media tests; original cohort/cooldown record absent. Original QA pending.                                                                                                   |
| 217.3 | Fresh real binary store/graph/media readback, actual eligible cached-photo notification and restart, without synthetic offers.                                                        | Original QA uses `telegram-real-source-workflow-e2e.mjs` and the installed real clink backend on retrieved native material; select through real SearchService, verify actual Bot API media receipt and restart idempotency.                                                                   | Existing real-photo eligibility/readback contracts retained; message journals now protected. Live source workflow pending.                                                                                                                        |
| 217.4 | Independently blind positive/negative labels for offer, bedrooms, beds, rooms, billing scope, quote basis, period and currency; measure precision/recall and field FP/FN.             | Add `billingScope`/`currency` to prediction, blank review schema and metrics; require positive and negative labels for every field. Review only the prediction-free pack; attest independence and match digests/time/source. Optional self-hosted annotation UI must not preload predictions. | New wrong-scope/currency and positive-only regressions pass; all eight metric sets include TP/FP/FN/TN and positive/negative counts. Independently measured live truth pending.                                                                   |
| 217.5 | Matching per-bedroom/bed/room prices and scoped ranking; no invented unknown/nonpositive denominators or per-person-to-bed conversion.                                                | Preserve existing `value-pricing.js` provenance and positive integer denominator checks. Retain `person` quote basis/billing scope; original QA checks labelled same-unit, same-period, currency-converted comparisons and scoped candidate set.                                              | Existing unit-value/ranking tests and new person-scope prediction control; no production pricing changes. Live prices/ranking pending.                                                                                                            |
| 217.6 | Keep globally best/cheapest and zero-error assertions unverified until all required gates pass.                                                                                       | Preserve `globalOptimality: unverified`; fail acceptance on missing fields/negative controls/collection freshness or incomplete media. Threshold success alone does not prove zero errors.                                                                                                    | Gate strengthened; no global-best or zero-error claim.                                                                                                                                                                                            |
| 217.7 | Preserve private evidence, original records and unrelated resources; exact cleanup of messages, Docker, profiles and runtime/tools; recover failed journals.                          | Use existing exact message marker/IDs and Docker label/tag/builder ownership. Protect live message journals and failed browser profiles; stop producers before disposal, preserve unrelated baselines and release owned tools after all consumers exit.                                       | Nested recovery and existing teardown tests; real local Docker failure restored baseline. Original live cleanup audit pending.                                                                                                                    |

## Root causes, alternatives and selected implementations

### Recovery lifetime

The strict runner sets `TMPDIR`, `TMP` and `TEMP` for its child, then recursively
deletes that directory on every exit. `os.tmpdir()` follows those variables;
a caller's correct decision to retain `mkdtemp(tmpdir())` therefore cannot stop
the enclosing runner deleting its evidence. This follows the documented
[Node temporary-directory behavior](https://nodejs.org/api/os.html#ostmpdir).

An explicit recovery manifest could list exceptions for the outer disposer,
but every nested disposer would need to parse and safely honor those paths.
The selected protected namespace removes that shared recursive-ownership
conflict. The outer runner creates a unique directory under
`~/.cache/vietnam-accomodation-search/qa-recovery`; children inherit
`VAC_QA_RECOVERY_DIRECTORY`. Nested runners reuse it and do not own its
deletion. The outer runner removes it only when empty. Each acquired resource
gets an exact, private recovery subdirectory, registered before its external
disposers so cleanup runs first. Ordinary fixtures remain disposable.

An explicitly configured recovery namespace or browser `temporaryRoot` must
be a private durable path outside every enclosing disposable TMPDIR. Tests
use a self-authored parent that is removed only after exact simulated recovery.
This does not authorize recursive removal of a shared cache or arbitrary path.
Directories are created with mode 0700 and ownership journals keep their
existing mode 0600. Reports count retained directories without exposing their
paths or contents. A hard-killed child can leave evidence even if its retention
callback never runs; the empty-only namespace disposer preserves it.

Caller coverage:

- `issue-177-docker-acceptance.mjs`: image ledger and mounted smoke data remain
  available while an owned container/image may still need recovery.
- `issue-208-docker-guest-capacity.mjs`: exact owner lock plus helper and image
  journals survive failed teardown; two clean-cache attempts remain intact.
- `revalidation-qa-docker-cleanup.mjs`: all six real cleanup modes use the same
  protected-directory contract.
- `revalidation-qa-cleanup-live.mjs`, `revalidation-native-update-client-sharing.mjs`
  and `telegram-real-source-workflow-e2e.mjs`: separate message ownership journals
  from disposable application data. The real-source cleanup callback is
  registered after its directory so ledger cleanup precedes directory deletion.
- `qa-browser.mjs`: a failed browser close keeps its exact profile outside the
  wrapper's TMPDIR. Successful close, failed launch and normal cancellation
  still delete the profile.
- Cutover `.deploy` journals, bot-conversation/capability private-log journals
  and the default storage-heavy lock already live outside disposable TMPDIR;
  their retention and exact recovery protocols are preserved.

`teardownVerified` remains the compatible temporary-directory result.
`temporaryTeardownVerified` makes that scope explicit. A retained journal
reports `externalTeardownVerified: false` and `recoveryRequired: true`, keeping
exit failure. With no retained journal, external verification is `null` because
the wrapper has no independent external oracle. Exact recovery must verify
the ownership/baseline before removing the specific retained directory; never
delete a lock merely because its PID appears stale.

### Shared-token preflight

The previous drill acquired the capacity guard first. On Docker Desktop that
starts a real BusyBox helper. The later Docker baseline therefore included
that helper when the unchanged shared-token guard required zero pre-existing
containers. The issue's independently empty starting inventory was consistent
with this ordering defect.

One alternative is an exact token/ID helper exemption checked against a
separate inventory. That adds identity reconciliation and could accidentally
exclude a competing poller. The selected implementation captures the complete
inventory and applies the existing fail-closed token boundary before helper
acquisition. Later `QaDockerCleanup` still captures its post-helper baseline.
A separately registered audit runs last, after helper/image/lock teardown,
and compares the complete early baseline. All competing containers, including
a spoofed helper name, remain rejected. Low-capacity and partial-bootstrap
failures still trigger existing exact disposal and preserve failed evidence.

### Independent field review

The previous gate scored six fields. Two required fields, `billingScope` and
`currency`, were absent from both the blank label template and measurements.
It also accepted perfect positive-only labels, so no negative examples were
required to assess false positives. Dedicated tests demonstrated both false
acceptances before the implementation changed.

The gate now scores all eight required fields and records positive/negative
label counts. Every field needs both kinds of evidence and the existing
precision/recall thresholds. Scope and currency use the existing price-field
thresholds, 0.98 precision and 0.90 recall; these are software gate defaults,
not a new zero-error or statistically exhaustive claim. Scope is predicted
as `whole-property`, `unit`, `person` or unknown from the stored quote basis;
quote basis separately distinguishes bedroom, bed and room. Currency is the
stored quote currency. Label authors must determine each from native material,
not copy predictions or derive count truth from price arithmetic.

An old six-field label file fails closed until independently extended; it is
not silently given parser-generated labels. `status` reevaluates retained
observations under the current schema. Prior failure evidence remains intact.

## Online research and existing components

| Primary source/component                                                                                                                                | What it can supply                                                      | Decision or integration plan                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Node filesystem API](https://nodejs.org/api/fs.html#fspromisesmkdtempprefix-options)                                                                   | Unique directories and exact empty-directory removal.                   | Use built-in `mkdtemp`/`rmdir`; no new dependency. An outer recursive remover must never own retained descendants.                                                                             |
| [Node child processes](https://nodejs.org/api/child_process.html)                                                                                       | AbortSignal cancellation and child process lifecycle events.            | Preserve signal cancellation and await child close; register escalation before waiting so interrupted children cannot block the wrapper indefinitely.                                          |
| [node-tmp](https://github.com/raszi/node-tmp)                                                                                                           | Temporary object ownership, optional retention and graceful cleanup.    | Its retention cannot prevent a parent recursively deleting its TMPDIR. A durable namespace is still necessary; keep the existing small cleanup scopes.                                         |
| [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile)                                                                                   | Atomic directory locks and mtime-based stale-lock detection.            | Useful for ordinary coordination, but stale reclamation cannot certify external Docker teardown. Retain the existing exact token and fail-closed recovery lock.                                |
| [Docker object labels](https://docs.docker.com/engine/manage-resources/labels/)                                                                         | Exact run ownership discovery on supported Docker objects.              | Reuse existing unique QA labels and journals; labels alone do not authorize excluding arbitrary containers from the token boundary.                                                            |
| [Docker image removal](https://docs.docker.com/reference/cli/docker/image/rm/) and [builder management](https://docs.docker.com/build/builders/manage/) | Remove owned tag references and specific builders.                      | Keep existing tag-based image cleanup, shared-image preservation and exact builder ownership. Verify complete baseline afterwards.                                                             |
| [Docker pruning](https://docs.docker.com/engine/manage-resources/pruning/)                                                                              | Broad unused-resource reclamation.                                      | Unsuitable for this requirement because unrelated unused resources may belong to another workload. Do not add pruning.                                                                         |
| [Testcontainers for Node](https://node.testcontainers.org/features/containers/)                                                                         | Container lifecycle, labels and automatic resource reaping.             | An optional future test harness; introducing another helper/reaper does not establish this repository's image/cache/builder baseline or durable journal contract. Reuse existing cleanup APIs. |
| [Telegram RPC errors](https://core.telegram.org/api/errors) and [mtcute error handling](https://mtcute.dev/guide/intro/errors)                          | Provider retry delays and SDK typed errors/short-wait handling.         | Resume after the actual mandated cooldown with the same identity. Above-bound waits remain incomplete; no early retry, identity rotation or fake completion.                                   |
| [Label Studio review](https://labelstud.io/guide/labeling) and [prediction integration](https://labelstud.io/guide/ml.html)                             | Optional self-hosted human annotation workflow.                         | Import only the existing prediction-free review pack; omit predictions and prelabels to preserve blindness. Keep account bodies/media private. Human independence remains an attestation.      |
| [Tesseract](https://tesseract-ocr.github.io/tessdoc/)                                                                                                   | OCR extraction from native rental photos; already used by the software. | Keep OCR outcomes and native media reconciliation separate; independent reviewers must assess extracted values and failed/unreadable photos. OCR output is not ground truth.                   |
| [scikit-learn model evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html#precision-recall-f-measure-metrics)                       | Standard precision/recall and confusion accounting definitions.         | Reuse the JavaScript scorer, expose TP/FP/FN/TN and both label classes; do not add a Python runtime merely for these ratios.                                                                   |
| [Playwright browser contexts](https://playwright.dev/docs/browser-contexts)                                                                             | Isolated browser contexts and explicit lifetime management.             | Reuse the existing persistent-profile ownership helper, with protected failure retention. No browser access-control bypass or original profile inspection.                                     |

## Reproduction and validation

Before changing the implementation, the issue's original counterexamples were
run and saved locally:

```sh
node scripts/test-with-cleanup.mjs node experiments/revalidation-nested-recovery-journal.mjs
node scripts/test-with-cleanup.mjs node experiments/revalidation-cutover-capacity-boundary.mjs
```

The first showed external cleanup failure, missing retained journal and temporary
teardown success. The second showed the owned capacity helper rejected as a
pre-existing container. Both are now positive regression controls. The nested
control also restores its exact self-authored marker, verifies its absence and
removes the retained journal. No account, Docker daemon or unrelated resource
is involved in those original counterexamples.

New automated regressions:

- `tests/issue-214-recovery.test.js`: two nested strict wrappers around marker,
  image, guest and browser failure/recovery, exact unrelated baseline preservation,
  plus ordinary success/setup/assertion/SIGINT/SIGTERM cleanup. The image case
  calls `QaDockerCleanup.restore`; guest calls real bootstrap/guard/recovery APIs
  against the finite daemon model. The browser case failed before the placement
  fix with ENOENT on independent journal readback. Node-only subprocess controls
  run in the Node platform matrix; Deno/Bun run portable ownership/gate controls.
- `tests/issue-215-cutover-boundary.test.js`: helper acquisition ordering, actual
  guard/bootstrap orchestration, competing and spoofed containers, partial
  preflight failure and independent final-inventory failure.
- `tests/issue-217-review-fields.test.js`: erroneous/missing scope/currency,
  positive-only labels and person/unit/property scope prediction. These
  self-authored structural labels never supply live acceptance truth.

Focused controls pass. The final Node coverage suite passed 1,523 tests with
100% source line coverage. The initial full Node suite passed 1,517 tests before
the final field/browser additions. Bun passed 1,523 tests. Deno passed 1,408 tests
with 19 steps and 11 ignored tests under its existing read-only permissions.
Every wrapper reported no temporary residue or retained recovery directories.
Lint (zero warnings), formatting, duplication, syntax, file-size and patch
changeset checks passed. Final CI checks are recorded in the PR. Validation
includes the existing owner, quota, pagination, native-media,
pricing, cleanup, release and production behavior tests, rather than replacing
them with the new controls.

The finite installed Chrome ownership control independently verified profile
and matching-process absence and unrelated-resource preservation in all five
modes (success, launch/navigation failure, SIGINT and SIGTERM). Its strict
wrapper still exited failure because Chrome left two background-download
directories in the wrapper's owned TMPDIR. The wrapper removed that exact root
and verified temporary teardown, with no retained recovery directories. These
runtime leftovers are not whitelisted. A candidate setting Chrome's TMPDIR
inside its profile failed the launcher control and was discarded; the existing
browser launch environment is preserved. This is component ownership evidence,
not a passing full strict Chrome run.

The actual local Docker guest experiment was attempted once through the strict
wrapper. The daemon rejected `docker start` because nested cgroupv2 domain
controllers are in an invalid state. The experiment exited failure and
independently reported `dockerBaselinePreserved: true`; temporary cleanup
completed with zero retained journals. This is failed real guest execution with
successful exact teardown, not successful guest capacity or original macOS
acceptance. Repeating image builds cannot fix that host constraint. Existing
CI image jobs run the actual guest/image controls on provisioned runners.

The initial branch CI run [38204753263](https://github.com/konard/vietnam-accomodation-search/actions/runs/38204753263)
at placeholder SHA `afb981e` failed only its changeset gate. Its complete logs
were saved to `ci-logs/checks-38204753263.log`: line 5741 reports “No changeset
found in this PR”; line 15096 identifies `changeset-check` as the failed job.
A patch changeset now supplies the release trigger. Final CI is checked against
the final commit timestamp and SHA, not this stale placeholder run.

## Original-host execution handoff and remaining gates

The checkout has no original bot/user environment, original deployment records,
original frozen cohort/checkpoints or independent live label packs. No secret
values were read or printed in checking their availability. No original
configuration, credentials, session, deployment history or failed private
evidence was modified. This Linux workspace is not the original macOS host.

The original local QA agent can use the existing tools in this order:

1. With the original operator authority, run the existing owner setup against
   the selected original environment file. Verify original-owner policy,
   privileged command execution and unrelated-recipient rejection separately.
   Publish finite booleans; retain all private identifiers locally.
2. Capture full Docker inventory before any helper. Run the repaired cutover
   drill with bot/user identity pins, independently verified existing peer,
   all requested transitions and original guard bounds. Compare the complete
   starting inventory immediately on exit before another resource experiment.
3. Respect the saved provider cooldown, then resume the same frozen cohort
   and 90-day audit state with `TELEGRAM_HISTORY_AUDIT=1`; perform latest catchup
   through native ingestion. Keep incomplete source/media/OCR outcomes explicit.
4. Run `source-acceptance.mjs collect --all --env-file ... --output ...` with
   private durable paths. Do not overwrite the original failed evidence;
   retain new attempts with their own provenance and frozen-window references.
   Independently review every required native/collected material and all eight
   fields in the blank review files, with positive and negative examples.
   Run `review --observation ... --labels ...` and then inventory-wide `status`.
5. Use the original real-source workflow, installed binary backend and native
   eligible photo candidate for fresh store/graph/media readback, actual photo
   receipt and restart verification. Verify scoped same-unit pricing/ranking
   against independently labelled counts, billing scope, quote basis, period
   and currency. Do not seed a synthetic offer to make the selector pass.
6. Stop every owned producer, delete/read back exact marked messages, close
   owned browsers, remove exact Docker acquisitions and compare baselines.
   Release owned temporary tools only after consumers finish. If disposal
   fails, preserve the corresponding recovery directory and use the existing
   exact restoration API before deleting its journal/lock.

Original owner configuration and live original-host acceptance are still
unfulfilled here. There is no new all-source completion, independently measured
live field accuracy, original-host cutover success, globally cheapest result
or zero-error claim. These are explicit limits of the environment and evidence,
not claims that the issues were already resolved.
