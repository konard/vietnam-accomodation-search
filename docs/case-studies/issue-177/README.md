# Issue 177 implementation and acceptance

[Requirements, alternatives and plans](requirements.md) covers all ten child
issues and their comments. [Dependency inventory](dependencies.json) records
public registry tags for every package in both npm lockfiles.
[Corpus metrics](metrics.json) separates the preserved human bedroom labels
from independent room/bed labels in the self-authored controls.

## Changes and reproduction

- Property totals and bedroom, room and bed comparisons share one calculator
  across the API, CLI, bot and saved presets. Prices quoted per person or per
  unit cannot qualify as property totals. Positive exact denominators, original
  quotes, selected variant, FX provenance and optional stay estimates are shown.
- Exhaustive source mode retains the entire catalogue, canonicalizes native
  identities, includes disabled/retired entries in reports, and removes ranked
  cohort caps from collection and updates. Freshness, parsing, pagination and
  review evidence are independent; every outstanding source is named.
- Legacy `expected.rooms` truth was actually bedroom truth. Its values are
  preserved under `bedrooms`; independent room/bed and calculated cost labels
  are scored only where present. Existing live samples do not establish new
  room/bed accuracy.
- Native photo lookups shared across sources previously reached concurrent
  lookup count 10 in the finite control. The shared queue now limits that count
  to 1, coalesces requests, reuses resolved media, observes flood waits, propagates
  deadlines and resumes durable OCR/download retries after restart.
- Error pages with rental cards previously qualified as success. The actual
  browser control uses identical card bodies for 200, 202, 404, 502 and 503;
  only 200 now qualifies, while 202 remains pending.
- Conversation and deployment harnesses register owned sends and Docker
  resources before side effects, stop producers before deletion, and verify
  paged history/resource inventories independently. Ownership journals support
  recovery after ambiguous sends and process loss. Unrelated history, images,
  caches and data are preserved.
- All automatic suites use a private TMPDIR and fail on fixture residue.
  Browser diagnostics and bounded storage probes dispose their own resources.
  clink capability probes remove their disposable parent, including retired
  failed siblings, while real diagnostic/state retention remains intact.
- Safe command-stream 2.0.2 replaces the temporary 1.5.0 exception in the root,
  browser override and release bootstrap. browser-commander is 0.29.0. The
  original upstream security issue is closed; the clean consumer and repository
  production dependency audits report zero vulnerabilities.

Minimal regressions are in `tests/issue-177-*.test.js`. The core regressions failed
before the fixes for independent bedroom ceilings, metric truth, HTTP status
priority and failed clink probe retirement. Native media controls cover shared
lookups, flood waits, deadline cancellation, deferred retry and restart reuse.
QA controls cover pre-send ownership, lost acknowledgements, full pagination,
foreign owner protection, cleanup failures, signals and durable journals.
The bounded quote-scanning worker reproduces the CodeQL input with 131,072
digits, a 32 MiB worker heap and a five-second deadline. It failed before the
linear scan and now completes within the deadline without claiming a unit quote.

## Reusable verification

Local checks against the committed implementation completed on 2026-10-11:

| Check                                          | Result                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Node with required real clink                  | 1,396 passed; zero failures or skips; 100% product line coverage                        |
| Bun                                            | 1,396 passed; zero failures                                                             |
| Deno, ordinary frozen lock                     | 1,279 passed plus 19 steps; zero failures; 11 documented ignored tests                  |
| Strict suite cleanup                           | Empty fixture TMPDIR and independently verified disposal in all three runtimes          |
| Dependency audits                              | Zero vulnerabilities in both repositories and a clean production consumer               |
| Release, shell, SQLite and browser conformance | 62 passed                                                                               |
| Real browser HTTP control                      | Identical rental cards classified correctly for 200, 202, 404, 502 and 503              |
| Disposable Docker cleanup                      | All six success, failure, signal and hard-kill recovery controls restored the baseline  |
| Repository checks                              | Lint, formatting, duplication, syntax, required docs, line limits and changesets passed |
| Example web build                              | Passed                                                                                  |
| Repository link check                          | 219 valid references; zero errors; existing path exclusions retained                    |

```sh
REQUIRE_REAL_CLINK=1 npm run test:coverage
npm run test:cleanup
REQUIRE_REAL_CLINK=1 node scripts/test-with-cleanup.mjs bun test --timeout 30000 tests/
node scripts/test-with-cleanup.mjs deno test --frozen --allow-read tests/
node experiments/revalidation-unit-value-metrics.mjs
node experiments/issue-177-browser-http.mjs
QA_DOCKER_CLEANUP=1 node experiments/revalidation-qa-docker-cleanup.mjs
QA_DOCKER_ACCEPTANCE=1 node experiments/issue-177-docker-acceptance.mjs
node experiments/issue-177-dependency-inventory.mjs
node --max-old-space-size=64 experiments/issue-177-quote-scan.mjs
npm run check
npm audit
npm --prefix examples/universal-app audit
npm run example:web:build
```

Install the pinned clink executable on PATH to execute required storage
integration controls. Browser checks use installed Playwright Chromium, or an
explicit `CHROMIUM_EXECUTABLE_PATH`. Docker controls create isolated builders
and populate their caches; success, setup/assertion failure, SIGINT, SIGTERM and
actual SIGKILL journal recovery must restore the original inventory. They never
run global prune. A failed resource cleanup retains its private recovery journal.
Set `QA_DOCKER_DEBUG=1` for sanitized Docker disposal error tracing; it is off
by default.

The first real production image passed its Chromium, Tesseract, native SQLite,
provider and fresh clink smoke checks. Its initial 10-second wrapper disposal
bound expired; exact owned-resource recovery restored the baseline. Docker
acceptance has a separate disposal bound and preserves its recovery directory
until independent verification succeeds.

## CI investigation

The logs for the pushed `5cd878d` candidate were downloaded before fixes:

- Checks run `38102451449`, log lines 37387–37424: two Windows Node signal
  controls failed with `null !== 1` at `tests/qa-cleanup.test.js:44`. Windows
  child.kill force-terminates the process. The controls exercise the installed
  handlers via IPC there and both IPC and real OS signals on POSIX.
- CodeQL review at `src/value-pricing.js:19`: uncontrolled repeated digits
  triggered polynomial backtracking. The bounded worker failed its deadline
  before the fix; a first-digit search followed by one suffix scan passes it.
- Link run `38102451557`, second-attempt log lines 289–307: GitHub blob URLs
  returned 503, while all 19 distinct reported URLs passed the local Lychee
  check. Four concurrent requests and spaced retries reduce remote bursts;
  HTTP failures remain failures rather than accepted or ignored statuses.

The production image also restored its complete Docker baseline while Buildx
reported a builder-removal failure. Exact journal recovery passed. Buildx's
shared status deadline covers shutdown and populated-cache removal; cleanup
now quiesces only the owned builder separately before removal, with an injected
sequencing regression and optional sanitized acceptance tracing.

Deno lock regeneration used the one-time `--min-dep-age=0` opt-in for the newly
published safe release. Ordinary tests use the frozen lock and normal age policy.
Run Deno after the Node/Bun suites: its automatic npm layout installation must
not modify dependencies underneath a running suite. Manual npm layout mode
does not resolve all SDK TypeScript references in this repository.
Transitive latest-tag differences are reported, including older versions required
by parent packages; a tag difference alone does not establish compatibility or
vulnerability. Production Node remains the pinned 24.21.0 LTS container runtime.

## Acceptance limits

No owner-pinned live Telegram credentials were supplied in this workspace.
Therefore owner conversation, real-source notification/restart, native live
photo/OCR and cutover acceptance remain unexecuted. Deterministic SDK, queue,
OCR engine, storage, cleanup and real browser/container checks are separate
from that credential-dependent evidence.

The exhaustive inventory does not claim every source is currently fresh,
accessible, fully paginated or human reviewed. Unverified web pagination and
missing current human room/bed truth remain explicit outstanding evidence.
Blocked and challenged sources stay visible; collection never bypasses access
controls or contacts landlords. Self-authored unit labels cannot substitute for
new human review of live listings. Global cheapest/best claims remain unverified.
