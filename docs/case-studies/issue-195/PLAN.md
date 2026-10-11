# Issue 195 requirements and implementation plan

All work belongs to PR 196 on `issue-195-afa899498de0`. Read parent issue,
every child issue and every comment. Preserve privacy and existing features.

## Todo

- [x] Read issues 195, 182, 183, 184, 185, 187, 188, 189, 193, 194 and comments; inspect PR conversations, inline comments and reviews.
- [x] Verify prepared branch and clean starting tree; read contributing rules.
- [x] Research primary documentation and existing components; inspect recent merged PRs.
- [x] Record every requirement, alternatives, chosen solution and acceptance evidence.
- [x] Reproduce each defect with finite controls before changing its implementation.
- [x] 182: route SDK logs through the privacy boundary, redact identities, distinguish shutdown cancellation from real runtime session/auth faults; capture actual SDK shutdown logs.
- [x] 183: implement resumable per-source acceptance with explicit full web pagination and native media completion; independently reviewed bedroom/room/bed and billing labels; false-positive/false-negative metrics; honest inaccessible-source exclusions and lawful API/fallback paths.
- [x] 184: publish current bounded batches before historical exhaustion; persist checkpoints; reconcile albums/edits; bounded backpressure; preserve full 90-day backfill and incomplete status.
- [x] 185: select real-photo candidates from final eligible search results; distinguish empty results, eligibility rejection, photo rejection/text fallback and successful Bot API media response; test ineligible-first/eligible-second without synthetic live seed data.
- [x] 187: register disposable profile ownership before launch; stop browser/trace before deletion; dispose after success/failure/SIGINT/SIGTERM; surface cleanup errors; preserve evidence/unrelated profiles; independently verify exact owned profiles/processes.
- [x] 188: reject asynchronous bind/setup errors inside cleanup scope; close owned server and remove owned fixture; cover success, setup, operation and cancellation; preserve unrelated data.
- [x] 189: isolate inherited runtime/network/bootstrap state and subprocess lifetime in release fixtures; deterministic unchanged 30-second Bun full-suite controls and timeout cleanup; no real pushes, retries-as-fix, skipped assertions or global cleanup.
- [x] 193: private owner identity derivation from supplied session, closed access and unrelated-user rejection; privately configure intended original operator setup where credentials exist; test actual command; never commit IDs/secrets or claim unavailable live evidence.
- [x] 194: acknowledge durable subscription before search; retain error reporting, owned background work, deduplication and shutdown; slow/failing/cancelled regressions and real cutover where available.
- [x] Apply each fix to all equivalent code paths and inspect cross-feature interactions.
- [ ] Run focused controls, all supported local suites and lint/format/duplication/release checks with saved logs; run heavy commands serially within 2.92 GiB.
- [x] Add patch changeset (automatic versioning; do not manually bump version).
- [ ] Commit useful atomic steps after local checks; push only prepared branch.
- [x] Fetch/merge latest main, review full PR diff and preserve history.
- [ ] Investigate CI: list latest timestamp/SHA; download each failed run log; read in chunks <=1500 lines; fix specific failures; verify latest checks.
- [ ] Update PR title/body with all requirements, reproductions, evidence/limitations and individual closing references for all ten issues.
- [x] Remove initial .gitkeep, ensure clean tree, mark PR 196 ready, report PR URL.

## Initial findings

No applicable AGENTS.md was found in the workspace or its parents. The initial
PR's changeset check fails because the placeholder commit has no changeset.
The project already includes mtcute, grammY, Playwright, an exhaustive source
inventory, owned-resource QA helpers and regression experiments. Prefer extending
these over adding dependencies. Live acceptance must remain incomplete when
sources, independent review or credentials are unavailable.

## Acceptance limits

Implemented workflows and finite controls are complete. Connected Telegram SDK
shutdown, native OCR/photo delivery, independent live label review, original
operator allowlists and actual production-image cutover need the original supplied
environment, which is absent here. These requirements remain explicitly unverified;
no passing mock is substituted for live evidence. The historical intermittent Bun
cause was not reproduced; deterministic fixture hardening does not prove that cause.
