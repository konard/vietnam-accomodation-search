# Issue 117 investigation and implementation plan

- [x] Read parent issue, all six sub-issues, and all issue/PR comment types.
- [x] Confirm prepared branch and initial clean working tree.
- [x] Read contributing guidelines and locate analogous fixes in recent merged PRs.
- [x] Enumerate every requirement and map each to implementations, alternatives, and acceptance evidence.
- [x] Research primary documentation and existing components for LinksStore collection contracts, Bun environment isolation, mtcute metadata, rental extraction, and publishing.
- [x] Inspect all parser entry points, audit checkpoint readers/writers, popularity consumers, subprocess tests, and release workflows.
- [x] Preserve failing CI logs with run timestamps and exact commit SHAs; identify each failure.
- [x] Add minimum failing regressions before each implementation change, including actual LinksStore and search/subscription consequences.
- [x] Fix #111 checkpoint collection names consistently without weakening validation; verify retained-store resume.
- [x] Fix #112 additive rent charges across Russian, English, and Vietnamese while preserving low legitimate rents.
- [x] Fix #113 child process dotenv isolation using synthetic credentials and an isolated working directory.
- [x] Fix #115 basic/full metadata popularity fallback and affected source ranking/discovery paths.
- [x] Fix #116 price and bedroom/kind association across mixed rental options and reviewed corpus regression.
- [x] Investigate #114 actual publishing prerequisites and available authorized credentials; run preflight and executable credentialed acceptance where possible. Record any operator-controlled acceptance that cannot be completed without credentials.
- [x] Keep reusable probes in experiments; bound any stack/memory stress tests and save verbose logs.
- [x] Add a patch changeset instead of manually changing package versions.
- [x] Run focused tests, reviewed corpus metrics, all runtime suites available locally, and contributing checks before atomic commits.
- [x] Fetch and merge the latest default branch into the prepared branch; preserve history.

Final PR acceptance is recorded on [PR #118](https://github.com/konard/vietnam-accomodation-search/pull/118), including the latest checked commit and workflow links:

- Push only issue-117-8e2b01a4284c; review the complete PR diff for scope, consistency, and regressions.
- Rewrite PR 118 title/body with exact requirement dispositions, reproduction/tests, source links, and closing references.
- Verify CI against the latest pushed SHA, download/analyze any failing logs, and fix failures.
- Confirm clean working tree, finish all background work, mark PR 118 ready, and report concrete remaining limits.
