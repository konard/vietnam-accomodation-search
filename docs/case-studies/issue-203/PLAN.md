# Issue 203 work plan

All implementation is on `issue-203-35b74727260e` in PR 204.

- [x] Read umbrella issue, all seven sub-issues and all paginated comments;
      inspect PR conversation, inline reviews and reviews.
- [x] Read contribution rules, release/changeset workflow and recent related PRs.
- [x] Inventory existing implementations, regressions and operational evidence.
- [x] Research official browser, Docker, filesystem, locking and Telegram APIs.
- [x] Write requirement-by-requirement analysis with alternatives and chosen plans.
- [x] Reproduce credential alias loss and default recording before fixing them.
- [x] Normalize production/QA credentials consistently, reject secret conflicts,
      enforce both original and supplied-session owner pins.
- [x] Apply explicit recording opt-out across every production and QA consumer.
- [x] Reproduce capacity rejection with finite filesystem doubles; implement
      preflight, periodic monitor and shared storage-heavy acceptance lock.
- [x] Verify producer stop, exact resource cleanup and journal retention on failure.
- [x] Preserve bounded Docker acquisition diagnostics, including worker and nested
      cleanup errors; keep original failure separate from later passing reruns.
- [x] Recheck existing resource-specific Docker cleanup, repair remaining coupling,
      run actual six populated-cache exit controls and independent baseline readback.
- [x] Exercise actual read-only public collection and record source-by-source
      pagination, exclusions and pending independent/native review honestly.
- [x] Locate only explicitly supplied private inputs, if present; run original
      owner configuration/privileged acceptance without publishing identifiers
      when available. None were supplied; live acceptance remains incomplete.
- [x] Do not manufacture independent labels or shared-host recovery evidence.
- [x] Add a patch changeset; format, lint, duplication, all Node/Bun/Deno tests.
- [x] Commit useful atomic steps after relevant local checks and push only prepared branch.
- [x] Update PR title/body, include every closing reference and explicit limits.
- [ ] Read final PR diff, ensure main is contained and working tree is clean.
- [x] List CI runs with timestamps and SHA; preserve/analyze failed logs and
      repair the missing changeset and read-only Deno regression failures.
- [ ] Repeat expanded runtime checks and wait for final required CI checks
      on the final pushed SHA before marking PR ready.

Large command output is retained in ignored `ci-logs/`. Experiments remain in
`experiments/`. Commands run within the shared 2.92 GiB memory budget. No global
Docker prune/reset/restart or unrelated state deletion is permitted. Recovery
journals survive failed verification. Real identities, credentials and listings
never enter committed reports. External access controls are respected.
