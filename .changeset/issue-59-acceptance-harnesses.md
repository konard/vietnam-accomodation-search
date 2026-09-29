---
'vietnam-accomodation-search': patch
---

Write collections as schema v3, percent-encoding only the characters that `clink` trims from names and lines, so an exact verified export no longer reports missing and unexpected links; earlier schemas migrate under the write lock. Fail release preflight and the Docker configuration job on the committed `linux/amd64` + `linux/arm64` OCI policy instead of skipping image jobs, and record that policy in the release identity. On a failed deploy candidate, restore a digest-verified pre-cutover data snapshot with the exact prior image; keep deploy records per Compose project and refuse a rollback to an older data schema without `--restore-snapshot`. Fall back to the user client when the Bot API answers `chat not found` for a user's `@username`. Add identity-pinned native capability and message-level cutover E2E harnesses.
