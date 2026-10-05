title: Product search returns nothing from all 60 sources since 2026-09-23: invalid store collection "browser-domain-cooldown"; tests/audit report success
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
number: 94
--

## Summary

On main [`49dcb18`](https://github.com/konard/vietnam-accomodation-search/commit/49dcb1830094e8e7e14d40978c4974ab54dd4fcf), the product's search returns **no offers from any source**, and it reports this as a normal empty result. The browser collector persists its per-domain pacing in the store collection `'browser-domain-cooldown'` ([`src/browser-adapters.js#L165-L190`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/src/browser-adapters.js#L165-L190)). But [`validKind()` in `src/links-store.js#L399-L404`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/src/links-store.js#L399-L404) accepts only names matching `/^[a-z][a-z\d-]*s$/`, which must end in **s**. Every source therefore fails at its first cooldown read, before any navigation.

Both the CLI `search` and the bot's `/search` use `SearchService.search()`, so both are affected. `validKind` landed on 2026-09-22 (`cf645fa`) and the cooldown store on 2026-09-23 (`925e282`), so **product search has been broken since 2026-09-23**.

## Reproduction (host, real network, empty data directory)

```bash
DATA_DIRECTORY=$(mktemp -d) node bin/vietnam-accomodation-search.js search "Nha Trang apartment for rent"
# → "No current offers with a comparable price were found."  exit 0, after 2 s
```

Traces in that data directory show `search success {"candidates":0,"refresh":true,"returned":0,"sources":60}`. There are **60/60** `collection failure` records, all `Invalid record collection: browser-domain-cooldown`: 20 web sources and 40 Telegram public-preview sources. Renaming the collection to `'browser-domain-cooldowns'` in a scratch worktree makes the collector actually navigate. That was not committed.

## Why tests and acceptance missed it

These are false positives:

- [`tests/issue-20-edge-cases.test.js#L228`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/tests/issue-20-edge-cases.test.js#L228) asserts the collection name against a **fake store** that never validates names.
- [`experiments/audit-browser-real-estate.mjs`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/experiments/audit-browser-real-estate.mjs) keeps its own `browser-audit-cooldowns.json` and never builds the product `SearchService`/`LinksStore`. It reports 10/10 `success` while the product fails 60/60.
- The audit's `success` means only that page segments were _consumed_. It does not persist or check the extracted offers, so wrong values (a wrong price field, a sale listing on a rent route) cannot be detected.
- `SearchService` turns "every source failed" into an empty result, and the CLI exits 0. `/ready` stays 200.

## Acceptance criteria

- [ ] Rename the collection to a valid plural (for example `browser-domain-cooldowns`), or make `validKind` accept it. Migrate or ignore any existing file.
- [ ] Add an integration test that runs `createApplication()` with a **real** `LinksStore` in a temp directory and a stubbed browser runtime, calls `service.search()`, and asserts that offers are returned and the cooldown is persisted. Add a test that every collection name used in `src/` passes `validKind`.
- [ ] When every source fails, `search` says so: the CLI exits non-zero (or prints "all N sources failed: <category>"), the bot reply says sources failed rather than "no offers", and a metric or log is emitted.
- [ ] Make the browser acceptance audit go through the product `SearchService` and store, persist the extracted offers, and check field correctness against a small human-reviewed live sample (price, period, intent rent vs sale, location, rooms), reporting precision and recall.
