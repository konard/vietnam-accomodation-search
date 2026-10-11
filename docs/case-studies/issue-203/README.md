# Analysis and implementation of all seven issues in #203

This report accompanies [PR #204](https://github.com/konard/vietnam-accomodation-search/pull/204).
The issue bodies and every comment were read, including the re-opened live
acceptance requirements. Related merged PRs #196 and #178 and the fresh
`d734300`/`4c42d16` QA commits were examined. Implementing a gate is distinct from
passing that gate. This PR does not certify production/global-best readiness.

## Complete requirement inventory and solution plans

Each row includes requirements from the issue body and its comments. “Existing”
means already present in the base, not a new fix. Live requirements that cannot
be completed in this container are explicitly identified; no reviewer labels,
identity attestations, initial failure cause or shared-host recovery are invented.

| Issue | Requirement                                                                                    | Possible solution and selected plan                                                                                                                         | Verification / outcome                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| #203  | Read all seven issues and comments                                                             | Fetch issue details and paginate comments separately; inspect all three PR comment/review endpoints                                                         | Completed; comments are reflected below                                                                                                         |
| #203  | Single PR, no separate implementation PRs                                                      | Work only on the prepared branch and update PR 204                                                                                                          | All changes in this PR                                                                                                                          |
| #203  | Closing keyword for parent and each child, verbatim child block                                | Put eight separate `Fixes` lines in the final PR body                                                                                                       | PR description                                                                                                                                  |
| #203  | Explicitly identify already fixed/nonreproducible items, retain references                     | Distinguish existing repairs from newly reproduced bugs and live limits                                                                                     | #199 and most of #201 already repaired in base; remaining coupling reproduced                                                                   |
| #183  | Live source-by-source resumable acceptance                                                     | Reuse the existing manual `source-acceptance.mjs` and durable web/native checkpoints rather than another crawler                                            | Actual public web collection; private per-source observations and review packs                                                                  |
| #183  | Explicit full pagination                                                                       | Follow recognized next links to terminal evidence with bounded resumable slices; a lawful provider API is an alternative only when available/authorized     | Consecutive numbered links fixed; custom Alonhadat/Homedy containers verified live; unsupported controls remain incomplete                      |
| #183  | Native history and 90-plus-day accounting                                                      | Use existing native ingestion checkpoints; text replay alone does not substitute for native acceptance                                                      | Existing text evidence remains historical, fresh native run unavailable without supplied inputs                                                 |
| #183  | Complete native photo-only OCR and human review                                                | Preserve distinct history/OCR/upload/review flags; use private material packs and genuinely independent media review                                        | No live session or independent review provided here; incomplete                                                                                 |
| #183  | Independent live bedroom, room, bed labels                                                     | Keep reviewer labels separate from predictions and require explicit independence/blinding attestations                                                      | Existing gate rejects absent/self-authored review; no labels manufactured                                                                       |
| #183  | Independent billing basis and period truth                                                     | Score `quoteBasis` and `period` separately alongside counts                                                                                                 | Existing gate and tests retained; live truth remains unmeasured                                                                                 |
| #183  | Measured false positives/negatives                                                             | Report TP/FP/FN/TN and precision/recall against independently labeled material, including positive/negative cases                                           | Existing metrics retained; fixture tests are structural evidence only                                                                           |
| #183  | Honest inaccessible-source exclusions                                                          | Record challenge, unavailable native credentials and other degraded outcomes per source                                                                     | Actual run preserves exclusions; excluded sources remain incomplete                                                                             |
| #183  | Lawful API/fallback or explicit incompleteness; no access-control bypass                       | Use documented existing APIs/browser routes only; do not circumvent challenges or enable inaccessible private sources                                       | No challenge bypass or fabricated provider endpoints                                                                                            |
| #183  | Do not claim all-source/global cheapest/best based on partial evidence                         | Keep `globalOptimality: unverified` even if a subset passes                                                                                                 | Retained in collection/status/review                                                                                                            |
| #193  | Configure original approved private owner/user/chat                                            | Reuse private operator, derive numeric identity from supplied session, write owner-only settings atomically with mode 0600                                  | Existing workflow plus repaired resolver; original configuration absent here                                                                    |
| #193  | Actual privileged command under original configuration                                         | Run existing owner-only conversation acceptance after configuration, while retaining original policy; a mocked handler only proves code behavior            | Registered-handler control passes; actual original conversation cannot run without original supplied inputs                                     |
| #193  | Reuse existing identity/session, no second identity/session demand                             | Derive `getMe` locally from existing native/legacy session; never export/revoke/replace it                                                                  | No new identity requested or session altered                                                                                                    |
| #193  | Keep public closed and unrelated recipients unauthorized                                       | Preserve approved IDs, append only verified owner, force private mode; reject malformed IDs/pin mismatch                                                    | Existing negative authorization tests retained                                                                                                  |
| #193  | Never publish IDs, secrets, original env/deployment records                                    | Safe counters only; private env remains outside Git; keep concurrent-edit protection                                                                        | No real private inputs committed                                                                                                                |
| #198  | Restore supported legacy API ID/hash names                                                     | Share canonical/legacy normalization across production resolver, composition root, owner operator and QA consumers                                          | Original finite reproducer changes from failure to pass                                                                                         |
| #198  | Secret files and conflicts                                                                     | Accept either supported name or its `_FILE`; reject multiple competing representations before any secret file read                                          | New no-network conflict/file tests                                                                                                              |
| #198  | Owner pins for both original and supplied session                                              | Compare original and `--user-env` pins before deriving; apply supplied pin in native and legacy authentication; preserve original post-auth check           | Fail closed for conflicting/mismatching pins                                                                                                    |
| #198  | Keep session, private-only access and unrelated-user rejection                                 | Reuse session exactly and existing private policy; do not convert/export/revoke                                                                             | Existing and new owner/authorization tests                                                                                                      |
| #198  | Validate actual supplied legacy session, configure original owner and rerun privileged command | Use repaired operator with original private files and existing conversation tooling                                                                         | Supplied credentials/configuration absent; live acceptance explicitly incomplete                                                                |
| #199  | Safe bounded operation/category/error diagnostics on failed rows                               | Central whitelist-based diagnostic helper; inspect bounded private stderr only for category; expose no raw text/argv                                        | New tests for I/O, capacity, acquisition, timeout and arbitrary metadata                                                                        |
| #199  | Do not expose resource IDs, paths, registry credentials or unrelated state                     | Fixed operation names, safe exit/errno/signal values; no exception messages or raw stderr in reports                                                        | Adversarial self-authored strings excluded from JSON                                                                                            |
| #199  | Preserve unchanged assertions and original failed result                                       | Keep six outcome predicates and populated-cache checks; do not rewrite historical report                                                                    | Original failed cause remains unisolated                                                                                                        |
| #199  | Rerun actual populated-cache six exits                                                         | Existing success/setup/assertion/SIGINT/SIGTERM/actual-SIGKILL recovery harness with capacity coordination                                                  | Actual run recorded separately from initial failure                                                                                             |
| #199  | Green rerun must not claim root-cause isolation                                                | Label later run independently; nested cleanup and worker failures retain original safe cause                                                                | Original cold-failure root cause remains unknown                                                                                                |
| #200  | Fail-closed bounded host capacity preflight/monitor                                            | Built-in `statfs` on working/temp/Docker storage roots; 8 GiB preflight, unchanged 2 GiB floor, one-second monitoring                                       | Finite doubles reject low/unreadable/invalid/stalled capacity; each query has a five-second bound                                               |
| #200  | Coordinate/serialize storage-heavy acceptance                                                  | Shared atomic directory lock, independent of test runner TMPDIR; busy rejection instead of concurrent heavy work                                            | Image, six-exit Docker, native workflow, retained replay, source gate, deployment drill and older native/browser/live-search audits participate |
| #200  | Stop owned producers on low space                                                              | Propagate combined abort signal to collection/ingestion/build/deploy; wait for producer close before cleanup, bounded SIGKILL escalation for spawned builds | Acquired-producer fault control verifies stop-before-delete                                                                                     |
| #200  | Remove acquired resources on guarded failure                                                   | Use existing exact QA scopes, Docker labels/builders/images and ownership journals                                                                          | Finite doubles verify exact producer removal and unrelated-state preservation                                                                   |
| #200  | Preserve exact recovery journals, no global prune/reset/cache deletion                         | Failed cleanup retains private run directory and heavy-run lock; SIGKILL leaves lock for explicit journal recovery                                          | No global cleanup; lock is never silently stolen                                                                                                |
| #200  | Real shared Docker recovery must be explicit                                                   | Restore only the original exact journal on the original host; storage repair outside that ownership is an operator action                                   | Original host/journal absent; a healthy local daemon does not prove recovery of that host                                                       |
| #200  | Concurrency is not proof of I/O cause; no unsupported image/cutover acceptance                 | Report independent guard and image checks with limits                                                                                                       | No historical I/O root-cause claim                                                                                                              |
| #201  | Resource-specific inventory in each cleanup phase                                              | Existing builder/image-specific queries; also fix project-image discovery, which still queried full inventory                                               | New network-inventory fault reproduces leftover project image before fix                                                                        |
| #201  | Continue subsequent phases after errors                                                        | Retain per-phase error capture and exact deletion; stop builder before removing cache                                                                       | Existing independent fault tests plus new regression                                                                                            |
| #201  | Exact owned builder deletion, baseline builders untouched                                      | Target only journal-owned names and protect baseline resources                                                                                              | Existing no-network builder fault test retained; actual populated-cache run                                                                     |
| #201  | Final full-baseline verification must fail while images unavailable                            | Do not downgrade final inventory to a partial check                                                                                                         | Existing image-failure regression still reports false                                                                                           |
| #201  | Keep journal until cleanup verified, no global prune                                           | Retain failed-run directory and exact ownership journal                                                                                                     | Existing behavior retained; original-host recovery not claimed                                                                                  |
| #201  | Independently verify real previously failed cleanup recovery                                   | Use original journal on original host and fresh full inventory                                                                                              | Not reproducible here: original journal/host unavailable                                                                                        |
| #202  | Explicit production recording policy; default off or managed bounded storage                   | Choose explicit `debug:false` for both launcher and commander instead of persisting unnecessary raw captures                                                | Common production helpers cover collector, discovery and self-check                                                                             |
| #202  | No default recording outside DATA_DIRECTORY/read-only `/app`                                   | Disable automatic recordings even if host debug environment enables them                                                                                    | Actual production launcher/commander control checks trace paths and checkout inventory                                                          |
| #202  | All QA consumers own/clean recordings; requested evidence separate                             | Add explicit opt-out to all direct QA/preview consumers; retain explicit requested private traces; intentional reproducer owns its temporary cwd            | Repository-wide callsite search, real browser control and cleanup audit                                                                         |
| #202  | Verify no writes outside owned roots; keep latest dependencies                                 | Keep browser-commander 0.30.1 and command-stream 2.1.0; own Chrome temp artifacts; ignore accidental trace folder as additional staging protection          | Actual dependency used; no downgrade                                                                                                            |

## Root causes and scope across the codebase

Live public DOM inspection found consecutive numbered links without an explicit
next-link selector. The extractor previously recognized numbered terminal pages
but never selected the next number. It now follows only `current + 1`, preserving
gaps as incomplete, and uses the observed Alonhadat/Homedy pagination containers.
An enabled JavaScript next button also prevents false terminal certification.
These changes apply to every browser consumer of the shared extractor.

The production resolver only understood canonical API names while QA understood
legacy aliases. Shared normalization now covers inline composition, async secret
resolution, private operator, conversation driver, real-native workflow, retained
audit helper and release evidence assembler. Canonical/legacy values/files compete for the same logical credential;
ambiguous combinations are rejected instead of silently selecting an identity.
The synchronous application API still resolves inline values only; callers using
secret files use async preflight/resolution and inject `telegramCredentials`.

The private owner CLI previously discarded the supplied environment's identity
pin on its legacy path. Both environment pins are now compared, and the selected
pin follows the session through native/legacy owner derivation. Existing original
file checks remain, including private mode, approved allowlists, mode 0600 and
concurrent-edit rejection.

Browser Commander 0.30.1 records both launches and commanders by default; fixing
only the commander would leave launch-time recording enabled. `launchSettings`
and `openCommander` set `debug:false`, including when host debug is enabled.
All direct QA/preview calls follow that policy. The intentional upstream-default
reproducer remains opt-in inside its own temporary cwd. Explicit Playwright QA
traces are still separately owned by the evidence workflow.

The base had repaired builder deletion and added basic diagnostics, so the exact
original no-network #201 bug is already resolved. Project image discovery still
called `dockerInventory`, coupling it to network/container/builder failures.
A newly failing regression demonstrates missed owned images; discovery now queries
only images. Full final verification still queries every resource and fails if
any inventory is unavailable.

The six-exit Docker report now uses finite whitelisted diagnostics, including
nested errors when teardown also fails and IPC failure metadata from the actual
SIGKILL worker. Raw stderr is only inspected for a category, never emitted in a
row. Earlier unexplained cold acquisition evidence is left intact.

Storage guards coordinate participating heavy commands across checkouts using a
shared per-user host lock, not each test runner's distinct TMPDIR. An explicit
`QA_HEAVY_LOCK_DIRECTORY` can coordinate a shared multi-user host. They fail on
busy locks, unreadable capacity, less than 8 GiB at acquisition, or less than
2 GiB during execution. A failed producer disposer retains the lock for explicit
recovery, and initial Docker inventory happens before creating a recovery directory
so inventory rejection cannot orphan an unjournaled directory. Owned clink
projections receive the capacity abort and quiesce before cleanup. A remote Docker
root without locally readable capacity is rejected. This is a safety floor, not a prediction of total build size or
control over unrelated host processes; capacity can fall between samples.
The older retained Telegram audit (including its diagnostic wrapper), explicit
browser evidence audit and live search audit also participate. Their owned
clients, OCR, projections and browser search receive the capacity abort; private
retained checkpoints and requested evidence remain available after rejection.

## Existing components and additional online research

Research was checked on 2026-10-11 using primary documentation and the actually
installed pinned dependency source. No new runtime dependency is needed.

| Component                                                                                                                                             | Relevant capability and decision                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Browser Commander capture/debug documentation](https://github.com/link-foundation/browser-commander/blob/main/docs/capture-and-debugging.md)         | Documents automatic sessions, explicit `debug:false`, and owned output directories. Choose opt-out for production. Installed 0.30.1 README and `traces/debug-session.js` independently confirm launcher and commander behavior.                   |
| [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)                                                                             | Existing explicit trace bundles support private human inspection; automatic recording need not be enabled to retain requested QA evidence.                                                                                                        |
| [Node filesystem `statfs`](https://nodejs.org/api/fs.html#fspromisesstatfspath-options)                                                               | Reports filesystem blocks and user-available blocks; use bigint multiplication for capacity rather than host free-memory claims. Built-in support avoids a disk-space package.                                                                    |
| [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile)                                                                                 | Existing library uses atomic mkdir and heartbeat/staleness policy. A viable option for distributed hosts; choose a small built-in fail-closed lock here because stale heavy-run ownership must be explicitly recovered, not automatically stolen. |
| [Docker Buildx stop](https://docs.docker.com/reference/cli/docker/buildx/stop/) and [remove](https://docs.docker.com/reference/cli/docker/buildx/rm/) | Exact builder stop/removal are supported independently of global image inventory. Keep targeted cleanup; no prune/reset.                                                                                                                          |
| [Docker build options](https://docs.docker.com/reference/cli/docker/buildx/build/)                                                                    | Existing isolated docker-container builder and cache ownership cover the actual image controls. Buildx does not establish this host's free-space safety by itself.                                                                                |
| [mtcute sign-in](https://mtcute.dev/guide/intro/sign-in) and [storage](https://mtcute.dev/guide/topics/storage)                                       | Reuse existing authenticated session and `getMe`, validate owner pins, destroy clients. Do not demand/export/revoke another session. Legacy supplied-session derivation continues using existing teleproto compatibility tooling.                 |
| [Telegram APIs](https://core.telegram.org/api)                                                                                                        | Native API is an existing lawful channel for authorized media/history; Bot API health alone does not prove user history or private-command authorization.                                                                                         |
| [scikit-learn evaluation documentation](https://scikit-learn.org/stable/modules/model_evaluation.html#confusion-matrix)                               | Standard confusion counts and precision/recall support extraction acceptance. Reuse the existing small JavaScript scorer rather than add Python. An annotation UI is an optional human workflow, not independent evidence by itself.              |
| [Crawlee request storage](https://crawlee.dev/js/docs/guides/request-storage)                                                                         | Provides persistent request queues for browser crawlers. A viable larger replacement; retaining the existing durable LiNo checkpoints avoids another persistence layer and does not make unknown pagination controls complete.                    |
| [Label Studio labeling guide](https://labelstud.io/guide/labeling)                                                                                    | Provides text/image annotation and prediction display controls. A possible private reviewer UI; omit predictions for independent labeling and keep the current source/digest/freshness gate. The tool does not supply independent labels itself.  |

## Operational evidence and remaining limits

Local commands and exact outcomes are recorded below after validation. Full
logs stay in ignored `ci-logs/`; source material/review packs stay under private
ignored `.deploy/`. Self-authored tests are never labeled as independent live
field truth. This environment contains no supplied original Telegram env/session,
private cohort, reviewer labels or failed-host recovery journal. The absent inputs
prevent completing #193's original-configuration command, #198's supplied-session
live acceptance, #183's independent native review and #201's original-host recovery.
These limits remain explicit in the same PR; no follow-up implementation PR is
created and all required closing references are retained as requested.

### Reproducers and actual controls

- Credential alias, conflicting secret representation and recording policy tests
  failed before the fixes. The retained owner-alias experiment now reports that
  both QA and the operator recognize the same credentials; supplied session
  bytes are unchanged. Tests also reject conflicting original/supplied pins and
  verify legacy-client destruction on matching and mismatching identities.
  The offline release assembler's live-readiness check also reproduced a false
  credential-unavailable gate for legacy names; it now uses the shared resolver.
  Fixture assembly remains offline and does not read private secret files.
- A consecutive-numbered-page test failed before the shared extractor repair.
  An enabled JavaScript next control beside apparently terminal numbered links
  also reproduced a false completion claim. Both tests now pass.
- A project-image regression failed when network inventory was unavailable;
  the targeted image phase now succeeds while final full inventory still fails.
- Capacity doubles cover unreadable/invalid/stalled filesystems, low preflight,
  post-acquisition low space, simultaneous lock acquisition and failed producer
  disposal. Exact cleanup preserves unrelated files and the recovery journal;
  failed disposal retains the lock for explicit recovery.
- The retained-audit control failed before the guard because OCR acquisition
  ran first. It now rejects low capacity before OCR/native acquisition. The
  optional live-search audit also failed to honor a pre-aborted capacity signal;
  its regression now rejects before browser acquisition.
  OCR language preflight likewise rejects an aborted capacity signal before
  acquisition and waits for an acquired child to close before releasing ownership.
- `issue-203-image-baseline-failure.mjs` uses a bounded fake Docker CLI, no daemon,
  and the strict cleanup wrapper. Before: orphan recovery directory after initial
  inventory rejection. After: zero orphan directories and zero acquired producers.
- `issue-203-browser-recording-policy.mjs` uses the installed actual dependency,
  the production launcher and commander, and a self-authored page. Both trace
  paths are null even with host debug enabled; checkout inventory is unchanged,
  and the strict wrapper verifies teardown. Chrome temp artifacts are owned.
- `QA_DOCKER_CLEANUP=1 node scripts/test-with-cleanup.mjs node experiments/revalidation-qa-docker-cleanup.mjs`
  passed all six real exit controls: success, setup failure, assertion failure,
  SIGTERM, SIGINT and actual worker SIGKILL/journal recovery. Every row passed
  full baseline readback and exact cleanup; all applicable caches were populated.
  The setup-failure control intentionally exits before cache population. This is
  fresh evidence from this host, not isolation of the historical cold failure.

### Read-only live public acceptance

The actual `collect --all` run examined the registry's 70 entries: eight supported
public web routes, 40 native entries lacking a supplied session and 22 disabled
entries. The disabled entries were not fetched. Public DOM investigation covered
all eight routes and recorded only private bounded DOM evidence. Live collection
was repeated for the corrected numbered-pager routes, retaining durable cursors.
All sources still require independent review; the status command exits 1 and
reports `accepted: 0`, `incomplete: 70`, `globalOptimality: unverified`.

Before the fix, seven public routes had unrecognized pagination and one had
terminal evidence. Alonhadat now reaches four pages and 63 unique material rows;
Homedy reaches three pages and 49 rows. Nha Trang Land's existing linked paginator
reaches four pages and 40 rows. These are collection counts, not reviewed field
truth or proof of global best accommodation. Nha Trang Renting advances through
numbered pages but its first extended slice reaches the source timeout; its
216 raw rows and next-page checkpoint remain resumable. A second actual slice
resumed from that checkpoint, retaining 432 rows across 18 pages. Its checkpoint
still reports `page-budget`, and the collector reports `SOURCE_TIMEOUT`; terminal
evidence remains absent. Be Jib, Newhome, Nha Trang VN and
Yourhome remain incomplete because their current controls do not provide the
recognized linked terminal evidence. No access-control challenge was bypassed.

To complete the remaining public adapters, inspect each lawful provider's full
catalogue route/API and implement a durable action or documented cursor with
explicit terminal accounting; replay a cursor after restart and verify no page
or material is missed. An enabled JavaScript button or a featured landing page
must not be treated as an exhausted catalogue. This operational incompleteness
is retained in the same PR, not represented as solved by fixture tests.

### CI investigation

The initial failed Checks and release run was `38136651148`, created
2026-10-11T11:44:14Z for placeholder SHA `5fe9ce1`, before implementation.
The preserved log identifies `No changeset found in this PR` at line 5611 and
`Failed jobs: changeset-check` at line 14800. The patch changeset fixes that
specific failure. Final runs are checked against the final pushed SHA and their
creation timestamps; any new failures are investigated separately.

The implementation run `38138798689`, created 2026-10-11T12:19:04Z for
`7758f7b`, passed every job except the Deno matrix and its status gate.
The complete saved log shows environment permission failures at lines 21791
and 21808 (Linux), 28971 and 28988 (macOS), and 33772 and 33789 (Windows).
The new tests statically loaded an environment-dependent Telegram CLI driver
and called `tmpdir` despite Deno's existing `--allow-read` boundary. CLI/file
controls now follow the existing Node/Bun-only test boundary; pure production
credential normalization, diagnostics and pagination remain tested in Deno.
The focused read-only Deno regression run passes all 24 tests. No additional
Deno permissions or weakened production assertions were introduced.

Run `38140566812`, created 2026-10-11T12:46:45Z for `65b2909`, then passed
every test/build job except the Bun Linux dependency installation and status
gate. Attempt 1 failed before tests with `Cannot find module 'tar'` in Bun's
temporary node-gyp installation (complete log line 14913); attempt 2 failed
with a missing `semver/functions/minor.js` in the same tool tree (line 14725).
The published node-gyp 13.1.0 manifest declares both dependencies. Both
attempts also left multiple node-gyp producers for the runner to terminate.

[Bun documents concurrent lifecycle scripts](https://bun.sh/docs/pm/cli/install#lifecycle-scripts)
and a project-wide
[`install.concurrentScripts` setting](https://bun.sh/docs/runtime/bunfig#install-concurrentscripts).
The changing missing files suggest concurrent temporary tool acquisition; this
is an inference from the logs, not a proven upstream defect. Existing upstream
[issue 9699](https://github.com/oven-sh/bun/issues/9699) reports similar historical
installation failures, but does not establish this current failure's cause.
Two cold parallel/serial tool-only acquisitions in
`experiments/issue-203-bun-node-gyp-race.mjs` both pass locally, so that probe
does not reproduce the missing dependency. A separate offline lifecycle control
in `experiments/issue-203-bun-install-concurrency.mjs` does reproduce overlapping
ownership under the original configuration: default and repository installs
both overlap and the repository assertion fails. Setting `concurrentScripts = 1`
in the existing root `bunfig.toml` eliminates that overlap and covers both
runtime-matrix and release-candidate installations, as well as local installs.
Native scripts remain enabled. The actual cold Bun CI install validates whether
this targeted acquisition control also resolves the observed installation failure.

### Local validation

- `npm run check`: lint, formatting and duplication checks pass.
- Full Node source coverage run: 1,473 tests pass, 100% source line coverage.
- Full Bun run: 1,473 tests pass, zero failures.
- Full Deno run with `--frozen --allow-read`: 1,358 tests pass, 11 ignored,
  zero failures. Its owned-file/CLI controls follow the existing Node/Bun boundary.
- Strict cleanup readback reports zero unexpected leftovers and verified teardown
  for each full runtime suite and the actual browser/Docker controls.

The final expanded runtime suites and required CI run are checked on the final
commit before PR 204 is marked ready; exact final counts/status are attached to
that PR. This container's 2.92 GiB memory limit rules out repeating heavy native
builds alongside tests. The implementation CI already passed real clink 1.0.0
integration and both amd64/arm64 production image build checks; these run again
on the final commit on provisioned GitHub runners. These CI checks do not prove
the original failed host was recovered or certify a private native workload.
