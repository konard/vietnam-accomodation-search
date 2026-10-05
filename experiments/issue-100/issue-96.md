title: Search over 60 sources is serial (>60 min), persists nothing until the end, leaks Chrome on interruption; 21/29 product web sources never acceptance-tested
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
number: 96
--

## Summary

These are what's left once #94 is patched locally, renaming the collection to `browser-domain-cooldowns` in a scratch worktree, so that `search` can actually navigate. Main is [`49dcb18`](https://github.com/konard/vietnam-accomodation-search/commit/49dcb1830094e8e7e14d40978c4974ab54dd4fcf).

Even then, one product search **does not finish in 60 minutes**, never returns a result, and an interrupted run loses everything and leaks the browser.

## Evidence (host, real network, empty data directory, query "Nha Trang apartment for rent")

| run | limit                               | result                                                                                                 |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | 25 min                              | killed (exit 124). 0 offers. **0 traces** persisted. Only `browser-domain-cooldowns.lino` was written. |
| 2   | 60 min                              | killed (exit 124). Same: no offers, no traces.                                                         |
| 3   | 20 min, page URL sampled every 30 s | 20 web domains visited in ~19 min, one at a time. The 40 Telegram previews had not started.            |

1. **Sources are serial.** [`BrowserCollector.collect()`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/src/browser-collector.js#L623-L650) visits all 60 sources (29 web + 21×2 Telegram previews) one at a time in one page, with polite per-domain pacing. Pacing is per **domain**, but nothing runs different domains in parallel, which the original requirement allows. With cooldown waits, the run takes over an hour. A bot `/search` on a cold or stale cache cannot answer in a usable time.
2. **Nothing is persisted until every source finishes.** [`SearchService.search()`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/src/search-service.js#L224-L240) saves offers once, after `collect()` returns. Traces are not flushed either. A timeout, crash, or redeploy mid-search discards every offer already parsed and **all logs of what happened**. That contradicts the requirement that every parsing stage leaves logs and traces.
3. **The browser leaks on interruption.** After `SIGTERM`, Chrome is re-parented to PID 1 and keeps running. Three leaked trees (about 14 processes each) stayed alive for over 1h46m until killed by hand. The CLI `search` path installs no signal handler. Only [`telegram-runtime.js#L414`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/src/telegram-runtime.js#L414) does. In a container, every cancelled search would keep a browser alive until the container restarts.
4. **Most product sources are never acceptance-tested.** `DEFAULT_WEB_SOURCES` has 29 domains, mostly large booking sites: booking, airbnb, agoda, traveloka, expedia, hotels.com, trip.com, hostelworld, google travel, tripadvisor, vrbo, klook, kayak, trivago, skyscanner, vntrip, ivivu, mytour, batdongsan, nhatot, and hotelmix. The browser acceptance audit covers **8 of them** (plus 2 not in the product list). On the first run, trivago and skyscanner were classified `challenge` and hotels.com `transient` within minutes. Nothing shows whether the other 21 yield correct offers or only challenges.

## Acceptance criteria

- [ ] Run different domains concurrently with bounded parallelism (for example 4) while keeping per-domain pacing and cooldowns. Give each source a hard timeout. The cold-cache search must finish within a stated budget (for example ≤ 3 min), returning partial results and listing sources still pending or failed.
- [ ] Persist offers and traces **per source** as each completes, so an interrupted search keeps finished work and its full trace.
- [ ] `search` (CLI and bot) handles `SIGINT`/`SIGTERM`/abort by closing the browser. Add a test that the spawned browser process is gone after an abort.
- [ ] Either add each default source to the acceptance cohort with a reviewed live sample, or drop and disable sources that only return challenges. Report per-source outcome (offers / challenge / blocked / error) in the search result and trace.
