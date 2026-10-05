title: 4 open CodeQL alerts in release tooling and 11 lint warnings hidden by the changed-lines filter
state: OPEN
author: konard (Konstantin Diachenko)
labels:
comments: 0
assignees:
projects:
milestone:
issue-type:
parent: konard/vietnam-accomodation-search#100
sub-issues:
sub-issues-completed:
blocked-by:
blocking:
number: 98
--

## Summary

On main [`49dcb18`](https://github.com/konard/vietnam-accomodation-search/commit/49dcb1830094e8e7e14d40978c4974ab54dd4fcf), the deterministic gates are green: 965/965 tests with real `clink`, no Node runtime warnings, no CI warning annotations, and `npm audit` 0/0 for root and example. Two kinds of warnings are still open, and the default tooling hides them.

### 1. Four open CodeQL code-scanning alerts (open since 2026-09-21)

| #   | rule                                          | location                                                                                                                                                                                                                                |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `js/incomplete-url-substring-sanitization`    | [`docs/case-studies/issue-3/original-format-release-notes.mjs:87`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/docs/case-studies/issue-3/original-format-release-notes.mjs#L87) |
| 2   | `js/incomplete-url-substring-sanitization`    | [`scripts/format-release-notes.mjs:102`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/scripts/format-release-notes.mjs#L102): `'img.shields.io'` matched anywhere in the URL     |
| 3   | `js/incomplete-sanitization`                  | [`scripts/version-and-commit.mjs:287`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/scripts/version-and-commit.mjs#L287): backslashes not escaped                                |
| 4   | `js/shell-command-injection-from-environment` | [`experiments/test-changeset-scripts.mjs:52`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/experiments/test-changeset-scripts.mjs#L52)                                           |

These are release and experiment tooling, not the runtime, but #2 and #3 run in the release workflow with repository write permissions.

### 2. Eleven ESLint warnings hidden by the changed-lines filter

`npm run lint` prints only `11 warning(s) on unchanged lines were not reported`. `LINT_ALL_WARNINGS=1` shows 11 `local/no-changelog-comments` warnings in `experiments/test-failure-detection.mjs` (2), `scripts/check-release-needed.mjs`, `scripts/js-paths.mjs`, `scripts/update-preview-images.mjs`, `tests/check-changesets.test.js`, `tests/create-github-release.test.js` (2), `tests/package-info.test.js`, `tests/release-badge.test.js`, and `tests/tag-prefix.test.js`.

## Acceptance criteria

- [ ] Fix or dismiss each CodeQL alert with a written justification. Parse the URL and compare `hostname`, escape backslashes, and avoid shell interpolation of environment paths.
- [ ] `LINT_ALL_WARNINGS=1 npm run lint` reports 0 warnings.
- [ ] Optionally, fail CI on new code-scanning alerts.
