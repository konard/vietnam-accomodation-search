# Issue 1 revalidation evidence

## Environment and reproducibility

- Branch: `issue-10-395da7baa3de`
- Base commit: `4057b5cd0c14dbe0e7bbff37ddded21b9052f4d0`
- UTC evidence date: 2026-09-22
- Runtime: Node 22+; exact local/container versions are emitted in the PR test log
- Image: locally built from the digest-pinned `Dockerfile`; CI records the
  resulting immutable image digest
- Secrets: none were available or printed in this development environment

Reproduce the sanitized gates:

```bash
npm ci
npm test
npm run test:coverage
npm run check
cargo install link-cli --version 0.2.10 --locked
node --test tests/associative-storage.test.js tests/docker-runtime.test.js
docker build -t vietnam-accommodation-search:issue-10 .
ENV_FILE=.env.example docker compose config
```

## Requirement-to-code-to-test traceability

| Requirement                                         | Primary code                                                     | Regression evidence                                         | Live/degraded evidence                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Authorized bot commands                             | `telegram-access.js`, `telegram-bot.js`                          | `telegram-operations`, `telegram-bot`                       | No token: preflight refuses startup; private mode refuses absent numeric allowlist               |
| Bot/user/both routing                               | `telegram-capabilities.js`                                       | matrix, fallback, ambiguous-send tests                      | No credentials: capability-unavailable diagnostics; user-only has no bot command surface         |
| 20+20+Nha Trang sources and ranking evidence        | `sources.js`, `source-discovery.js`                              | source and Nha Trang suites                                 | Evidence URLs/timestamps remain in persisted source records; popularity is time-sensitive        |
| UI-only collection/update                           | `browser-collector.js`                                           | browser DOM/collector suites                                | Browser Commander remains the only web boundary; inaccessible/CAPTCHA sources degrade per source |
| Strict two-month Telegram collection and provenance | `browser-collector.js`, `telegram-history.js`, `telegram-bot.js` | browser pagination, MTProto cutoff, reconciliation suites   | Private history unavailable in bot-only mode by Telegram design; public preview continues        |
| Multilingual types and unknown fields               | `listing-parser.js`, `links-store.js`                            | core/parser/associative round trips                         | Unknown labels and raw source values remain inspectable in LiNo                                  |
| Ten photos and shared 10 GiB                        | `media-cache.js`, `links-store.js`                               | media eviction and budget tests                             | Eviction removes local blob pointers but retains remote URLs                                     |
| VND, period, cheapest 1..50                         | `pricing.js`, `commands.js`, `search-service.js`                 | pricing/search command suites                               | Exchange data is timestamped at collection; unavailable rates skip incomparable offers           |
| Official price events                               | `offers.js`, `browser-collector.js`                              | offer reconciliation tests                                  | Only `official-web` observations create official change events                                   |
| Explicit availability, authorization, no duplicates | `telegram-user.js`, router/access policy                         | availability, access, ambiguous-send tests                  | No user session: precise credential error; no automatic contact occurs                           |
| Presets/ranges/unseen subscriptions/restart         | `presets.js`, bot/application wiring                             | parser, restart, grouped/partial delivery tests             | User-only mode reports Bot API delivery unavailable; bot/combined modes use bot delivery         |
| Canonical LiNo + `clink` recovery                   | `links-store.js`, `link-cli-mirror.js`                           | real import/export, kill point, stale/concurrent lock tests | Pointer deletion rebuilds from canonical hash; failed binary stage never publishes text          |
| Docker redeploy/rollback/shutdown                   | Docker/Compose/deploy/runtime                                    | structural, runtime, CI image-health tests                  | One-token long polling requires a measured controlled handoff; pollers never overlap             |
| Security/ToS                                        | access/auth/errors/browser URL checks                            | redaction, authorization, SSRF tests                        | No auto-join, bypass, owner contact, or raw-update logging                                       |
| Node/Bun/Deno/Docker amd64/arm64 gates              | release workflow                                                 | local full tests plus CI matrix                             | Registry manifest verification requires configured Docker Hub variables/secrets                  |

## Source cohort evidence

Seed source records contain metric, numeric value, evidence URL, and observation
time. `/update_sources` refreshes multilingual web search evidence and Telegram
preview member/subscriber counts, keeping 20 ranked web, 20 nationwide
Telegram, and 20 independently ranked Nha Trang sources. Because popularity is
volatile, a fixture value is not presented as a current live claim; the
persisted deployment snapshot is authoritative.

## Recovery and fallback demonstrations

- A binary-stage exception leaves canonical text unchanged.
- An interruption after text commit and before pointer activation is detected
  and repaired on read.
- A dead process lock is recovered; two real Node writer processes retain both
  offers.
- Removing a binary pointer triggers hash-matched `clink` rebuild.
- Media budget eviction preserves remote photo URLs.
- Safe bot capability rejection falls back to MTProto; ambiguous send timeout
  never falls back; successful idempotency results survive router restart.
- Candidate deployment preflight occurs before old-container stop, and failed
  readiness restores the exact prior image ID.

## Telegram live-evidence boundary

This execution environment intentionally supplied no Bot API token, API hash,
API ID, or MTProto session. It therefore cannot ethically produce a live
authorized Telegram transcript. The observable no-credential behavior is:
`telegram preflight` exits non-zero before polling with “Configure a Telegram
bot token, a user session, or both”; private-history calls return the typed
capability-unavailable error; and the service never starts `getUpdates`.

With bot-only credentials, arbitrary pre-join/private history and user-account
owner sends are unavailable by Telegram's capability model, while public
preview and accessible live bot updates continue. With user-only credentials,
the Bot API command surface and bot-chat subscription delivery are unavailable,
while authorized background history/library operations remain possible. The
combined mode validates both pinned identities, prefers Bot API, and uses
MTProto only for classified missing capabilities. Operators can reproduce the
live portion with their own authorized IDs using `telegram preflight` followed
by the command matrix in `docs/telegram.md`; logs redact all credential values.

## Known platform constraints

- One bot token supports one long poller, so redeploy has a short non-overlap
  handoff rather than simultaneous blue/green consumers.
- Bot privacy mode and membership determine live group visibility.
- MTProto cannot read a dialog the account cannot access, and this project does
  not auto-join communities.
- Public preview, DOM structure, CAPTCHA, popularity, exchange rates, and source
  terms can change; failure is isolated per source and evidence is timestamped.
