# Local real-credential revalidation of PR #110

Tested main [`e220d9f`](https://github.com/konard/vietnam-accomodation-search/commit/e220d9f4e2359dcb8f69329a02cf68c6688f9966) on 2026-10-06, continuing the [PR #101 revalidation](../revalidation-2026-10-06-pr101/README.md). The checkout was fast-forwarded from `908f324`. Existing credentials, retained source journals, and a copy of the real data were available on the local machine. Production code was not changed; confirmed defects are assigned to separate issues.

## Executed checks

| Check                                                              | Result                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 24.18.0, real clink 0.2.11                                    | **1,156/1,156 pass**, no skips; 31.20 seconds                                                                                                                                     |
| Sequential Node coverage, real clink                               | **1,156/1,156 pass**; 100% product line coverage; 131.01 seconds                                                                                                                  |
| Current Bun 1.4.2, real clink, isolated checkout without `.env`    | **1,156/1,156 pass**; 55.87 seconds                                                                                                                                               |
| Current Deno 2.9.6, documented `--allow-read`                      | **1,051 tests and 19 steps pass**, no failures; 12 seconds                                                                                                                        |
| Lint, strict repository ESLint, tracked-file formatting            | Pass, zero lint warnings                                                                                                                                                          |
| Duplication                                                        | Pass, 5.47% duplicated lines                                                                                                                                                      |
| Root and example npm audits                                        | Zero vulnerabilities in both                                                                                                                                                      |
| Open CodeQL and Dependabot alerts                                  | Zero in both                                                                                                                                                                      |
| Example web build                                                  | Pass                                                                                                                                                                              |
| Local npm tarball install, library parser/import and installed CLI | Pass; credential/data files absent from package                                                                                                                                   |
| Host and hardened-container production browser/search self-checks  | Pass; actual browser and fixture search                                                                                                                                           |
| Local production Docker build                                      | Pass; linux/arm64, Node 24.21.0, clink 0.2.11, non-root user; image 597,204,307 bytes                                                                                             |
| Host bind persistence across container removal                     | Pass                                                                                                                                                                              |
| Live browser acceptance cohort                                     | **10/10 sites successful**                                                                                                                                                        |
| Product live field scoring                                         | **51 matched reviewed listings**; every evaluated field has precision/recall 1.0; availability explicitly not evaluated because there are no positive cases in this web match set |

The original local Bun 1.2.20 also exposed an old server-close behavior; upgrading only the isolated test runtime removed it. Deno 2.4.5 failed on a bare Node built-in import that current Deno accepts. Neither outdated runtime failure was counted as an application acceptance result. The current Bun failure with the real root `.env` is separately reproducible and tracked in #113.

The 299-case reviewed corpus meets its configured gates. Availability has 21 explicit unavailable positives, so its gate now evaluates actual cases. The room gate still contains one false positive (`0` bedrooms versus reviewed unknown); this is #116 and must not be described as perfect extraction.

## Real search and caching

A cold `Nha Trang` search with default pacing/budget and real binary persistence selected 37 matching sources. Its first pass finished in 187.86 seconds: 23 sources succeeded, four timed out and ten remained pending. The next pass skipped the successful fresh sources and processed the remaining 14, all successfully, in 187.61 seconds. Together the two passes covered all 37 matching sources; the formerly named foreign-city channels were excluded.

A fresh application instance then returned the cached ten results in 7.19 seconds without source collection. All 178 saved offers reloaded from another real-clink store. No explicitly unavailable offer appeared in the default results. The live browser audit independently persisted 158 offers and matched 51 reviewed cards without the old USD/VND rate false failures.

## Actual Telegram E2E with the existing credentials

The configured real bot token passed `getMe`; no webhook or queued updates were present before testing. The existing user session was authorized. Verified IDs were supplied to the conversation harness in memory. Existing independently supplied pins, when present, remain checks rather than being overwritten.

Both **bot-only** and **degraded combined** conversation modes passed using the actual Telegram network. Tests saved and selected a preset, subscribed, received an offer, restarted the bot, verified persisted preset/subscription state and absence of duplicate delivery, searched with filters, unsubscribed and deleted the test preset. The offer cache was synthetic for deterministic conversation assertions; source collection was exercised separately against real listings. Each run deleted all created messages and reread the conversation with zero leftovers.

The reusable [credential wrapper](../../../experiments/telegram-local-credential-e2e.mjs) was also executed against those real credentials and passed. A separate test bot/account was not needed for these runs.

Native user capabilities were tested by converting the existing authorized GramJS session **only in memory** with the official [`@mtcute/convert` API](https://mtcute.dev/guide/advanced/session-convert), version 0.32.4. The resulting native identity matched the original user. Native entity resolution, membership, public history, a 132,881-byte live photo download, sending, live updates, availability inquiries and combined-route restart idempotency all passed. Messages stayed between the user's own bot and account; all four marked messages were removed and reread with zero leftovers. A competing connection sharing the same user authorization made an early update observation intermittent; the final isolated run passed. Popularity remained a reproducible failure: the provider returned null while full Telegram metadata supplied 678 members (#115).

These are executed transport checks. The pre-existing capability harness's independent three-account scenario was not run or counted as passing.

## Docker deployment with retained data

An isolated copy of the real canonical/binary data occupied approximately 3.6 GiB before startup and 3.8 GiB after the drill. The standard deploy helper built this exact commit and used the actual bot token on a local port with the normal hardened Compose settings.

- First deployment became healthy after **74 seconds**, within the new 300-second readiness budget.
- Redeployment became healthy after **96 seconds** and retained the copied state.
- Rollback became healthy after **200 seconds** while other local validation was running, still within the new budget.
- The final container was healthy with zero restarts. The bot was then stopped. No competing bot pollers were left running.

These actual large-data startup measurements establish more than the synthetic readiness drill. They do not claim a measured Telegram response outage during every deployment transition. The default two-second startup health probes and five-minute grace were present in the built image.

## Remaining defects and acceptance limits

| Issue                                                                    | Confirmed finding                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#111](https://github.com/konard/vietnam-accomodation-search/issues/111) | The unmodified protected audit fails after successful credential authorization: `audit-cohort` violates the real plural collection-name contract. Its mocked progress tests miss this.                                  |
| [#112](https://github.com/konard/vietnam-accomodation-search/issues/112) | A conditional `+500,000 VND/month` surcharge is selected as standalone rent rather than the 6.8M/7.8M options. Cheapest and maximum-price filters can accept the false cheap rent.                                      |
| [#113](https://github.com/konard/vietnam-accomodation-search/issues/113) | Current Bun's subprocess autoloads the real `.env` despite its cleared environment and the parent's `--no-env-file`; the fingerprint unit test fails in the credentialed checkout. The clean isolated suite passes.     |
| [#114](https://github.com/konard/vietnam-accomodation-search/issues/114) | Actual latest main Release Preflight fails: npm bootstrap authentication and required image-publishing configuration are absent. Repository secrets/variables/releases are empty; token rotation has not been verified. |
| [#115](https://github.com/konard/vietnam-accomodation-search/issues/115) | Native popularity uses basic chat metadata and loses an available member count.                                                                                                                                         |
| [#116](https://github.com/konard/vietnam-accomodation-search/issues/116) | The cheaper apartment option inherits the zero-bedroom marker of a different, more expensive studio option. This is the remaining reviewed-corpus room false positive.                                                  |

Re-parsing both retained journals processed 1,232 offers, including the original 996-post cohort. All 653 sold-out posts became unavailable and none became `availableNow`; one location remained unknown. Of 833 rent-labelled cases, 831 matched the bounded rent-reference section. One residual is the verified surcharge defect. The other source quotes 8M in its main rent section and a second explicitly labelled 7M rent under additional expenses; that ambiguous source is not evidence of a second parser defect.

For diagnosis only, a private harness aliased the invalid cohort name on a copied audit store. Source 1 completed in 142 seconds and source 2 in 272 seconds. The diagnostic was stopped during source 3 after sufficient timing evidence; the original retained data were untouched. **No complete 40-source pass or second pass is established**, and diagnostic alias results do not count as acceptance of the unmodified product. #111 must be fixed before that acceptance can run.

The actual main release workflow [37394041592](https://github.com/konard/vietnam-accomodation-search/actions/runs/37394041592), created at `2026-10-06T00:26:45Z` for the tested SHA, reports 0 verified and 2 failed publishing prerequisites. Security, example-app and link workflows passed. Local release-mode preflight independently failed on the same publishing requirements; OIDC was additionally unknown outside Actions.

## Reproducing and continuing

```bash
# Offline diagnostics: exit 1 while the reported defects remain.
node experiments/revalidation-pr110-regressions.mjs

# Actual bot/user conversation; pins are resolved and checked in memory.
TELEGRAM_CONVERSATION_E2E=1 node experiments/telegram-local-credential-e2e.mjs \
  --bot-env /protected/bot.env --user-env /protected/user.env
TELEGRAM_CONVERSATION_E2E=1 node experiments/telegram-local-credential-e2e.mjs \
  --bot-env /protected/bot.env --user-env /protected/user.env --mode degraded
```

Private raw logs, journals, copied data and temporary tooling remain in the ignored `.vietnam-accomodation-search/local-revalidation-pr110-2026-10-06/` directory with restricted permissions. They are deliberately excluded from this commit. Test Telegram messages, pollers and audit children were cleaned up; the copied data and deployment snapshots remain available for the next pass. Only reusable experiments and this sanitized report are committed.
