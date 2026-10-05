title: Docker deployment cannot launch Chromium for search (sandbox); deploy smoke test uses --no-sandbox Playwright and passes falsely
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
number: 95
--

## Summary

In the shipped Docker deployment, browser search cannot start Chromium. The deploy smoke test hides this because it launches Chromium a different way.

Reproduced on main [`49dcb18`](https://github.com/konard/vietnam-accomodation-search/commit/49dcb1830094e8e7e14d40978c4974ab54dd4fcf). The image was built locally from this commit and deployed with `scripts/deploy.mjs`, healthy, `/ready` 200:

```bash
docker exec vac-qa-app-1 node bin/vietnam-accomodation-search.js search "Nha Trang apartment"
# → Browser exited before its DevTools endpoint was ready (exit 0)   exit 1, immediately
docker exec -e BROWSER_NO_SANDBOX=1 vac-qa-app-1 node bin/vietnam-accomodation-search.js search "Nha Trang apartment"
# → Chromium starts (the run then hits #94's store error)
```

- The app launches through browser-commander's real-browser spawn with no sandbox flags unless `BROWSER_NO_SANDBOX=1` ([`src/application.js#L34-L59`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/src/application.js#L34-L59)). The container runs as the unprivileged `node` user with the default seccomp profile, a read-only root, and no user namespaces, so Chrome's sandbox cannot start and it exits 0.
- The deploy smoke test ([`scripts/deploy.mjs#L288`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/scripts/deploy.mjs#L288)) instead runs `chromium.launch({ args: ['--no-sandbox'] })` through plain Playwright, which succeeds. Every deploy passes its browser check, and then the app cannot browse. Plain Playwright with `--no-sandbox` also prints `playwright-ok` in the same container.
- Neither [`compose.yaml`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/compose.yaml) nor [`.env.example`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/.env.example) sets `BROWSER_NO_SANDBOX`. Only the README mentions it.

## Acceptance criteria

- [ ] Make browser launch work in the shipped container by default. Either give the container what Chromium's sandbox needs (for example a dedicated seccomp profile), or set `BROWSER_NO_SANDBOX=1` in `compose.yaml` with the risk documented. Decide and document which.
- [ ] Change the deploy smoke test to exercise **the app's own launch path**: `createApplication()` browser runtime, same options, opening a `data:` page. It must fail the candidate when that path fails.
- [ ] Add an in-container check, in CI or the drill, that runs one real `search` against a local fixture page and asserts at least one offer.
