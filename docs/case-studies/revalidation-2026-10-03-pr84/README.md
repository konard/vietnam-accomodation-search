# Post-PR #84 revalidation — 2026-10-03

## Scope

This pass checked main [`24c06d9`](https://github.com/konard/vietnam-accomodation-search/commit/24c06d9b039552594ec91195a583ea3f5ec181c2), after PR [#84](https://github.com/konard/vietnam-accomodation-search/pull/84) closed #77–#83. Its baseline is the [post-PR #76 report](../revalidation-2026-10-03-pr76/README.md). The privacy rules are unchanged: private state stays in ignored `0700` directories, and no Telegram messages were sent.

## Results per closed issue

| Issue                | Retest                                                                                                                                                                                                                                                                                                                                      | Verdict                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| #77 data directory   | A typo'd or different `--data-directory` is refused before any build or stop, naming both paths. The production container was unchanged.                                                                                                                                                                                                    | **Fixed**                                                                                       |
| #78 duplicate poller | A second project on the same token is refused (token fingerprint). With `--allow-shared-token`, the 409 was caught in the 30 s settle window and the new project removed. Production went `503` for ~32 s and resumed with 0 restarts.                                                                                                      | **Fixed**                                                                                       |
| #79 example advisory | Root and example `npm audit` are 0/0. Dependabot shows 0 open. Security workflow green. Example web build passes.                                                                                                                                                                                                                           | **Fixed**                                                                                       |
| #80 owner inputs     | Release Preflight [run 37114702613](https://github.com/konard/vietnam-accomodation-search/actions/runs/37114702613) still reports `0 verified, 2 failed`. No secrets, variables, or release exist, and the live E2E harnesses still lack pins.                                                                                              | **Not done**. Successor: [#87](https://github.com/konard/vietnam-accomodation-search/issues/87) |
| #81 deploy UX/docs   | Port preflight, one-line errors, cleanup of a failed first deploy, Node 24 docs, and the 597 MB image with a size budget all work. Streamed `docker pull` loses its cause (log has `stderr: null`), the step is mislabeled on restore, a refused first deploy leaves residue, and lint hangs on the data directory.                         | **Partly**. Successor: [#86](https://github.com/konard/vietnam-accomodation-search/issues/86)   |
| #82 offer media      | `mediaIdentity`, `photos`, `variants`, and the read-time migration work: a real bloated PR #67 offer shrank to 10 KB. Offers are bounded only on read, so replayed pre-fix batches committed 899,836 per-byte links until a later save. Orphan chunks (1.9 GB) survive the small-collection path. The audit reached 2/40 sources in 48 min. | **Partly**. Successor: [#85](https://github.com/konard/vietnam-accomodation-search/issues/85)   |

## Other gates

- `npm test` with real `clink` 0.2.11: **927/927**, 0 skipped. Lint, format, and duplication pass. Lint must exclude the local data directory; see #86.
- Docker image for `24c06d9` is 597 MB with correct labels, runs as `node`, includes `clink 0.2.11` and Node 24.21.0. Host-bind smoke passes.
- Deploy drill: redeploy took 50 s including settle, longest readiness gap 2.4 s (4/308), `getMe` 0 failures. An unhealthy candidate was restored in 28 s, rollback took 6 s, and stop worked.
- Browser audit: **10/10** routes passed.
- Telegram audit (PR #60 baseline): first stopped by the 15 GiB free-disk floor because of Docker build cache, not audit state. After cleanup it resumed from its checkpoint. After 48 min: 6 checkpoints (2 complete), final index 888 offers / 72 MB / 0 byte links, peak 2.66 GiB and RSS 2.1 GiB, no `TimeoutNegativeWarning`.

## Verdict

**Not production ready, but closer.** The deploy safety defects and the security advisory are fixed. Real-data ingestion now stays bounded once offers are re-read, but a full 40-source audit would take ~16 h and passes through a window of bloated committed data (#85). Publication and pinned live Telegram acceptance still depend on owner inputs (#87).
