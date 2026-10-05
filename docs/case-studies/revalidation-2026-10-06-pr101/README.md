# Post-PR #101 revalidation — 2026-10-06

## Scope

This pass checked main [`e9de903`](https://github.com/konard/vietnam-accomodation-search/commit/e9de903f803d1a4ab67d60f56c54cc4653ff575a), after PR [#101](https://github.com/konard/vietnam-accomodation-search/pull/101) closed #94–#100. It repeated the end-to-end product checks from the [post-PR #93 report](../revalidation-2026-10-04-pr93/README.md), re-parsed the same 996 real Telegram posts, and added a deploy on a realistic (3.5 GB) data directory. Only counts are recorded.

## Results per closed issue

| Issue                                   | Retest                                                                                                                                                                                                                                       | Verdict                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| #94 search returned nothing             | `search` returns real offers: 10 shown, 136 stored, prices consistent with titles 46/47 (the 47th a range minimum).                                                                                                                          | **Fixed**                                                                                            |
| #95 Docker browser                      | In-container `search` returns 10 offers in 185 s. Deploy self-checks `browser` and `search` pass.                                                                                                                                            | **Fixed**                                                                                            |
| #96 serial, unpersisted, leaking search | 184 s budget, offers persisted incrementally, uncollected sources reported on stderr, SIGTERM leaves no Chrome or clink on the host or in the container. But every search re-crawls and misses 24–26 of 48 sources.                          | **Mostly fixed**. Successor [#104](https://github.com/konard/vietnam-accomodation-search/issues/104) |
| #97 live extraction                     | Same 996 posts: sold-out 653/653 → `unavailable` (0 `availableNow`), location missing 1 (was 419), price 816/833 = **0.980** against any listed rent option (was 0.817). 7 posts with `Договор N–M месяцев:` lines still yield 50k–200k VND. | **Mostly fixed**. Successor [#103](https://github.com/konard/vietnam-accomodation-search/issues/103) |
| #98 warnings                            | `LINT_ALL_WARNINGS` 0, CodeQL 0 open, Dependabot 0, audits 0/0.                                                                                                                                                                              | **Fixed**                                                                                            |
| #99 owner inputs                        | Release Preflight still fails. No secrets, release, pins, or rotation.                                                                                                                                                                       | **Not done**. Successor [#106](https://github.com/konard/vietnam-accomodation-search/issues/106)     |

## New findings

- **Gate errors** ([#102](https://github.com/konard/vietnam-accomodation-search/issues/102)): the browser acceptance run exits 1 because USD rents are compared as VND converted at a frozen 26,000 rate; all 8 "wrong prices" are correct extractions at today's rate. `availability` reports `pass: true` with 0 cases, and the 275-case corpus has no availability labels.
- **Deploy on real-size data fails** ([#107](https://github.com/konard/vietnam-accomodation-search/issues/107)): the app is ready in 36 s on the host and 40 s in the container, but the deploy's fixed ~48 s wait plus the 15 s healthcheck interval make it fail.
- **Audit throughput** ([#108](https://github.com/konard/vietnam-accomodation-search/issues/108)): a resume spent 56 min re-projecting with 0 sources processed. The full run needs ~6 h.
- **Flaky test** ([#105](https://github.com/konard/vietnam-accomodation-search/issues/105)): `npm test` was 1124/1125 under load. The SIGKILL-escalation timing test passes 5/5 when run alone.

## Other gates

- Tests: 1,124/1,125 under load; the single failure is #105. No Node warnings. Lint, format pass; duplication 5.56%.
- Image 597 MB. Deploy on QA data: redeploy 63 s, readiness gap 3.3 s, rollback 7 s, canary intact.
- Browser cohort: 9/10 sites (newhomenhatrang navigation timeout, collected fine by the product search). Product-search fields offer, period, location, and rooms are 1.0. Price is 0.849 because of the gate error in #102.

## Verdict

**Much closer, but not yet "no errors, no false positives/negatives".** Search works end to end on the host and in Docker, and Telegram extraction is now about 98% accurate on prices with sold-out posts handled. Remaining: a residual price pattern (#103), gates that misjudge (#102), search coverage per call (#104), deploys on real-size data (#107), audit throughput (#108), a flaky test (#105), and owner inputs (#106).
