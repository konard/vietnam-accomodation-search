# Local revalidation of PR #196 — 2026-10-11

## Verdict and boundaries

Production readiness remains incomplete. This fresh local run starts from
`df51105` (merged PR #196), not the previous QA commit. Closed issues are checked
against actual acceptance evidence. Application fixes remain issue-driven;
this handoff contains QA corrections and explicitly authorized dependency
updates only. Original configuration, deployment records, user transcripts and
unrelated resources are preserved.

The supplied real bot token and user session authenticate successfully.
Identities are derived from those credentials, never requested independently or
published. Public sources are read-only. Telegram writes are restricted to
the authenticated owner's bot conversation, marked and independently cleaned.
Raw source/media evidence and all SDK logs stay ignored and permission-restricted.

## Verified fixes and remaining live requirements

- The original finite latest-offer barrier now passes while the historical tail
  remains blocked. The actual native run also exposes received offers while its
  history checkpoint is incomplete. The initial full native traversal later
  aborts at its unchanged host disk-safety floor while still ingesting; actual
  OCR has completed, but final readback/photo delivery is not reached.
- The original subscription barrier now acknowledges durable creation without
  waiting for the scheduled search. Both fresh real bot-only and deliberately
  degraded conversations pass preset/subscription/search/notification,
  persistence, restart deduplication and message/state cleanup.
- The original injected bind failure now rejects instead of escaping as an
  uncaught error, and its owned fixture disappears without relying on the
  diagnostic's outer cleanup.
- Eleven connected native/combined capability checks pass, including actual
  media, updates, owner-only sends, restart idempotency and independent message
  cleanup. The installed SDK offline logging/shutdown control also passes.
  No identity-bearing SDK warning was observed in the connected check's log.
- All 29 public web catalogue routes were revisited read-only, including
  disabled entries without enabling them. Results: seven success, eight
  zero-card, one parse-incomplete, one HTTP-pending, three rate-limited,
  three not-found, five challenge and one unexpected-error observations.
  No access-control bypass was attempted. These route observations are not
  exhaustive pagination or independent extraction truth.
- The production collector and new source gate were exercised on a supported
  public catalogue. Fetch and parse complete, but pagination remains explicitly
  incomplete. Independent review is pending and acceptance does not pass.
  Inventory status likewise remains incomplete and global optimality unverified.
  [#183](https://github.com/konard/vietnam-accomodation-search/issues/183) is
  reopened for its original unfulfilled live acceptance requirements.
- Every currently enabled public web source is also attempted through the
  actual production collector and private acceptance gate, not only route
  navigation. At least one source proves explicit pagination completion;
  others remain incomplete or excluded. No independent labels are generated
  from predictions, so this still cannot pass the all-source accuracy gate.
- Fresh public-history catch-up and continuous retained 90-plus-day text replay
  complete. Every retained message is accounted for and parser errors are zero.
  Photo-only review remains unresolved. This does not establish independent
  precision/recall, complete OCR/media truth or global best-offer ranking.

## Fresh QA and operator findings

The real browser ownership experiment originally falsely failed on this Mac
because it unconditionally read Linux `/proc` and hid that setup error behind
its success-scenario assertion. [#197](https://github.com/konard/vietnam-accomodation-search/issues/197)
records the failure. The QA-only repair retains Linux's exact NUL-delimited
argument oracle and adds bounded, read-only macOS process inventory with exact
profile matching. Self-authored controls reject prefix lookalikes and unrelated
processes, including paths with spaces and quoting. Actual isolated Chromium
success, launch/navigation failure, SIGINT and SIGTERM now pass: owned profiles
and matching processes are absent; unrelated profile/evidence survives.
No shared browser state or global process cleanup is used.
The QA repair is pushed to main in `d734300`; #197 is closed only after
the real cleanup evidence and remote commit were independently verified.

The first six-path populated Docker control has five passing rows and an
unexplained acquisition failure on the nominal-success row. All six independent
cleanup checks restore baseline. [#199](https://github.com/konard/vietnam-accomodation-search/issues/199)
tracks the discarded diagnostics and unisolated first failure. QA now retains
fixed operation/category and error metadata, never raw stderr. The subsequent
complete six-path run passes, including actual SIGKILL recovery and populated
isolated caches. That green rerun is not presented as isolation of the first
cause; its failed evidence is retained and the issue remains open.

The supplied user environment uses already-supported legacy API credential
names. Existing QA authenticates it, but the new owner operator loses those
names through its canonical-only secret resolver, then reports the valid
session as unavailable. [#198](https://github.com/konard/vietnam-accomodation-search/issues/198)
includes an independent self-authored no-network counterexample. Its intentionally
failing readiness assertion still passes strict cleanup. No production resolver
fix is included. A canonical-name temporary copy is a QA workaround, not a
change to the original environment.
The finite reproducer is committed in `d734300`, rather than retained only
in private diagnostics.

The original private bot environment still does not authorize its authenticated
owner. [#193](https://github.com/konard/vietnam-accomodation-search/issues/193)
is reopened for that unchanged local readiness requirement. Health and an
implemented operator command are not proof of usable original authorization.

## Runtime, dependency and cleanup evidence

The initial complete supported Node 24.21.0 run passes 1,453 tests with 100%
product line coverage, 96.92% branches and 98.81% functions. After the additional
QA process-oracle regression, Bun 1.4.3 passes 1,454 tests at the unchanged
30-second deadline. Deno 2.9.6 passes 1,337 tests plus 19 steps with 11 documented
ignores. All three strict fixture audits and independent teardown checks pass.
This initial phase used browser-commander 0.29.0 and command-stream 2.0.2.

Host environment warning: the default shell still selects unsupported Node 20
and an unrelated .NET executable named clink. Validation explicitly selects
Node 24.21.0 and Rust clink 1.0.0 through PATH/CLINK_COMMAND; global shell profiles
and unrelated tools are preserved. A bare unsupported host invocation is not
the runtime configuration accepted here.

The reviewed historical corpus and self-authored bedroom/room/bed extraction,
unit-price filtering, ranking and explicit stay-period comparison controls pass.
Those declared labels are not independent latest live room/bed truth across
all supported sources.

With browser-commander 0.30.1 and command-stream 2.1.0 actually installed,
the final candidate passes Node's 1,456 tests with 100% product lines,
96.93% branches and 98.81% functions; Bun passes 1,456 tests, and ordinary frozen
Deno passes 1,339 tests plus 19 steps with 11 documented ignores. Strict
zero-fixture audits and independent teardown pass. The explicit owner operator
and real privileged conversation pass with temporary canonical credential names;
original configuration and alias blockers remain unchanged. Latest connected
native/combined capabilities and degraded real conversation also pass.
Latest browser contract/privacy/HTTP/profile ownership, metric/ranking controls,
zero-warning ESLint, tracked/new QA formatting, duplication, example web build
and both zero-known-vulnerability dependency audits pass.

All public web catalogue routes are revisited again on the installed latest
dependencies, yielding the same route outcomes as the initial phase. Every
enabled public web source is separately recollected into fresh acceptance
evidence: fetch/parse complete on those attempts, but only one proves pagination
completion. Independent review remains pending; no global-best claim is made.
Actual text/photo/album success, assertion failure, SIGINT and SIGTERM cleanup
passes again; independent owner history finds zero known QA messages and
unrelated history remains preserved.

The known maintained-dependency counterexamples are rerun, not inferred from
old issue titles: [use-m #80](https://github.com/link-foundation/use-m/issues/80)
still leaves a stalled response body pending while the application's bounded
control rejects; [test-anywhere #148](https://github.com/link-foundation/test-anywhere/issues/148)
still skips the recommended options-overload callback despite passing native
TAP. The explicit readiness assertions fail and strict cleanup/teardown passes.
Both existing upstream issues remain open. Repository usage retains its working
boundaries; these are not reported as new unmitigated application failures.

A fresh official registry check then found browser-commander 0.30.1 and
command-stream 2.1.0, both newly published since the previous QA check.
The active native workflow's module graph is not mutated underneath it.
Latest-version installation and final candidate validation are recorded after
that phase. Earlier results are not relabelled as latest-version acceptance.
Preparing the fresh releases hit Deno 2.9.6's default 24-hour minimum dependency
age policy. A one-command override fetches only the explicitly requested
verified latest pins through the global cache; project/global age policy is
unchanged. The final ordinary frozen graph subsequently passes without that
override.
Official registry metadata independently confirms all direct root and universal
example pins match latest tags at `2026-10-11T10:02:49Z`. No unrelated
parent-constrained transitive major is force-overridden.

Private acceptance checkpoints and diagnostic traces are intentional retained
evidence, not disposable profiles. Automatic runtime fixtures, marked chat
messages and uniquely owned Docker resources must independently verify removal.
Pre-existing Docker frontend cache and original deployment records are preserved;
no global prune is used.

The concurrent native traversal and fresh production-image build expose a
capacity failure, tracked in [#200](https://github.com/konard/vietnam-accomodation-search/issues/200).
Native acceptance correctly aborts at `QA_DISK_FLOOR`; provider shutdown,
independent zero-owned-message cleanup and runtime-data removal pass.
The Docker export fails with a BuildKit metadata I/O error. Subsequent image
inventory also fails with I/O errors, and Docker cleanup is explicitly false.
Concurrency/capacity is a safety finding, not proof of the filesystem error's
root cause. Neither fresh image acceptance nor full cutover is claimed.

[#201](https://github.com/konard/vietnam-accomodation-search/issues/201)
records another QA teardown isolation defect: exact builder removal was gated
on full inventory, including the failed unrelated image inventory. QA uses
resource-specific builder/image inventory instead; independent no-network
controls prove each available cleanup phase continues after another resource
inventory fails, protects baseline resources, and still reports failed final
baseline verification. Actual recovery of this failed Docker run remains
subject to its storage I/O failure; its exact private journal is retained.
No shared Docker restart, factory reset, global prune or unrelated cache removal
is silently performed.
Direct, independently verified stop of the exact owned build container succeeds;
its removal still returns an I/O error and independent Docker inspection shows
it in `dead`, not running, state. The retained container, builder/cache and image
ownership journal are not claimed as a clean baseline. Full cutover is not
attempted against this unhealthy Docker store.

The fresh latest web run also exposes the new dependency's documented default
automatic debug recording. It creates retained, untracked session traces in the
checkout rather than managed data/evidence storage. Observed directories are
owner-private; no current credential disclosure is asserted. Application policy
and retention/read-only-runtime integration are tracked in
[#202](https://github.com/konard/vietnam-accomodation-search/issues/202), with
the universal no-write/ownership improvement requested upstream in
[Browser Commander #166](https://github.com/link-foundation/browser-commander/issues/166).
An independent self-authored temporary-cwd probe verifies default recording,
retention after destroy and the working explicit opt-out; its complete fixture
is automatically removed. The initial probe confused macOS's `/var` and
`/private/var` aliases; canonical-path verification corrects that QA setup
counterexample, whose failed log and successful cleanup are preserved.

QA browser diagnostics explicitly opt out of implicit recordings while retaining
their requested private trace tests. Every accidental live recording is matched
to this run's exact log entry before it is moved into protected ignored evidence;
the checkout recording directory is independently absent. No unattributed or
pre-existing recording is removed, and production source policy remains issue-driven.

After those final QA-only policies, all three complete runtime suites pass again
at the counts/coverage above, as do the actual browser/privacy/HTTP/profile and
pricing controls. Final read-only owner-chat audit finds zero known QA messages.
Independent filesystem inspection finds no disposable audit profiles, pinned
credential copies, capability/chat fixtures, native/latest-web runtime data or
checkout automatic-trace directory. Protected raw evidence is retained
intentionally. The Docker exception above remains explicitly unresolved.

## Remaining readiness gates

- [#183](https://github.com/konard/vietnam-accomodation-search/issues/183):
  all-source pagination/retention and independent live bedroom/room/bed,
  photo-only and media accuracy acceptance remain incomplete.
- [#193](https://github.com/konard/vietnam-accomodation-search/issues/193):
  the unchanged original private configuration does not authorize its owner.
- [#198](https://github.com/konard/vietnam-accomodation-search/issues/198):
  the production owner operator rejects supported credential aliases.
- [#199](https://github.com/konard/vietnam-accomodation-search/issues/199):
  warning: the initial Docker acquisition failure remains unisolated despite
  successful complete diagnostic rerun and cleanup.
- [#200](https://github.com/konard/vietnam-accomodation-search/issues/200):
  heavy-run capacity coordination and fresh Docker/native acceptance remain
  incomplete after the guarded failure and Docker storage I/O errors.
- [#201](https://github.com/konard/vietnam-accomodation-search/issues/201):
  teardown isolation is repaired in QA, but exact Docker cleanup must still be
  independently verified on recovery; the failed inventory cannot prove it.
- [#202](https://github.com/konard/vietnam-accomodation-search/issues/202):
  production integration has no explicit managed/default-off trace policy for
  the latest dependency's implicit recording.

Temporary owner-only configuration, passing synthetic controls and honest
fail-closed source statuses are useful acceptance evidence, not substitutes
for those remaining gates. Docker daemon restart is not exercised: it changes
shared user infrastructure and is not part of the default isolated six-transition
local drill.
