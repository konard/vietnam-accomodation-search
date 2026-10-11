# Production readiness requirements, research and verification

Parent [#195](https://github.com/konard/vietnam-accomodation-search/issues/195)
collects nine distinct findings. This report accompanies
[PR #196](https://github.com/konard/vietnam-accomodation-search/pull/196).
Every child description and comment was read, including the later passing Bun
reruns. A passing functional suite does not establish exhaustive live collection,
independent label accuracy, private owner readiness or successful live cutover.

## Complete requirement inventory and selected solutions

| Issue                                                                   | Every requested condition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Alternatives and selected implementation                                                                                                                                                                                                                                                                                                                                                                                   | Verification and remaining work                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [182](https://github.com/konard/vietnam-accomodation-search/issues/182) | Route the installed SDK's identity-bearing updates warnings through the configured privacy boundary; distinguish expected shutdown cancellation/reset from genuine runtime session/authentication loss; retain actionable faults; capture finite actual-SDK shutdown logs.                                                                                                                                                                                                                                   | Disabling all logging would hide faults. Intercept the shared SDK logger and error event at the central client factory. Export only fixed category/stage values. Track destruction; downgrade expected shutdown cancellation, retain revoked/expired/unregistered authentication failures.                                                                                                                                 | Installed SDK prefix-bearing warning is redacted, offline destruction finishes, captured stderr is empty. Revocation during destruction remains an error. Actual connected session-reset shutdown still requires the supplied session.                                                                                                                     |
| [183](https://github.com/konard/vietnam-accomodation-search/issues/183) | Provide a live, resumable gate for every source; explicit full web pagination; full native history and photo-only OCR/upload/review accounting; independent live bedrooms/rooms/beds and billing-basis labels; measure false positives/negatives; report challenged/rate-limited/missing/pending/parse-incomplete sources as exclusions or incomplete; use lawful APIs/fallbacks or remain incomplete; never bypass access controls or claim global-best readiness from text replay or self-authored labels. | A crawler framework could supply queues but cannot establish exhaustion, accessibility or independent truth. Extend the existing collector and durable store with explicit next/terminal evidence and resumable cursors. Add a private operator gate, separate blind review pack and blank labels; reconcile native photo-only albums and attempt all ten possible photos.                                                 | Two-page/resume/loop/cross-origin/challenge controls and four-photo OCR controls pass. One actual public web source produced 40 materials with explicit pagination completion. Independent live review is pending. Inventory status remains 0 accepted, 70 incomplete, 22 excluded. Native live media and exhaustive all-source acceptance are unverified. |
| [184](https://github.com/konard/vietnam-accomodation-search/issues/184) | Publish already received valid latest rentals before the historical tail finishes; durable incomplete checkpoints; reconcile albums and edits; bounded batches, awaited backpressure and working retention; continue the full requested 90-day history; do not truncate or claim exhaustion.                                                                                                                                                                                                                 | Splitting off a small latest-only query could duplicate ingestion and misrepresent coverage. Publish the current page as it arrives, then bounded batches, using the same material reconciliation. Persist events and incomplete cursor before continuing. Reconcile later album captions and edits; retain the full provider iteration while marking storage loss degraded.                                               | Original tail-barrier reproducer changes from invisible to visible while the tail remains blocked. Conflicting later album captions and resumed edits remove provisional offers and their graph projection. Existing byte-budget, graph closure and restart tests remain intact. No numeric latency SLA is claimed.                                        |
| [185](https://github.com/konard/vietnam-accomodation-search/issues/185) | Diagnose final candidate eligibility, empty-result notification, photo rejection/text fallback and actual Bot API photo delivery separately; choose from final SearchService results; add ineligible-first/eligible-second control; retain the photo gate and never seed synthetic listings into real-source acceptance.                                                                                                                                                                                     | Merely checking stored photo fields misses current availability/value filters. The QA selector now calls actual SearchService eligibility for stored photo candidates. Observe search outcomes and actual Bot API responses independently.                                                                                                                                                                                 | First unavailable candidate is rejected and the second eligible candidate is selected. Empty, eligibility-rejected, media-rejected, text-fallback and accepted-photo outcomes have separate controls. Real Bot API media acceptance is pending credentials; mocked responses are explicitly control evidence.                                              |
| [187](https://github.com/konard/vietnam-accomodation-search/issues/187) | Own profiles before launch; stop trace/commander/browser before profile deletion; dispose after success, launch/navigation/assertion failure, SIGINT and SIGTERM; surface close failures; independently verify owned profiles/processes; preserve intentional evidence and unrelated profiles; no shared-root deletion or global process cleanup.                                                                                                                                                            | Browser Commander's launcher races the QA signal scope through Playwright's default signal handlers. Use the installed Playwright persistent-context launcher with its signal handlers disabled, retaining Browser Commander for navigation. Register the exact disposable profile before launch; attempt every closer; preserve a profile if browser closure fails.                                                       | Finite actual Chromium control passes success, launch failure, navigation failure, SIGINT and SIGTERM. Every exact profile is absent and its matching processes are gone; unrelated profile/evidence survives. Injected close failure fails acceptance. Parallel domain workers are joined before cleanup.                                                 |
| [188](https://github.com/konard/vietnam-accomodation-search/issues/188) | Convert asynchronous bind/setup errors into rejection within cleanup; close only the owned server; remove only its fixture directory; cover success, setup/bind failure, operation failure and interruption; preserve unrelated/deployment data; do not rely on outer uncaught-exception cleanup.                                                                                                                                                                                                            | A global exception handler would mask ownership. Put listen and its error/abort listeners inside the same try/finally as the server operation; always close the server and remove the owned directory. Use the CLI's existing search cancellation scope for self-check.                                                                                                                                                    | Original injected bind-error control previously observed an uncaught error and leftover fixture. It now rejects and removes its own fixture. Registered server and directory controls cover success/failure/cancellation and unrelated-directory preservation.                                                                                             |
| [189](https://github.com/konard/vietnam-accomodation-search/issues/189) | Keep the supported full Bun invocation and unchanged 30-second deadline; isolate inherited runtime state, external bootstrap and subprocess lifetime; bound network/subprocess behavior and verify teardown on timeout; preserve failures and focused positives; no production credentials, real remote pushes/PRs, global cleanup, increased deadlines, disabled assertions or retry-only green claim.                                                                                                      | Increasing deadlines or rerunning until green cannot isolate a cause. Give release fixtures a small explicit environment, local installed command-stream dependency and bounded owned process groups. Keep the separate bootstrap integrity tests. Local remotes and fake gh remain self-authored.                                                                                                                         | The historical two intermittent failures were not reproduced locally; their exact cause remains unproven. Poisoned runtime environment and owned timeout/child-reaping controls are deterministic. Focused release files pass the unchanged deadline. Full-suite evidence is recorded below; hardening is not presented as proof of the historical cause.  |
| [193](https://github.com/konard/vietnam-accomodation-search/issues/193) | Use the existing supplied session to derive the owner locally; configure the intended original private setup and verify an actual privileged command; require no extra independent identity/session/token; keep public access closed and unrelated users unauthorized; never publish real IDs, credentials or original env contents; health alone is insufficient.                                                                                                                                           | Asking for an ID duplicates authenticated session data. Add an explicit private operator command that validates the supplied session, pins any configured expected account, unions the owner into the existing approved private lists and atomically writes mode 0600. Preserve other credentials and reject concurrent file edits. A legacy supplied session uses the read-only operator helper without conversion/login. | A self-authored owner invokes the real registered update_sources handler; an unrelated user is rejected; output contains no owner ID and explicitly says liveCommandVerified=false. The original environment/session is absent in this checkout, so actual operator configuration and live privileged command remain pending.                              |
| [194](https://github.com/konard/vietnam-accomodation-search/issues/194) | Acknowledge durable subscription creation promptly without awaiting scheduled search; preserve failure observability, owned background work, deduplication and shutdown; cover slow/failing/cancelled searches; rerun the real local cutover.                                                                                                                                                                                                                                                                | A detached unmanaged promise could lose errors or outlive shutdown. Persist, reply, then trigger the existing single-flight scheduler with an observed rejection. Give scheduler runs an AbortController, join on stop and prevent delivery after cancellation.                                                                                                                                                            | Original registered-handler barrier changes from no acknowledgement to acknowledgement while search remains blocked. Persistence, failing search, shared single-flight, cooperative cancellation and ignored cancellation have controls. Real production-image cutover remains pending the supplied environment.                                           |

The production fixes apply to the shared entry points: CLI self-check, the
registered subscribe handler and scheduler, all default mtcute client consumers,
all web collector sources and native ingestion. The browser audit, release
fixtures and real-source QA selector use the same owned-resource principles.
Existing parsing, pricing, authorization, graph retention, replay accuracy,
timeouts and offer-count assertions remain enabled.

## Research and existing components

- **mtcute**, already installed: its
  [client options](https://ref.mtcute.dev/interfaces/_mtcute_bun.index.BaseTelegramClientOptions)
  expose a logger and its
  [error guidance](https://mtcute.dev/guide/intro/errors) describes client error
  handling. A logger boundary at the common factory covers child loggers without
  exposing TL objects, formatting arguments or account prefixes.
- **Playwright**, already installed:
  [launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
  uses an explicit user-data directory, closes its browser through the context,
  and exposes process signal options. The QA scope must own these signals; the
  finite Chromium probe uncovered competing automatic signal handling.
- **Telegram API**:
  [messages.getHistory](https://core.telegram.org/method/messages.getHistory)
  and [offset semantics](https://core.telegram.org/api/offsets) support continued
  history traversal; the implementation preserves that traversal. Telegram's
  [file and album guidance](https://core.telegram.org/api/files) bounds an album
  to ten media items; the photo-only OCR default covers that bound.
- **Bun**:
  [test runtime behavior](https://bun.com/docs/test/runtime-behavior) and
  [environment variables](https://bun.sh/docs/runtime/environment-variables)
  make inherited runtime configuration relevant to fixture processes.
  [Node child processes](https://nodejs.org/api/child_process.html) provide
  detached groups and close events for bounded subprocess ownership.
- **Crawlee**'s
  [PlaywrightCrawler](https://crawlee.dev/js/api/playwright-crawler) and
  [RequestList](https://crawlee.dev/js/api/next/core/class/RequestList)
  are existing alternatives for traversal and queues. No new crawler dependency
  is needed: the repository already has domain scheduling, source outcomes and
  durable storage. Neither component can turn an access challenge into permission
  or establish independent ground truth.
- **Tesseract**'s
  [quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)
  explains why an OCR attempt is insufficient evidence of correct extraction.
  The existing OCR backend is retained, every photo attempt is accounted for,
  and independent image review remains a separate acceptance requirement.
- **grammY runner** provides
  [managed execution](https://grammy.dev/ref/runner/run), but the existing
  subscription scheduler already owns single-flight jobs. Adding cancellation
  and shutdown joining there avoids a second scheduler dependency.

No additional dependency, access-control bypass or timeout inflation is used.

## Reproduction and validation

Finite controls use self-authored data and owned temporary roots. These commands
need no Telegram credentials:

```bash
node scripts/test-with-cleanup.mjs node experiments/revalidation-self-check-bind-cleanup.mjs
node scripts/test-with-cleanup.mjs node experiments/revalidation-native-backfill-progress.mjs
node scripts/test-with-cleanup.mjs node experiments/revalidation-subscription-ack.mjs
node experiments/issue-195-sdk-close.mjs
node experiments/issue-195-browser-ownership.mjs
node --test --test-concurrency=1 tests/issue-195-*.test.js
```

The actual browser probe has a finite watchdog. It verifies exact owned process
command lines before removal and never closes another profile. SDK verification
uses the actual installed logger and offline destruction; it does not fabricate
a connected native session. All regression tests use test-anywhere, with the
repository's existing Deno read-only policy for filesystem/process controls.

Before fixing the implementation, the provided tail, subscription and bind
experiments failed their intended gates. After fixing it, their positive controls
and independently verified cleanup pass. New regressions cover the material
conflict, resume, media completion, source gate and release isolation cases.

The first complete Node run found ten integration failures. The targeted 72-test
rerun passes after preserving Telegram's paging reserve only for Telegram,
making fixture pagination explicit, and separating native media audit records
from the small history cursor. These fixes preserve original assertions.

The initial placeholder PR failed Checks and release run `38119377355`
(2026-10-11, SHA `2329ec20db5e9404ae57b02fabb432d89e2a2ce0`): downloaded
log lines 14651–14653 identify changeset-check as the failing job. The patch
changeset prepares the repository's automatic release; package version is not
manually changed. Final suite and current-commit CI results belong in the PR.

## Private live acceptance workflow

Review evidence stays in `.deploy/source-acceptance` by default, with private
directory/file permissions. Do not commit that directory or original env files.
Collection is source-by-source and resumable; completed sources require fresh
collection on the next invocation. The existing inventory includes disabled
and inaccessible entries, which remain explicit exclusions.

```bash
# Optional --env-file selects the already supplied original environment.
node experiments/source-acceptance.mjs collect --source SOURCE_ID --env-file /private/original.env
node experiments/source-acceptance.mjs collect --all --env-file /private/original.env
node experiments/source-acceptance.mjs status --env-file /private/original.env

# Independent reviewer reads only the private review pack, fills blank labels,
# and attests independence and blindness. No parser-generated expected labels.
node experiments/source-acceptance.mjs review --observation /private/observation.json --labels /private/reviewed-labels.json

# Derive and configure the existing authenticated private owner.
node bin/vietnam-accomodation-search.js telegram authorize-owner --env-file /private/original.env
# For an already supplied legacy-format session, without login/conversion:
node experiments/configure-private-owner.mjs --env-file /private/original.env
```

The gate requires matching source/time/material digest, complete reviewed material
coverage and explicit offer labels. Unknown fields remain null. Photo-only rows
also require independent media review. Wrong scalar values count as both false
positives and false negatives; missing/excess values are reported separately.
Precision/recall with no positive denominator are not evaluated and cannot pass.
Default measured thresholds are offer 95%/95%, counts 95%/90%, and billing basis
and period 98%/90%; these are explicit QA policy choices, not an issue SLA.
Observed sample counts accompany the metrics. Review freshness is six hours.

Web paging stops after a finite 25-page invocation or its collection deadline,
retains at most 10,000 raw rows, and resumes its durable cursor. Exhaustion is
accepted only from recognized terminal controls; missing controls, loops,
foreign-origin links, challenges and retention loss remain incomplete. For a
JavaScript-only or challenged catalogue, add a source-specific lawful adapter/API
where permitted, or keep its gate incomplete. There is no challenge bypass.

Native history remains the full requested 90-day iteration. First-page materials
are published immediately and older batches await durable writes. Working/storage
retention is bounded and loss is reported; a bounded store is not certified as
complete merely because the provider reached the history end. Media completion,
independent review and latest-offer correctness remain separate obligations.

The real-source photo workflow selects from final eligible results and requires
an actual Bot API response containing photo media. A stored photo, OCR success,
text fallback or mocked response cannot satisfy that live gate.

## Evidence limits and follow-through

This checkout has no supplied original bot/native environment. Consequently the
original private allowlists were not changed, an actual privileged owner command
was not sent, connected native media/photo delivery was not certified, and the
production-image cutover drill was not rerun. The operator workflow does not
request a second identity or new credentials. Those live steps can reuse the
original already supplied environment when it is present.

One actual public web collection established full pagination for its observed
40-material slice. It does not certify the other sources, independent room/bed
truth or optimality. Independent reviewer attestation cannot be manufactured
by software. The current inventory reports 0 accepted, 70 incomplete and 22
excluded; even a passing per-source gate leaves global optimality unverified.

The release fixture hardening eliminates demonstrated inherited bootstrap and
unowned-lifetime failure modes. The historical intermittent Bun root cause
remains unproven; full passing runs must be reported as validation, not cause
isolation. The parent issue's live readiness claim remains limited accordingly.
