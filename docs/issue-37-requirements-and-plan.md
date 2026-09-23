# Issue #37 requirements, findings, and acceptance plan

Date: 2026-09-23

This document inventories every requirement and acceptance criterion in the
six sub-issues attached to Issue #37. It separates production implementation
from evidence that can only be produced with private credentials or an
artifact published after merge. No private Telegram source, message, contact,
numeric identity, session, or reusable browser state is recorded here.

## Repository-wide findings

- The `/search` defect was not isolated to one handler call. Synthetic search
  results were marked delivered while being stored and then marked again after
  they were sent. Each write generated a different delivery timestamp, so the
  second write changed an existing named Links Notation relationship and
  exposed a real Rust `clink` import/export mismatch. The fix makes the write
  an idempotent keyed upsert everywhere, migrates historical duplicates, and
  gives send/cursor persistence an explicit prepared/finalized recovery state.
- Browser completeness was a shared adapter/audit-contract problem rather than
  three unrelated selectors. All source adapters now emit schema-v2 semantic
  cards with segment accounting, availability, stable identity, and source
  labels. The collector enforces those fields for every source, not only the
  three pages used by the live audit.
- The release failure was a serialized-workflow checkout race. A queued run
  checked out an old commit before acquiring the release concurrency lock; an
  earlier run then advanced `main`, leaving the queued run to mutate changesets
  before trying to rebase. Synchronization now happens before any mutation and
  re-counts changesets so a landed release is an idempotent retry.
- Telegram and deployment already had broad offline contract coverage. The
  missing parts are external acceptance evidence, not permission to invent
  credentials, identities, releases, or registry digests. The Telegram audit
  now additionally fails before network access unless Tesseract reports all of
  `eng`, `rus`, and `vie`.

## Status summary

| Issue | Implementation status                                                                                                    | Acceptance status on this candidate                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| #31   | Root cause fixed across storage and bot boundaries; regression and real `clink` reproduction added                       | Offline/restart/zero-diff pass; credentialed conversation rerun pending                                     |
| #32   | Resumable audit, terminal accounting, production parser path, `clink` checks, and OCR preflight implemented              | Blocked: no authorized user session, bot token, or Tesseract installation in this environment               |
| #33   | Shared schema-v2 adapters, segment ledger, availability, persistent cooldown, and ranked source cohort implemented       | Live local-Chrome VI/EN/RU cohort passes; independent challenge remains degraded as required                |
| #34   | Native mtcute modes, identity pins, classified fallback, secure session lifecycle, and degraded permutations implemented | Blocked: no native user session or bot token is available for the direct combined E2E                       |
| #35   | Checkout race reproduced and fixed; release identity and publication gates already exist                                 | Blocked until merge/main release: no tag, GitHub Release, npm package, or Docker manifest exists            |
| #36   | Production image smoke and local 0700 bind persistence plus backup/restore pass                                          | Exact released-image handoff, rollback, destructive lifecycle, and live aggregate rerun remain post-release |
| #37   | All six issues are handled in this branch and PR; closing-reference block is specified below                             | PR must remain visibly blocked until the external acceptance rows above have evidence                       |

## #31 — `/search` `clink` mirror and partial success

### Every requirement

1. Reproduce the exact `markDelivered`/search mutation with Rust `link-cli`
   0.2.10 without Telegram.
2. Identify the missing canonical link and restore deterministic text/binary
   round-trip parity.
3. Prevent a successful offer response followed by a command-level error, with
   explicit transactional/recovery semantics for the delivery cursor.
4. Add a regression for a successful result send followed by cursor/mirror
   failure.
5. Keep detailed failures in redacted traces while returning a stable error to
   the user.
6. The real conversation must exit zero without an error or usage reply.
7. Results and cursor must survive restart without duplicate delivery.
8. Rust export verification must report zero missing and unexpected links.
9. Failure-log and cleanup-only checks must report no residual messages.

### Solutions considered and selected plan

- Reordering the existing two writes would only move the partial-success
  boundary and would not fix duplicate named relationships.
- Wrapping Telegram send plus local persistence in a database transaction is
  impossible because Telegram is an external side effect.
- Selected: use an idempotent delivery relation keyed by user/subscription and
  offer, persist a prepared cursor before send, finalize it after confirmed
  send, and recover prepared records on restart. Storage migration collapses
  existing duplicates. Bot handlers catch persistence failures at the offer
  boundary, emit redacted diagnostics, and send one stable failure response.

Evidence: `experiments/reproduce-clink-mark-delivered.mjs` drives the real
Rust binary; storage, subscription, bot, and associative-storage tests cover
repeated upserts, restart recovery, send-then-finalize failure, and zero-diff
round trips. A credentialed rerun is still required for items 6 and 9.

The existing [Link CLI](https://github.com/link-foundation/link-cli) is the
right component: its named references, binary database, LiNo import/export,
and query operations are precisely the parity boundary under test.

## #32 — credentialed Telegram source and parser audit

### Every requirement

1. Run the resumable real-data audit with the authorized user session, Rust
   `link-cli`, and Tesseract `eng+rus+vie`.
2. Discover, rank, and select no more than 40 popular VI/EN/RU Nha Trang
   communities.
3. Resume every selected source to the complete two-month boundary, never
   accepting a safety-cap truncation or unresolved flood wait.
4. Route text, captions, albums, media-only posts, edits, deletes, contacts,
   prices, periods, units, rooms/beds, location, amenities, and provenance
   through production parsing.
5. Give every material and meaningful segment a terminal accepted, excluded,
   reviewed unknown/degraded, or actionable-error state.
6. Keep raw evidence local; commit only a sanitized aggregate with an immutable
   commit/release identity.
7. Every selected community must have a terminal complete-window verdict.
8. Every reviewed accommodation offer must be parsed or retained as an
   actionable parser gap; unrelated, request, sale, and out-of-location posts
   must be excluded.
9. There must be zero unresolved media-only candidates and zero unaccounted
   meaningful segments.
10. Typed LiNo and transactional `clink` round-trip/query/edit/delete must pass.
11. Top-level `acceptance.pass` must be true.

### Solutions considered and selected plan

- Bot API alone cannot retrieve arbitrary community history. Telegram's
  official [`messages.getHistory`](https://core.telegram.org/method/messages.getHistory)
  is user-only, and its documented offsets support durable backward paging;
  therefore native MTProto user access remains necessary.
- A one-shot scrape can silently stop at a limit. Selected: persist the oldest
  message checkpoint only after parser, trace, graph, and `clink` state are
  durable, request one item beyond safety boundaries, and resume until the
  configured date boundary.
- Selected: retain the existing production classifier/reconciler/parser and
  terminal-state ledger instead of building an audit-only parser. Preflight
  `tesseract --list-langs` before credentials/network, then use the documented
  three-letter language selection described by
  [Tesseract](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html).
- Selected: exclude Telegram `User`/`UserEmpty` dialogs before retrieval so the
  two private messages associated with the seed folder cannot enter evidence.

The code path and offline corpus pass. The actual audit cannot be performed in
this checkout: the repository and environment contain no authorized session,
bot token, or Tesseract executable. Those are acceptance inputs, not fixtures.

## #33 — live VI/EN/RU browser gate

### Every requirement

1. Use Browser Commander with a local Chrome UI only, never private site APIs.
2. Preserve randomized 3–8 second per-domain pacing, persistent retry-after and
   exponential cooldown, and cross-domain parallelism.
3. Never bypass CAPTCHA; persist degradation and continue with an independently
   rate-limited source.
4. Keep enough popular enabled VI/EN/RU Vietnam/Nha Trang rental sources that
   each language has fully parsed live evidence.
5. Account for every card/detail segment as structured, explicit unknown, or
   actionable error.
6. Keep raw HTML, screenshots, profiles, and traces local; commit only a
   sanitized aggregate.
7. Every enabled language cohort must have an accessible, correctly classified
   Nha Trang rental source.
8. Accepted cohorts must have zero incomplete cards and zero unconsumed
   meaningful segments.
9. Verify prices/periods, rooms/beds, location, contacts, media, availability,
   redirects, intent, and stable identities.
10. A challenge must produce persisted cooldown/degraded evidence and must
    never count as a pass.

### Solutions considered and selected plan

- Retrying challenged domains more aggressively conflicts with the issue and
  site safety. A CAPTCHA solver was rejected.
- Treating all cards as free text would hide omissions. Selected: source-
  specific schema-v2 semantic adapters plus a shared segment ledger and strict
  completeness gate.
- Selected: preserve the original failed sites as historical evidence while
  ranking independent public rental pages for Alo Nhà Đất, Nha Trang Renting,
  and Be Jib above unavailable seeds. Sold/rented cards are accounted but not
  emitted as current offers.
- Browser Commander remains appropriate because its published API supports
  local installed browsers and Playwright-backed lifecycle management. The
  [package documentation](https://www.npmjs.com/package/browser-commander)
  describes both. Playwright's
  [trace viewer](https://playwright.dev/docs/trace-viewer) supports local DOM,
  screenshot, and network evidence without committing private raw artifacts.

The live candidate run passed VI 20 cards/140 segments, EN 24/166, and RU
72/467, all with zero incomplete/unconsumed segments. A separate challenged
domain exited non-zero and persisted its cooldown. See the dated browser case
study for the sanitized aggregate.

## #34 — identity-pinned native mtcute modes

### Every requirement

1. Create or validate a native `mtcute/session-string-v1` session through the
   secure login/QR flow; do not reinterpret a legacy session.
2. Store it outside application data with mode `0600`, atomic activation,
   backup exclusion, and an independently pinned numeric user ID.
3. Pin bot identity independently.
4. Run bot-only, user-only ingestion, healthy both mode, and bot-first
   capability fallback.
5. Run degraded both mode for foreign, expired, revoked, and permission-denied
   user sessions while keeping bot capability healthy.
6. Exercise identity mismatch, rotation, rollback, logout/revocation guidance,
   bounded flood waits, and cleanup.
7. Preflight and runtime must report the same capability matrix in every mode.
8. Attempt bot access first per feature, use the user only for classified
   unavailable capabilities, and never retry an ambiguous send via fallback.
9. The direct real-session conversation must pass with both pins true and
   combined runtime true.
10. Commit no secret, numeric identity, raw update, or private message.

### Solutions considered and selected plan

- Reusing the old GramJS string would violate the explicit format boundary and
  risks misinterpreting credential material.
- Selected: mtcute-native export/import with an envelope declaring
  `mtcute/session-string-v1`, owner-only atomic storage outside `/data`, and
  separate bot/user `getMe` identity pins before polling.
- Selected: one typed capability router shared by preflight and runtime.
  Fallback is limited to classified unavailable/read capabilities; uncertain
  write outcomes fail closed.
- Selected: bounded handling for typed RPC failures. mtcute documents session
  strings as password-equivalent and warns against simultaneous reuse from
  multiple IPs in its [storage guide](https://mtcute.dev/guide/topics/storage);
  its [error guide](https://mtcute.dev/guide/intro/errors) exposes typed
  `FLOOD_WAIT` handling.

Offline tests cover the modes, degraded classifications, pins, lifecycle, and
cleanup. A native session and bot token are absent, so the direct combined
conversation acceptance item cannot honestly be marked passed.

## #35 — release versioning and immutable publication

### Every requirement

1. Reproduce and fix version-packages/commit-to-main without bypassing gates.
2. Preserve deleted-changeset handling, branch/ruleset-safe push behavior, and
   idempotent retry.
3. Complete all required workflows on the exact release commit.
4. Publish and cross-check the Git tag/GitHub Release, npm package/integrity,
   and native amd64/arm64 Docker manifest digests.
5. Attach workflow-generated schema-v2 release identity evidence.
6. The release workflow, including Pipeline Status, must be green.
7. A non-draft Release must exist and its peeled tag must equal the fully tested
   commit.
8. npm name/version/integrity and Docker version/digests must match the release.
9. Record Node, Bun, Deno, and schema versions without secrets.
10. Do not accept a manual version edit or fixture-only report as evidence.

### Solutions considered and selected plan

- Increasing retries after changeset mutation would keep the dirty-rebase race.
- Canceling prior releases could strand an already-publishing run. Selected:
  keep serialized release execution, fetch/fast-forward the clean checkout
  before merging or deleting changesets, re-count them, and treat a previously
  landed version as an idempotent publish retry.
- Continue using Changesets. Its
  [CLI documentation](https://github.com/changesets/changesets/blob/main/docs/command-line-options.md)
  explicitly separates versioning from publication and recommends landing the
  version changes before publish.
- Continue npm OIDC publication rather than storing a reusable token. npm's
  [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
  describes short-lived workflow-specific credentials and provenance.
- Continue Docker Buildx multi-platform publication. Docker documents that a
  [multi-platform image](https://docs.docker.com/build/building/multi-platform/)
  is a manifest list referencing per-platform manifests, which is why the
  audit must retain both native digests.

The historical failure is reproduced by the two-clone regression and the
synchronization fix passes it. Publication cannot happen on this PR commit:
the workflow publishes after a changeset is merged to `main`. At inspection
time there is no repository tag/Release, npm package, Docker manifest, or
configured repository secret/variable for a bootstrap publish. The schema-v2
audit therefore remains pending rather than accepting fixture data.

## #36 — exact-release deploy and final acceptance

### Every requirement

1. After publication, deploy the exact image with `scripts/deploy.mjs` and an
   operator-owned mode-`0700` host bind.
2. Measure old-to-new handoff, prove no overlapping pollers, inject candidate
   failure, and restore the exact previous image.
3. Remove/recreate containers, Compose resources, Docker volumes, and Docker as
   applicable while preserving host-bound state/cache.
4. After restart, verify presets, subscription cursor, update deduplication,
   source checkpoints, cached media/offers, traces, and LiNo/`clink` mirrors.
5. Exercise backup/restore, named-volume migration, rollback, locks, logs, stop,
   and cleanup.
6. Rerun Telegram source, conversation, combined auth, Browser Commander, and
   associative-storage gates against the same released identity.
7. Update traceability and dated case studies without rewriting failures.
8. Every gate must pass on one immutable release identity.
9. Record actual interruption and recovery timings.
10. Leave no test container, volume, or poller and lose no application data.
11. Keep raw Telegram/browser evidence and credentials local with restrictive
    permissions.
12. Keep the issue open until release identity, live evidence, deployment
    evidence, and every successor blocker passes.

### Solutions considered and selected plan

- A named Docker volume alone does not meet the operator-owned disaster-
  recovery requirement. Docker's [bind-mount documentation](https://docs.docker.com/engine/storage/bind-mounts/)
  confirms that bind mounts persist container-created data directly on the
  host; the deploy preflight therefore validates the exact directory, mode,
  ownership, write/fsync/rename, schema, and free space.
- Selected: deploy by immutable digest, serialize transitions with the existing
  lock, preflight the candidate without polling, stop the old poller before
  starting the new one, and retain the old digest for rollback.
- Selected: use the existing persistent-data probe for a minimum reproducible
  local drill, then repeat the complete operator run on the published image.

Local candidate evidence: the production image launches the CLI, Rust `clink`
0.2.10, Chromium, storage round-trip, and health endpoint. In a mode-`0700`
host bind, a replacement container retained the offer, cached media, preset,
subscription, delivery cursor, update cursor, and binary mirror. A tar backup
was restored into a second mode-`0700` bind and passed the same verification.
The temporary data/restore/backup directories were deleted after verification;
zero audit containers and zero audit volumes remained. This is useful
pre-release evidence, but it is not the exact released-image/live-poller drill.

## #37 — umbrella PR requirements

1. Read all six issues and every comment. All issue comment collections were
   empty at inspection time.
2. Put all work in one PR; do not create a follow-up implementation PR.
3. The PR body must close the umbrella and all six sub-issues.
4. Use one complete closing keyword per issue.
5. Explicitly call out anything already resolved or not reproducible while
   retaining its closing reference.

Required PR body block:

```text
Fixes #31
Fixes #32
Fixes #33
Fixes #34
Fixes #35
Fixes #36
Fixes #37
```

None of the six issues was wholly already resolved or non-reproducible. The
existing offline contracts for #32, #34, and #36 were already substantial, but
their live/release acceptance requirements remain real. The PR must state those
blockers prominently so a merge does not accidentally present missing external
evidence as a pass.

## Final execution order

1. Land and locally verify the #31 storage/bot regression, #33 shared browser
   adapters, #35 pre-mutation release synchronization, and #32 OCR preflight.
2. Run formatting, lint/duplication, Node coverage, full Node/Bun/Deno suites,
   changeset validation, local production-image smoke, and persistence restore.
3. Push the single branch, inspect fresh CI by commit SHA, and preserve logs for
   every non-passing run.
4. A credential holder runs #31, #32, and #34 locally with restrictive files and
   publishes only sanitized aggregates.
5. Merge only after those gates pass; let the changeset workflow create the
   version commit and publish npm/GitHub/Docker artifacts.
6. Cross-check schema-v2 identity, deploy that exact digest, execute #36, and
   attach sanitized timings and acceptance evidence before treating the entire
   umbrella as complete.
