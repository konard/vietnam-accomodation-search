# Issue 240: requirements, investigation, and implementation plan

This PR addresses umbrella #240 and its twenty child issues in one branch. Every issue body and all paginated comments were read; there were no child-issue comments when research began. The original-host reports are evidence of failures, not evidence that this container has those authenticated sessions or that local synthetic checks attest live acceptance. No source or account identifier, workload count, listing payload, contact, token, or session from those reports is reproduced here.

## Work plan

1. Read all twenty issues, original-host reports, contributing instructions, recent related PRs, and every affected call site.
2. Preserve the initial CI logs and verify their timestamps and commit SHA.
3. Reproduce parsing, merging, ownership, and polling failures with minimal controls before changing behavior.
4. Fix shared parsing and reconciliation first, then bounded cache APIs/import, deployment recovery, account-aware diagnostics, and scoped conversation tools.
5. Keep recovery evidence private and independent of disposable work directories. Stop and join producers before releasing locks or deleting messages.
6. Run focused checks, finite memory/signal probes, all local tests, lint, formatting, and duplication checks. Commit independently useful changes.
7. Merge the current default branch, review the complete PR diff, update the existing PR description with all required closing references, push only the prepared branch, investigate fresh CI logs, and mark PR 241 ready after its checks pass.

## Complete requirement inventory and solution choices

Each numbered item is an acceptance requirement, including negative controls and limits. The chosen implementation and its verification follow each issue. Account-dependent outcomes remain explicitly unverified when the original private environment is unavailable.

### 220 — interrupted global deployment lock

1. Handle SIGINT/SIGTERM at the real CLI entry point and preserve a failing interruption exit status.
2. Abort and join in-flight command producers before rollback, residue cleanup, or lock release.
3. Preserve global serialization across projects; never replace it with per-project locks.
4. Save private token/host/PID/provenance metadata, retain crash evidence, and expose explicit exact-owner recovery.
5. Reject live owners, foreign hosts, changed tokens, non-private evidence, and recovery without verified producer quiescence; age and PID alone are insufficient authority.
6. Verify cancellation through the actual subprocess CLI, failed-operation recovery, and a later successful lock acquisition while preserving unrelated state.

Options: OS advisory locks, a third-party heartbeat lock, or the existing atomic-directory lock plus exact capability ownership. The selected approach extends the existing directory lock, propagates AbortSignal into command-stream, joins tracked promises, and permits only exact evidence-based recovery. See `scripts/owned-operation-lock.mjs`, `tests/issue-220-lock.test.js`, and `experiments/revalidation-deploy-signal-lock.mjs`. SIGKILL/OOM cannot execute finally; their saved owner record supports explicit recovery. A legacy empty lock has no recoverable capability and is never automatically stolen.

### 221 — original configuration denies its owner

1. Authenticate the supplied owner independently with GetMe and enforce the configured pin.
2. Apply an explicit onboarding path to the original environment file, preserving private defaults, existing legitimate allowlists, unrelated settings, and credentials.
3. Preserve unrelated-user rejection.
4. Retest real startup, privileged commands, and restart using that original file; a configured copy cannot certify it.
5. Stop producers before exact marked-message cleanup and independent paged readback, keeping identities/configuration private.

Options: silently authorize all configured sessions, require manual ID copying, or reuse the existing authenticated owner configuration helper. The helper already supported atomic original-file updates; the conversation tool now exposes `--configure-original-owner` after independent driver authentication. `tests/issue-195-private-owner.test.js` covers unchanged settings, wrong pins, validation failure, and rejection of unrelated users. Actual original-host conversation acceptance is not claimed in this environment.

### 222 — all-source acceptance

1. Supply locally executable account-aware tools without requiring a different actor to run tests.
2. Retain the exact failing phase and finite typed provider reason, plus durable incomplete checkpoints and original evidence.
3. Keep source membership, workload counts, payloads, contacts, and sessions private.
4. Freeze a fresh 90-day cohort, represent every enabled production seed, and retain failed seeds rather than removing them.
5. Attempt supported disabled web routes in QA without enabling them in production.
6. Include fresh native media/OCR coverage and explicit unsupported-material review; retained text replay is insufficient.
7. Require complete actual pagination or report a bounded/access limitation; fetch/parse success alone is incomplete.
8. Respect challenges, provider waits, time/storage guards, and cancellation.
9. Require independent blind positive/negative truth for price, period, billing scope, currency, bedrooms, rooms, beds, and location. Predictions cannot label themselves.
10. Require actual eligible native-photo delivery and restart; do not seed a synthetic cache to satisfy this gate.
11. Block production/global-best claims until every gate passes.

Options: unbounded retry, deleting failing seeds, or bounded idempotent resolution retry with honest incomplete evidence. The selected retry preserves access/authentication failures and unknown failures, persists incomplete checkpoints before network resolution, and retains phase metadata through diagnostic wrapping. Source acceptance persists a frozen cohort, privately stores all source rows, explicitly attempts supported disabled routes, and prints only finite status flags. Existing independent-review, media/OCR and real-photo gates are retained. Tests: `issue-222-resolution`, `issue-195-source-acceptance`, `issue-195-real-photo-acceptance`, and native ingestion/history tests. No all-source or eligible-photo acceptance result is fabricated; fresh account-dependent execution remains a stated limit.

### 223 — sanitized Docker operation classification

1. Preserve the known lease-error category for `docker pull`.
2. Assess finite `start` and `exec` operation names too.
3. Keep arguments, image/container names, credentials, and raw stderr private.

Options: parse arbitrary command strings or extend the finite whitelist. The whitelist adds only these three known operation names. `tests/issue-203-docker-diagnostics.test.js` covers lease classification and disclosure controls.

### 224 — unhealthy restoration/recreate

1. Retain the first failure and the restoration failure together.
2. Report readiness/health phase and bounded elapsed timing while preserving the real readiness contract and deadline.
3. Diagnose the original host honestly; do not infer an unverified production root cause from a QA fixture.
4. Make the unhealthy-candidate fixture fail the candidate deliberately and recover the exact prior image with the normal health configuration.
5. Recreate with the normal configuration; verify image, protected data, markers, single poller, notification duplication, backlog and cleanup.

Options: weaken readiness, key health behavior on a mutable image tag, or use separate candidate and recovery Compose files. The drill now supplies `--recovery-compose-file` explicitly; rollback starts and verifies the recorded image/data directory through that file. The failing fixture always fails. Deployment logs retain phase/status/timing and both error causes. Existing state-machine and drill controls exercise recovery decisions; private original-host unhealthy logs and a live Docker cutover remain unverified here.

### 225 — additive state preservation

1. Protect every pre-cutover offer, preset, subscription, media object, and binary projection.
2. Permit new records and new collections caused by ingestion, subscriptions, or search.
3. Permit normal trace/checkpoint progress while still detecting removal or mutation of protected user/cache records.
4. Identify changed/lost records independently of collection size and whole-inventory digests.

Options: freeze all writers, compare only counts, or compare a protected-record subset. The selected fingerprint maps hashed identities to record hashes, compares only the protected subset, permits progress collections, checks media contents and per-collection binary presence, and allows additions. `tests/issue-225-state-preservation.test.js` reproduces additive failure and controls protected-record mutation/deletion.

### 226 — supplied two-account combined QA

1. Offer a scoped combined-process mode using the independently verified bot and owner session.
2. Preserve the three-account mode and its distinct-driver guard.
3. Probe Bot API and native ingress/egress separately with private correlation evidence and independent history observation.
4. Report self-update, duplicate-routing and independent-actor limits explicitly; two identities cannot attest a cross-account scenario.
5. Use only the verified owner/bot conversation and uniquely marked messages.
6. Stop subscriptions/runtime producers and perform exact deletion plus paged readback on success, failure and signals.

Options: remove the distinct-account guard or add a clearly scoped `both-owner` mode. The latter uses a declared native owner driver, keeps all pins, requires shared runtime/driver ownership only in this mode, performs in-process transport probes, stores private transport evidence, checks native egress from the driver's history, and reports self-update observations. The three-account guard remains. Tests: `telegram-e2e-identities`, `issue-226-combined-probes`, and API boundary tests. This conversation fixture uses synthetic offers and cannot replace the real-source/photo gate.

### 227 — unprefixed replies escape cleanup

1. Recognize the actual unprefixed `Preset drill-<run>-<sequence> does not exist` grammar in read-only audits.
2. Never delete merely because text matches that grammar.
3. Recover only with exact private run, sender, time window, sequence, baseline, or acknowledged ownership evidence.
4. Install markers on the actual bot and Context API before real commands; an ESM class field can bypass a prototype setter.
5. Fail early if the actual response lacks the installed marker.
6. Keep independent journals through paged readback, stop late producers, and preserve unrelated messages.

Options: broad regex deletion, prototype-only interception, or actual API attachment plus capability-backed recovery. The bot entry point attaches the preload explicitly, while Context API interception handles scheduled sends and captions. Unmarked historical replies require the exact saved proof; ambiguous audit findings remain failures. Tests: `issue-227-reply-proof` and existing owned-message/preload suites. Conversation cleanup recovery consumes the original private journal, including drill reply evidence.

### 228 — bounded offline bootstrap

1. Import checksum-verified retained history/web pages without target requests.
2. Bound source working sets, release page arrays, batch durable canonical writes, and retain raw evidence, deduplication and chronology.
3. Resume completed pages and stop safely on checksum, memory, storage or signal failure without certifying a partial transaction.
4. Add streaming/projected/top-k cache access so callers avoid retaining raw maps and duplicate full inventories.
5. Recover an OOM/SIGABRT storage lock only from exact saved provenance after producer quiescence; preserve unrelated cache data.
6. Keep actual counts, contacts, IDs and payloads private.
7. Add a finite format-equivalent synthetic scaling/control fixture with fixed heap limits; do not fix OOM by increasing the heap.

Options: streaming JSON alone, more heap, or paged parsing plus disk-backed identity reconciliation and streamed LiNo publication. The selected importer verifies bounded pages, keeps raw pages, stages identities/checkpoints in built-in SQLite, reconciles bounded alias components, writes checksum-addressed canonical shards, and atomically publishes their index. `LinksStore.iterOffers`, projection and `topOffers` reuse the canonical inventory. Tests cover checksum failure, cancellation, corruption, chronology, resumption, and 40/400 synthetic-record controls under the same 128 MiB heap. A duplicate index-order entry was reproduced as silently omitting another offer; unique order validation now rejects it. Additional finite controls reject malformed indexes, shard checksum/count/size mismatches and excessive metadata, preserve the old published cache on failure, and verify binary-mirror activation. Limits: 4 MiB/page, 128 records/identity component, 256 KiB/normalized record, 8 MiB/index metadata; exceeding a limit retains evidence and fails rather than silently trimming. Text/binary tooling remains canonical; SQLite is private import staging only.

### 229 — contradictory/tiny rent scales

1. Exclude or review literal tiny VND amounts and contradictory headline/body scales.
2. Keep contradictory raw evidence; never guess a multiplier.
3. Preserve valid ordinary rental quotes; a 500k QA floor is not a blanket production filter.

Options: multiply every small number, globally discard low prices, or mark evidence-backed anomalies for review. The selected parser detects implausible literal VND and incompatible rent scales after fee exclusion. Existing ranking rejects review-required offers. Regression controls include ordinary million-VND and explicit foreign-currency rent.

### 230 — fees replace rent

1. Recognize multilingual management/combo/service/utilities fee clauses, including Cyrillic management.
2. Keep these out of rent and rent min/max selection.
3. Retain legitimate 5/6-million lease alternatives.
4. Preserve utility and fee evidence without treating it as rent.

Options: global minimum-number extraction or clause-aware rental quotes. Shared rental token processing excludes fee clauses and preserves lease alternatives. The focused regression and existing pricing fixtures cover headline rent, management, combo fees and alternatives.

### 231 — expired/rented web offers

1. Inspect primary detail status and publication/expiry evidence, with a bounded verification/cache budget.
2. Persist the status with a TTL and exclude explicit expired/already-rented offers.
3. Keep unverified availability unknown; age alone cannot establish expiration.
4. Prevent fresh cards or related recommendations from revalidating an expired primary listing.
5. Expose a read-only local diagnostic without inquiries or access bypass.

Options: infer availability from collection time, reject all old ads, or inspect primary detail evidence. Homedy/Batdongsan collection now checks a bounded number of detail pages, removes related/recommended sections before status extraction, stores TTL evidence, and marks terminal status unavailable. Cached terminal evidence is applied even beyond the five-request budget. A local detail-inspection tool uses the same path. A reproduced consent-classification mismatch is corrected by using the shared page classifications in collection and diagnostics. Concurrent detail requests were also reproduced overwriting each other's terminal evidence; the persistent cache now uses the store's atomic updater, and the memory cache merges against its current contents at publication. Tests cover terminal/active/unknown status, TTL refresh, concurrent publication, cancellation, blocked pages, resource cleanup and budget exhaustion; actual original listing URLs remain private and are not independently attested here.

### 232 — informational/service intent

1. Exclude market guides, questions, myths, negated examples, cleaning tips and visa/service advertisements from rental offers.
2. Preserve retrieved raw material and review evidence.
3. Keep concrete positive rental advertisements eligible, even with informational footers.

Options: any-price eligibility or primary-intent classification. Shared Telegram classification/parser and web normalization now reject the demonstrated informational/service intents; raw ingestion/review collections retain their evidence. Focused positive/negative regressions cover the counterexamples.

### 233 — price/source context mismatch

1. Select one coherent current source variant for amount, currency, period, billing basis, URL, title, raw text and room/bed counts.
2. Preserve other source URLs as alternatives and retain history.
3. Keep the newest edit/deletion per source; a superseded historical minimum must not return.
4. Apply this to stored reconciliation, display and ranking rather than patching one shortlist.

Options: independently aggregate each field or select the current price's actual variant. Canonical merge now chooses that variant's context and keeps alternative URLs and per-source chronology. Historical official-link retention is restricted to an identical quote and denominator from the same source; another variant's official link stays an alternative. Focused regression plus reconciliation/edit/deletion tests verify consistency.

### 234 — split rent token

1. Account for a leading standalone digit split across a newline from a currency amount.
2. Reconcile only defensible evidence or mark ambiguity; never rank the truncated smaller amount.
3. Preserve the full text/span.
4. Keep independent floor/bedroom/count lines from being concatenated into rent.

Options: join all numeric lines or conservatively review the ambiguous rent fragment. Shared quote parsing chooses review for the reproduced wrapped token and leaves labeled structural counts independent. Positive/control tests cover both cases.

### 235 — alternative beds

1. Preserve alternative/ranged bed evidence without inventing a definite bed denominator.
2. Treat exact beds as unknown in alternatives such as one or two beds.
3. Preserve true two-bed and bedroom controls; conflicting count evidence remains ambiguous.

Options: take the first/last number or represent a range. The parser stores `bedsRange` and omits exact `beds`; existing denominator rules retain unknown. Regression controls preserve explicit two beds.

### 236 — absent washing machine

1. Interpret explicit Vietnamese absence as absent, not present.
2. Preserve multilingual negative/positive controls.
3. Distinguish absence, private presence, shared presence and unknown.
4. Ensure amenity filters consume the corrected normalized evidence.

Options: keyword-only inclusion or polarity-aware amenity extraction. Shared extraction now separates `amenities`, `absentAmenities`, and `sharedAmenities`. Washer negation, English/Russian negatives, and positive presence controls pass through normalization.

### 237 — fee billing scope contaminates rent

1. Derive billing basis from the same selected rental quote clause/span.
2. Exclude per-person utility/management terms from a whole-property rental basis.
3. Preserve genuine per-person, per-bed and per-room rental quotes.
4. Keep arithmetic/ranking consistent with known/unknown denominators.

Options: search the entire message for scope words or tie basis to the selected rental amount/currency/period. The latter is applied in `quoteBasis`; existing per-unit and denominator tests plus the focused fee control verify it.

### 238 — contact-only false merge

1. Prevent a shared contact plus generic agency heading and missing unit data from collapsing distinct studios.
2. Require unit-specific evidence for fallback fingerprints.
3. Preserve deduplication for actual message aliases, exact URLs, explicit unit IDs and adequately specific repost evidence.
4. Apply the change to persistent `saveOffers` as well as in-memory merge.

Options: remove all contact deduplication or strengthen only the weak fingerprint. Canonical fingerprints now require structural unit evidence or a sufficiently specific title; direct identity keys remain. Focused persistence controls and offer reconciliation tests cover both distinct units and actual aliases.

### 239 — readiness timeout escapes worker

1. Race bounded readiness against startup completion/rejection and cancellation.
2. Always stop the runtime and await startup settlement in finally.
3. Test bind/startup failure, never-ready, cancellation and normal readiness without skipping integration or loosening its timeout.
4. Bound escaped workers/timers at suite level and still reach independent cleanup evidence.
5. Keep environment permission failures distinct from product defects; kill only the owned process tree.

Options: longer test timeouts, polling forever, or a bounded helper plus a suite inactivity watchdog. The helper clears polling/timers in finally; the suite wrapper owns a process group, forwards progress, terminates only that group after inactivity, and completes the temporary/recovery audits. Tests: `issue-239-readiness`, `issue-239-watchdog`, and the original combined-runtime integration test.

## Online research and existing components

- Installed signal handlers suppress Node's default signal exit behavior, requiring explicit cancellation and final exit status. The deployment wrapper follows this contract. [Node process documentation](https://nodejs.org/api/process.html)
- Docker healthcheck start periods, intervals and failing streaks are independent of application readiness. The drill keeps the production readiness contract and varies only the candidate fixture. [Docker HEALTHCHECK reference](https://docs.docker.com/reference/dockerfile/#healthcheck), [Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/)
- grammY API transformers wrap actual API calls, and Context API instances inherit the bot's transformer stack. Explicit instance attachment handles class-field initialization; marker application remains idempotent. [grammY transformers](https://grammy.dev/advanced/transformers)
- `proper-lockfile` uses atomic mkdir and heartbeat-based staleness. Its automatic stale-lock behavior cannot satisfy the requested exact-evidence recovery policy, so no dependency was added. [Maintainer README](https://github.com/moxystudio/node-proper-lockfile)
- `stream-json` offers incremental parsing and array element streaming, but an individual element must still fit memory and it does not solve deduplication or atomic canonical publication. Bounded retained pages and existing LiNo streaming are sufficient for this manifest format. [Maintainer README](https://github.com/uhop/stream-json)
- Built-in SQLite supports prepared queries/iteration and disk-backed staging without adding a native package installation. The importer uses this only on supported Node versions; runtime APIs remain portable. [Node SQLite documentation](https://nodejs.org/api/sqlite.html)
- mtcute supplies native `getHistory`, `sendText`, `deleteMessagesById`, peer resolution and live subscriptions. The owner driver reuses these APIs and declared session formats. [mtcute method reference](https://ref.mtcute.dev/modules/_mtcute_web.methods), [mtcute update handlers](https://mtcute.dev/guide/dispatcher/handlers)
- Dinero.js and currency.js can improve monetary arithmetic representation but cannot infer whether a token is rent, a fee, a negated example or a contradictory scale. The root causes require quote/intent evidence, and existing integer-VND conversion is retained. [Dinero.js](https://github.com/dinerojs/dinero.js), [currency.js](https://currency.js.org/)

## Initial CI evidence

The initial Checks and release run `38289786339` was created after initial commit `8bc6339` and failed its changeset requirement; the initial Security run `38289786227` passed. The full failed log was retained locally in `ci-logs/checks-38289786339.log`: line 5778 reports “No changeset found in this PR”; line 15155 identifies `changeset-check` as the failed job. A patch changeset is included. Latest-head checks must be verified after pushing; old green checks cannot validate later commits.

The next Checks and release run [38302963384](https://github.com/konard/vietnam-accomodation-search/actions/runs/38302963384), created at 2026-10-12T20:14:58Z for `8f835b8`, reproduced two platform-specific gaps. Its full 38,454-line log is retained in `ci-logs/checks-38302963384.log`, with separate failed-job logs for focused review.

- Windows Bun failed its lifecycle cleanup probe before starting the suite: `ci-logs/bun-windows-38302963384.log` lines 266–268 show the valid 15-digit `.6e415a4c2f3d8da-1.node-gyp` cache rejected as residue. Bun's own lifecycle tests specify bounded variable-width hexadecimal components, rather than a fixed 16-digit prefix. The cleanup matcher now follows that format only within the suite-owned temporary directory; regression cases retain rejection of malformed, excessive-width and unrelated fixture names. [Bun maintainer lifecycle tests](https://github.com/oven-sh/bun/blob/7583003d82122bbfa5e06dcd688d8c2d1533fa22/test/cli/install/bun-install-lifecycle-scripts.test.ts#L295)
- Ubuntu Node passed all 1,568 tests but its exact coverage gate reported the missing-checkpoint fallback at `src/telegram-ingestion.js:1065`: `ci-logs/node-ubuntu-38302963384.log` lines 4823 and 4878. A deterministic live-resolution test removes the checkpoint collection before failure, verifies durable incomplete phase/category evidence, and checks that the provider's original error and cleanup are preserved. It passes on Node, Bun and Deno. Product behavior and the 100% coverage threshold are unchanged.

The same run's required real-clink 1.0.0 job passed both its 1,570-test suite and 100% coverage run; no local Rust build was necessary. Latest-head CI must repeat that validation after the two fixes.

## Windows CI follow-up and default-branch failures

The follow-up [Checks and release run 38305800417](https://github.com/konard/vietnam-accomodation-search/actions/runs/38305800417) was created at 2026-10-12T20:40:59Z after commit `2aeb3e33a7bb5902c8a57456bd35dd66e4a23b6a` (20:40:52Z). The previous green run cannot validate this later head. Full and focused logs were downloaded before implementation.

1. Windows Bun's concurrent-process writer failed with `EPERM` opening `.write.lock/owner.json`: `ci-logs/bun-windows-38305800417.log:325`, with the failing writer assertion at line 350. Windows can deny opens during another process's deletion or incompatible file sharing. This is consistent with the observed contention, rather than proof of a particular antivirus or filesystem cause. Treat Windows `EPERM`/`EACCES` owner reads as an occupied lock and retry within the existing 200-attempt acquisition limit. Never infer stale ownership from unreadable metadata. POSIX permission failures, unexpected errors, live-owner protection and actual stale-owner recovery remain unchanged. [Microsoft CreateFile reference](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea), [Microsoft DeleteFile reference](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-deletefile)
2. Windows Node exhausted the unchanged 300-second suite budget while starting the release-loader integration test: `ci-logs/node-windows-38305800417.log:2322`. Serial filesystem synchronization and worker startup consumed most of the budget; the integration test also performed CDN retries and an unbounded global package installation. Resolve the exact release package from a pinned development alias through the real `use-m` resolver and verify the installed bundle against the release loader's SHA-256 digest. The real CommonJS namespace and command failure assertions always execute on Node/Bun, including offline. Run two isolated workers on Windows to overlap filesystem waits; retain one worker on memory-constrained local Linux. Keep both the 300-second suite and 30-second individual-test budgets. [Node test execution model](https://nodejs.org/docs/latest-v24.x/api/test.html#test-runner-execution-model), [use-m maintainer documentation](https://github.com/link-foundation/use-m)
3. Minimal regressions were run before the fixes. `ci-logs/windows-regressions-before.log` records both metadata-read failures and the old integration test silently passing without executing its assertions when network access was denied. `tests/windows-storage-lock.test.js` covers transient read contention plus error-preservation controls. `tests/use-module-offline.test.js` launches the actual integration file with a rejecting fetch preload, requires successful loader execution, and forbids network-unavailability skips. The preload is retained in `experiments/revalidation-use-module-offline.mjs`. Read-only Deno explicitly registers the environment/shell cases as ignored; a separately permission-enabled Deno run executes both real assertions. The CDN loader's cancellation, digest and retry controls remain covered independently.

Existing alternatives were examined: `graceful-fs` addresses some Windows filesystem retries but does not implement this lock's ownership contract; `proper-lockfile` changes stale-recovery semantics. Neither dependency is needed for a bounded occupied-lock decision. Node's built-in isolated-worker concurrency and `use-m`'s existing resolver extension are sufficient. [graceful-fs maintainer Windows retry implementation](https://github.com/isaacs/node-graceful-fs/blob/main/polyfills.js), [proper-lockfile maintainer implementation](https://github.com/moxystudio/node-proper-lockfile/blob/master/lib/lockfile.js)

The latest default-branch [run 38284005535](https://github.com/konard/vietnam-accomodation-search/actions/runs/38284005535), created at 2026-10-12T17:24:35Z for `6cb6b2cd4870404f93efb871e97b58ee283a073a`, also failed. Its preserved `ci-logs/default-checks-38284005535.log:30239` reports the same real-loader assertion exceeding 30 seconds. The deterministic integration fix applies to that default-branch failure too. Lines 157–164 report missing publication configuration; these require repository-owner access rather than a test change:

- Create a publish-capable npm token for the initial `vietnam-accomodation-search` publication and add repository secret `NPM_TOKEN`. After the package exists, configure its npm trusted publisher with user `konard`, repository `vietnam-accomodation-search`, workflow filename `release.yml` (filename only), and direct `npm publish` permission; subsequent OIDC releases can omit the bootstrap token. [npm trusted-publisher setup](https://docs.npmjs.com/trusted-publishers/)
- Set repository variable `DOCKERHUB_IMAGE` to the destination repository without a tag, set `DOCKERHUB_USERNAME`, and add repository secret `DOCKERHUB_TOKEN` with write access to that image repository. Re-run the default-branch release workflow after configuring them.

The existing release preflight already implements the requested boundary: PR report mode prints why missing publication credentials are advisory and exits successfully, while a default-branch release fails early with the exact required variables/secrets. Publication jobs run only for authorized release events. `tests/release-preflight.test.js` verifies both modes, missing bootstrap credentials and required OCI publication. No credential is fabricated and release policy is preserved.

## Local verification

- Final Windows-fix `npm run test:coverage`: 1,573 tests passed, zero failed, 100% product line coverage. The owned temporary and recovery audits were clean.
- Final full Bun suite through `scripts/test-with-cleanup.mjs --strict`: 1,573 passed, zero failed, with clean temporary/recovery audits. Final frozen-lock read-only Deno suite: 1,455 passed, zero failed, 14 permission-specific cases explicitly ignored. Both real loader assertions also passed with `--allow-read --allow-env --allow-run`.
- `npm run check`, JavaScript syntax checks, file line limits and `GITHUB_BASE_REF=main node scripts/validate-changeset.mjs` passed. Duplication remained 4.91%, within the existing gate. The changeset includes the Windows ownership fix.
- The offline Chromium probe passed active, expired, rented and unknown fixtures with publication/expiry evidence and misleading recommendations. Its network was blocked and the browser closed.
- The finite import scaling probe passed 40 and 400 synthetic records at the same 128 MiB heap limit; no production workload or private count is disclosed. Actual CLI subprocess probes passed SIGINT and SIGTERM exit/lock-release checks, and owned-process watchdog probes passed.
- No local `clink` executable was available. Required production-clink passed at `8f835b8`; the latest-head CI jobs remain authoritative for subsequent changes and multi-platform validation. No memory-heavy local Rust build was attempted in the 2.92 GiB container.

The originally reproduced failing tests were kept as regressions, including rental quote/context controls, additive-state preservation, actual bot API attachment, index-order integrity, consent-wall rejection and concurrent terminal-status publication. Recovery and account-dependent claims remain limited as stated below.

## Local invocation and acceptance boundaries

Use private environment files already available to the authorized local QA agent. Conversation tools require `TELEGRAM_CONVERSATION_E2E=1`; source acceptance rejects CI execution and retains its local-only boundary. Paths below are placeholders, never copied-account substitutes.

```sh
TELEGRAM_CONVERSATION_E2E=1 node experiments/telegram-bot-conversation-e2e.mjs --bot-env ORIGINAL_BOT.env --user-env VERIFIED_OWNER.env --configure-original-owner --mode bot-only
TELEGRAM_CONVERSATION_E2E=1 node experiments/telegram-bot-conversation-e2e.mjs --bot-env ORIGINAL_BOT.env --user-env VERIFIED_NATIVE_OWNER.env --mode both-owner
TELEGRAM_CONVERSATION_E2E=1 node experiments/source-acceptance.mjs collect --all --env-file ORIGINAL.env --output PRIVATE_NEW_COHORT
node experiments/import-collected-cache.mjs --manifest PRIVATE_PAGES.json --directory PRIVATE_CACHE
node experiments/inspect-web-details.mjs --url OFFICIAL_DETAIL_URL --directory PRIVATE_EVIDENCE_CACHE
node experiments/recover-owned-lock.mjs --lock EXACT_LOCK_DIRECTORY --evidence PRIVATE_SAVED_OWNER.json --producers-stopped
```

Check source-acceptance's help/required local boundary before invoking it. A new output directory freezes a fresh cohort; reusing it resumes that same clock. Every inventory source receives a private observation/exclusion; disabled supported routes are enabled only in the ephemeral QA call. Review templates require independent labels and keep predictions separate. `real-photo-acceptance.mjs` remains the distinct unsynthesized photo/restart gate.

Offline manifest shape:

```json
{
  "version": 1,
  "frozenAt": "2026-10-12T00:00:00Z",
  "pages": [
    {
      "path": "retained-page.json",
      "sha256": "64 lowercase hex characters",
      "format": "offers"
    }
  ]
}
```

Formats are `offers`, `telegram`, or `web`; source attribution is private descriptor metadata. Telegram/web review-pack rows may wrap their original payload in `material`. Historical collection timestamps are retained. Split oversized pages before import and retain original checksums/evidence. The importer checks the canonical baseline again under the storage lock before publication. A concurrent canonical change stops publication and preserves staging for reconciliation rather than overwriting the other writer. Media is preserved in the supplied cache; the offline importer performs no media download and never certifies fresh media acceptance. Recovery requires independent proof that all exact producers stopped, then rejects a live PID, different host or changed capability. A storage/deployment lock's age is never release authority.

The offline detail-status browser probe exercises the actual extraction function in Chromium with active, expired, rented and unknown fixtures, including misleading related recommendations and publication/expiry dates:

```sh
node experiments/revalidation-web-detail-status.mjs
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using an existing Chromium installation. The probe blocks network requests and closes its browser in finally; it does not certify the private original listing URLs.

Local tests attest synthetic controls and code paths. Original-host owner commands, full source/media/OCR truth, real eligible-photo notification/restart, and a real Docker cutover require the original private inputs and remain unverified in this container. These limits are recorded in this PR, with no follow-up PR or fabricated acceptance result.
