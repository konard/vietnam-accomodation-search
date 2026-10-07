# Issue 144 requirement and investigation plan

This single PR addresses #122, #129, #142 and #143. Read the complete issue bodies and every comment, including the October 7 independent retest. Work only on `issue-144-40eadc58262b`; preserve history, use atomic commits, update PR 145, and never merge the default branch directly.

## Checklist

- [x] Read aggregate issue, all four sub-issues and comments, PR 145 discussions and contributing guidelines.
- [x] Verify the prepared branch and clean starting tree; examine the latest related merged PR 141 and its independent regression evidence.
- [x] Research primary sources and existing libraries for OCR, resumable Telegram history, real clink projection and registry publishing.
- [x] Enumerate every requirement, alternative solution and chosen implementation in the report.
- [x] Reproduce each code defect with minimum automated controls before fixing it.
- [x] Trace every affected production, legacy, audit, public API and user-facing path.
- [x] Implement and test poster recognition without weakening unrelated-price/precision safeguards.
- [x] Implement incomplete-history reporting and durable public-preview pagination without forcing interactive searches to finish a backfill.
- [x] Profile full-body ledgers and actual Rust clink; improve verified storage throughput and durable audit progress.
- [x] Inspect available publishing configuration and run actual release-mode preflight; preserve explicit blocked acceptance if credentials are absent.
- [x] Run targeted tests, then all supported runtime tests, required real-clink checks, production coverage and repository checks.
- [x] Use real Chromium on live public previews; verify durable cursor restarts, explicit cutoff observation, retained partial offers and bounded incomplete warnings.
- [x] Save large logs; bound synthetic performance probes by finite input and memory; retain reusable probes under experiments.
- [x] Add a patch Changeset; commit each useful verified step and push only the prepared branch.

Finalization is recorded on [PR 145](https://github.com/konard/vietnam-accomodation-search/pull/145) after the final push:

- Fetch current main and ensure it is included, review the published PR diff for regressions, and update title/body with tests and all five closing references.
- Check recent CI runs with timestamps and the exact final SHA; save unsuccessful logs in ci-logs, identify errors with line numbers, fix and recheck.
- Verify a clean working tree, complete all background work and mark PR 145 ready when implementation is finished.

## Exhaustive acceptance requirements

### Aggregate #144

1. Read and address all four issues and all comments in one PR; do not defer work into another PR.
2. Include separate `Fixes #122`, `Fixes #129`, `Fixes #142`, `Fixes #143` and `Fixes #144` lines.
3. Explicitly identify already-resolved/nonreproducible items and retain their references. Never present an unmet external acceptance gate as resolved.

### Release #122

1. Retest the actual publishing state; distinguish real release-mode preflight from report-mode checks.
2. First npm publication requires an authorized bootstrap token while the package is absent.
3. Configure authorized Docker Hub image, account and publishing token; publish native linux/amd64 and linux/arm64 artifacts.
4. Exact release commit must pass authentication/write probes, publish npm/GitHub/OCI artifacts, verify native platform manifests/digests and pass a clean registry install.
5. Keep release acceptance visibly open until actual evidence exists; local deployment and successful test/security jobs do not substitute.
6. Do not require a separate Telegram account; do not claim token rotation. Preserve unrelated test failures as independent findings.

### Poster #129

1. Bounded, cancellable production extraction must serve historical and live paths, including the legacy collector.
2. Persist original media provenance, extraction status and durable reviewed/degraded/error outcomes, without silent loss or falsely complete coverage.
3. Reviewed evidence must include captionless rentals, unreadable photos, unsupported media, OCR failures and mistaken prices; automatic OCR positives are not independently reviewed rentals.
4. Avoid OCRing each apartment photo in a captioned album.
5. Correct/reviewed fields must reach the rental listing or remain in explicit durable review.
6. Retain sparse-text OCR that recovers the real 13M VND/month studio; fix the extra literal rental-verb guard without accepting map labels/receipts/unrelated prices or hard-coding an OCR mistake.
7. Distinguish private real-poster evidence from sanitized/self-authored regression fixtures.

### Public history #142

1. Propagate `historyComplete=false` into aggregate status, user-visible warnings and acceptance gates.
2. Preserve useful partial offers and existing safety/scan-stamp rules.
3. Resume older pages across requests/restarts until the frozen 90-day boundary is reached, instead of starting at the newest page each time.
4. Keep interactive searches bounded; they need not await the entire backfill.
5. Cover incomplete offers, incomplete empty results, complete empty results and native/public history routes.
6. Verify actual browser behavior where tools/network permit; distinguish offline pagination controls from real-channel acceptance.

### Audit #143

1. Profile realistic full-text ledger and actual clink import/export with adequate disk headroom and isolated finite workloads.
2. Retain all original source text (never literal undefined), domain records and real verified binary storage.
3. Preserve durable progress and resumability through interruption/projection failure; checkpoints cannot claim completion before verification.
4. Improve the measured projection bottleneck and demonstrate practical cohort acceptance, with explicit limits if private data/credentials are unavailable.
5. Preserve source bodies, usernames, contacts, sessions and message IDs privately; publish only sanitized/aggregate evidence.
6. Do not attribute the earlier overlapping-workload result solely to a product regression without isolated measurements.
