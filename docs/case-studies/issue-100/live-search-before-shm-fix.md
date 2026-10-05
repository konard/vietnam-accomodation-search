# Live search before the shared-memory fix

`node experiments/issue-96-live-search.mjs` against all 60 default sources,
BROWSER_NO_SANDBOX=1, empty data directory, host /dev/shm of 64 MB.

- elapsed 186444 ms (budget 180000 ms), 0 offers
- outcomes: 38 error, 4 timeout, 17 pending, 1 empty
- all 38 errors were `page.evaluate: Target crashed` and came after the first
  crash: the pool reused crashed pages for every following source

`experiments/issue-96-renderer-crash.mjs` (4 pages, heavy booking pages):

| launch switches                | runs | failed loads |
| ------------------------------ | ---- | ------------ |
| browser-commander default      | 3    | 12, 12, 9    |
| plus `--disable-dev-shm-usage` | 3    | 0, 0, 0      |

The default run fails with `net::ERR_INSUFFICIENT_RESOURCES`, then every page
reports `Target page, context or browser has been closed`. Playwright's own
Chromium launcher passes `--disable-dev-shm-usage`; browser-commander's real
launch does not.
