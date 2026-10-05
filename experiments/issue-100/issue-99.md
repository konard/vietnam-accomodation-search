title: Owner inputs still missing (successor of #80/#87/#91): npm/Docker Hub credentials, token rotation, drill bot and pins
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
number: 99
--

This is the same blocker as #80, #87, and #91. Code-only PRs (#84, #89, #93) closed all three without the required owner action. Rechecked on main `49dcb18` (2026-10-04): [Release Preflight run 37166763785](https://github.com/konard/vietnam-accomodation-search/actions/runs/37166763785) still has `0 verified, 2 failed` (no `NPM_TOKEN`, no `DOCKERHUB_*`). `gh secret list` and `gh variable list` are empty. There is no tag and no release. The pinned live Telegram E2E and cutover drill still lack identity pins, a driver account, and a separate drill bot. The bot token has not been rotated.

**Owner actions:** add `NPM_TOKEN` and `DOCKERHUB_TOKEN` as secrets and `DOCKERHUB_IMAGE` and `DOCKERHUB_USERNAME` as variables, rotate the bot token, and provide a drill bot, a driver account, and numeric pins.

**For the implementing agent:** exclude this issue from any "fixes" list. It closes only when Release Preflight passes and a release exists.
