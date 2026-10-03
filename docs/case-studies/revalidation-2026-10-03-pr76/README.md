# Post-PR #76 revalidation — 2026-10-03

## Scope and privacy

This pass checked main commit [`2421098`](https://github.com/konard/vietnam-accomodation-search/commit/2421098e9d2c0f4bac8cf64b00f7a10b3e199652), after PR [#76](https://github.com/konard/vietnam-accomodation-search/pull/76) closed #68–#75. As before, closed issues were not reopened; new issues track the gaps. Credentials, sessions, source identities, raw posts, and browser traces stay in ignored mode-`0700` directories. The deploy drill ran on an isolated Compose project and data directory with the real bot token, and no Telegram messages were sent. The bot token was used only for `getMe` and polling.

## Deterministic and release gates

| Check                                                                                                                 | Result                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` with Node 24.18.0 and real Rust `clink` 0.2.11 on `PATH`                                                   | **868/868 pass, 0 skipped**. The #68 indexed-offer order regression is fixed.                                                                                                                                                                                                                                                                      |
| `npm run lint`, `prettier --check`, `jscpd`                                                                           | pass                                                                                                                                                                                                                                                                                                                                               |
| `npm audit` root (full and `--omit=dev`)                                                                              | 0 vulnerabilities                                                                                                                                                                                                                                                                                                                                  |
| `npm audit` example app                                                                                               | **8 high**, one chain to `http-cache-semantics@4.2.0` ([GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), no patch). This fails the [Security run 37102108265](https://github.com/konard/vietnam-accomodation-search/actions/runs/37102108265). See [#79](https://github.com/konard/vietnam-accomodation-search/issues/79). |
| Example web build                                                                                                     | pass                                                                                                                                                                                                                                                                                                                                               |
| Release Preflight ([run 37102108263](https://github.com/konard/vietnam-accomodation-search/actions/runs/37102108263)) | fails: no bootstrap `NPM_TOKEN`, no Docker Hub configuration. There is no tag, no release, and no npm package. See [#80](https://github.com/konard/vietnam-accomodation-search/issues/80).                                                                                                                                                         |

## Docker image and deployment drill

The local image for this commit has OCI labels matching `0.12.3`/`2421098`, runs as `node` with `/data` as its only volume, and contains `clink 0.2.11` and Node `v24.21.0`. Its size grew from 589 MB to 942 MB. [`experiments/docker-bind-persistence-smoke.sh`](../../../experiments/docker-bind-persistence-smoke.sh) passed.

`scripts/deploy.mjs` drill (project `vac-qa-pr76`, `HEALTH_PORT=18476`, real bot token):

| Step                                                 | Result                                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First deploy (build from source)                     | healthy in 102 s, bot-only, `/ready` 200                                                                                                                                                        |
| Redeploy under `measure-deploy-handoff.mjs` (250 ms) | 21 s total. Longest `/ready` gap **2.8 s** (5/509 samples failed). Bot API `getMe` 0/509 failures. Snapshot written.                                                                            |
| Unhealthy candidate (drill `unhealthyComposeFile`)   | detected in 29 s. The exact previous image ID was restored and a `/data` canary was intact. Exit 1.                                                                                             |
| `rollback` / `status`                                | 6 s, healthy                                                                                                                                                                                    |
| `stop` + `compose down` + deploy                     | canary survived container removal                                                                                                                                                               |
| Data-directory guards                                | symlink, `$HOME`, `/`, and a file were rejected. A `0755` directory was tightened to `0700`.                                                                                                    |
| Mistyped `--data-directory` on redeploy              | **defect**: an empty directory was created, the bot was cut over to it, and the deploy exited 0. See [#77](https://github.com/konard/vietnam-accomodation-search/issues/77).                    |
| Second project, same token                           | **defect**: reported healthy, then both bots crash-looped on 409 while `/ready` returned 200. See [#78](https://github.com/konard/vietnam-accomodation-search/issues/78).                       |
| UX                                                   | raw `command-stream` dumps, a container left behind by a failed first deploy, no port preflight, Node 22 doc drift. See [#81](https://github.com/konard/vietnam-accomodation-search/issues/81). |

## Live sources

The **browser** audit (`experiments/audit-browser-real-estate.mjs`) passed **10/10** routes with 1,606 `parser.segment_consumed` events and 0 site failures.

For the **Telegram** 40-source audit, `experiments/diagnose-telegram-audit.mjs` resumed a copy of the PR #60 state with a 6 GiB allocation cap, a 15 GiB free-space floor, and `--trace-warnings`. It was stopped after 36 minutes. By then it had **1/40** complete source checkpoints, **no** committed `offers.index.json`, 72 chunk directories, and had grown from 421 MiB to **2.83 GiB** across **219,889 files** (39,318 projections, peak RSS 899 MiB). There were no `TimeoutNegativeWarning`s. The cause is that `mediaIdentity()` stores entire GramJS media objects, including per-byte thumbnail and `fileReference` data, as photo IDs, four times per offer: about 2.2 MB of LiNo per offer. See [#82](https://github.com/konard/vietnam-accomodation-search/issues/82). It lies on the product ingestion path as well as the audit.

The **native Telegram E2E and cutover drill** both fail closed before any network call because the independent numeric identity pins and a separate driver/drill account are not provided. They were not fabricated. See [#80](https://github.com/konard/vietnam-accomodation-search/issues/80).

## New issue map

| Issue                                                                  | Required result                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [#77](https://github.com/konard/vietnam-accomodation-search/issues/77) | Refuse a changed or missing data directory on redeploy.                           |
| [#78](https://github.com/konard/vietnam-accomodation-search/issues/78) | Make 409 conflicts unready, bounded, detected by deploy, and guarded per token.   |
| [#79](https://github.com/konard/vietnam-accomodation-search/issues/79) | Resolve the unpatched example advisory and turn Security green.                   |
| [#80](https://github.com/konard/vietnam-accomodation-search/issues/80) | Owner inputs: registry credentials, token rotation, drill bot, and identity pins. |
| [#81](https://github.com/konard/vietnam-accomodation-search/issues/81) | Deploy error output, cleanup, port preflight, docs, and image size.               |
| [#82](https://github.com/konard/vietnam-accomodation-search/issues/82) | Store media IDs instead of raw objects, migrate, then finish the 40-source audit. |

## Acceptance verdict

**Not production ready.** The positive results: the deterministic suite with real `clink` is green, the browser cohort passes, and the redeploy, failed-candidate restore, rollback, and host-bind persistence all work locally with a measured 2.8 s handoff. The blockers: real Telegram ingestion stores megabytes of raw media per offer and cannot complete the 40-source audit (#82); deploy has two operator-error paths that drop live state or take the bot down (#77, #78); Security CI is red (#79); and publication plus pinned live Telegram acceptance still wait on owner inputs (#80).
