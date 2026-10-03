# Post-PR #89 revalidation — 2026-10-04

## Scope

This pass checked main [`2db81b3`](https://github.com/konard/vietnam-accomodation-search/commit/2db81b3e51b9dfe9a75c3eeebde80f648cd416f2), after PR [#89](https://github.com/konard/vietnam-accomodation-search/pull/89) closed #85–#88. Its baseline is the [post-PR #84 report](../revalidation-2026-10-03-pr84/README.md). Privacy rules are unchanged.

## Results per closed issue

| Issue                  | Retest                                                                                                                                                                                                                                                                                                                                                                                                | Verdict                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| #85 offer write bounds | `saveOffers`, `saveRecords('offers')`, and `updateRecords('offers')` given offers with raw GramJS photo buffers and 300 variants persist **0** byte links, with variants capped at 32. `migrateOffers` on the real PR #67 state shrank 1.9 GB / 156,467 files / 59 orphan chunks to **120 KB / 1 file**, and the offer to 10 KB. In the real audit, offers stay bounded and 91% of shards are reused. | **Fixed**. The 40-source gate is still blocked, now by #90.                                                                              |
| #86 deploy and tooling | `docker pull` failures keep Docker's cause in the message and the log (`exitCode 1`, stderr kept). Failures name the step, for example `waiting for readiness`, and report `Recovered: previous image and state restored` separately. Refused first deploys remove their data directory and `.deploy` record. With 50 browser-profile JS files in the data directory, lint takes 2.8 s.               | **Fixed**                                                                                                                                |
| #87 owner inputs       | Release Preflight [run 37147621556](https://github.com/konard/vietnam-accomodation-search/actions/runs/37147621556) still reports `0 verified, 2 failed`. There are no secrets, variables, release, pins, or rotation.                                                                                                                                                                                | **Not done** (closed a second time by a code-only PR). Successor: [#91](https://github.com/konard/vietnam-accomodation-search/issues/91) |

## Other gates

- `npm test` with real `clink` 0.2.11: **951/951**, 0 skipped. Lint, format, and duplication pass. Root and example audits: 0. Dependabot: 0 open. Security workflow green.
- The image is 597 MB with correct labels, runs as `node`, and includes `clink 0.2.11`. Host-bind smoke passes.
- Deploy drill (real token): first deploy healthy in 132 s; redeploy 45 s with the longest readiness gap **2.4 s** (4/312). Unhealthy candidate recovered in 24 s, rollback took 7 s. Typo'd directory refused with nothing created. Canary intact. No QA containers left.
- Browser audit: **10/10** routes, 1,603 segments.
- Telegram audit (PR #60 baseline): 8 sources in 25 min, versus 5 in 48 min before. Peak allocated 2.3 GiB, RSS 1.9 GiB, 0 negative timers. **Crashed at source 8** when `domain-records.lino` (64.5 MB → 262.9 MB, about 256k triples) exceeded the 256 MiB `parseNotation` cap. See [#90](https://github.com/konard/vietnam-accomodation-search/issues/90). Production caps that collection at 100k records by count but not by bytes.

## Verdict

**Not production ready.** Deployment, security, and the offer storage model now pass every check this QA loop can run locally. The remaining code blocker is that non-offer collections are monolithic and unbounded in bytes (#90), so the 40-source acceptance audit cannot complete. Publication and pinned live Telegram acceptance still need owner action (#91).
