# Issue 1 revalidation evidence

## Environment and reproducibility

- Branch: `issue-10-395da7baa3de`
- Runtime/image commit: `f4fd0f1b6625349a22c2caeccd4907b0be66aa2e`
- Merged base: `6d45e8f` (`origin/main` on 2026-09-22)
- UTC evidence date: 2026-09-22
- Runtime: Node 24.21.0, npm 12.0.2, Bun 1.4.2, Deno 2.9.6, Docker 29.8.0,
  Docker Compose 5.5.1, and `clink` 0.2.10
- Image: local `linux/amd64`, non-root `node`, immutable image ID
  `sha256:18b25f9ba7fa4d850b0f726384a0034bb29ae65462c19087cd8482a5529bbbb7`
- Compose rendering SHA-256:
  `9ee6d45618fe132906cba7c37bdeb295d00b3ed7a965c4faec6bf2b2ed1f1690`
- Secrets: none were available or printed in this development environment

Reproduce the sanitized gates:

```bash
npm ci
npm test
npm run test:coverage
npm run check
npm run lint:all
cargo install link-cli --version 0.2.10 --locked
node --test tests/associative-storage.test.js tests/docker-runtime.test.js
docker build -t vietnam-accommodation-search:issue-10 .
ENV_FILE=.env.example docker compose config
node experiments/test-browser-real-estate-audit.mjs
node experiments/test-telegram-accommodation-audit.mjs
```

Observed local gate results:

- Node: 680/680 tests; product lines 100.00%, branches 94.42%, functions
  97.29%.
- Bun: 680/680 tests across 72 files.
- Deno: 581 passed, 0 failed with `--allow-read`.
- Browser audit helper: 7/7; Telegram audit helper: 8/8.
- `npm audit`: zero vulnerabilities; formatting/checks passed; lint completed
  with only the repository's already-configured warnings.
- The production image passed CLI help, `clink --help`, Playwright Chromium
  launch/close, a real binary-store write/query/delete, and container health.

## Requirement-to-code-to-test traceability

| Requirement                                         | Primary code                                                     | Regression evidence                                         | Live/degraded evidence                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Authorized bot commands                             | `telegram-access.js`, `telegram-bot.js`                          | `telegram-operations`, `telegram-bot`                       | No token: preflight refuses startup; private mode refuses absent numeric allowlist                |
| Bot/user/both routing                               | `telegram-capabilities.js`                                       | matrix, fallback, ambiguous-send tests                      | No credentials: capability-unavailable diagnostics; user-only has no bot command surface          |
| 20+20+Nha Trang sources and ranking evidence        | `sources.js`, `source-discovery.js`                              | source and Nha Trang suites                                 | Preserved authorized audit selected 40 of 44 candidates; persisted popularity remains timestamped |
| UI-only collection/update                           | `browser-collector.js`                                           | browser DOM/collector suites                                | Browser Commander remains the only web boundary; inaccessible/CAPTCHA sources degrade per source  |
| Strict two-month Telegram collection and provenance | `browser-collector.js`, `telegram-history.js`, `telegram-bot.js` | browser pagination, MTProto cutoff, reconciliation suites   | Private history unavailable in bot-only mode by Telegram design; public preview continues         |
| Multilingual types and unknown fields               | `listing-parser.js`, `links-store.js`                            | core/parser/associative round trips                         | Unknown labels and raw source values remain inspectable in LiNo                                   |
| Ten photos and shared 10 GiB                        | `media-cache.js`, `links-store.js`                               | media eviction and budget tests                             | Eviction removes local blob pointers but retains remote URLs                                      |
| VND, period, cheapest 1..50                         | `pricing.js`, `commands.js`, `search-service.js`                 | pricing/search command suites                               | Exchange data is timestamped at collection; unavailable rates skip incomparable offers            |
| Official price events                               | `offers.js`, `browser-collector.js`                              | offer reconciliation tests                                  | Only `official-web` observations create official change events                                    |
| Explicit availability, authorization, no duplicates | `telegram-user.js`, router/access policy                         | availability, access, ambiguous-send tests                  | No user session: precise credential error; no automatic contact occurs                            |
| Presets/ranges/unseen subscriptions/restart         | `presets.js`, bot/application wiring                             | parser, restart, grouped/partial delivery tests             | User-only mode reports Bot API delivery unavailable; bot/combined modes use bot delivery          |
| Canonical LiNo + `clink` recovery                   | `links-store.js`, `link-cli-mirror.js`                           | real import/export, kill point, stale/concurrent lock tests | Pointer deletion rebuilds from canonical hash; failed binary stage never publishes text           |
| Docker redeploy/rollback/shutdown                   | Docker/Compose/deploy/runtime                                    | structural, runtime, CI image-health tests                  | One-token long polling requires a measured controlled handoff; pollers never overlap              |
| Security/ToS                                        | access/auth/errors/browser URL checks                            | redaction, authorization, SSRF tests                        | No auto-join, bypass, owner contact, or raw-update logging                                        |
| Node/Bun/Deno/Docker amd64/arm64 gates              | release workflow                                                 | local full tests plus CI matrix                             | Local amd64 image passed; native publication remains conditional on absent Docker Hub settings    |

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

## Preserved authorized Telegram evidence

The credentialed privacy-safe audit already committed on 2026-09-22 remains the
live baseline: both principals validated, the exact `Нячанг жильё` folder was
found, every returned private `User` dialog was excluded, 44 public candidates
were ranked, 40 communities were selected, and 62,655 bounded messages were
scanned without a source read error. Its aggregate parser gaps are preserved in
[`telegram-live-audit-2026-09-22`](../telegram-live-audit-2026-09-22/README.md).
That audit predates PR #11's production wiring and is not presented as a fresh
post-change run.

## Current Telegram live-evidence boundary

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

## Current public browser probe

`BROWSER_NO_SANDBOX=1 node experiments/issue-10-live-browser-smoke.mjs`
completed successfully with no harness failures on 2026-09-22. The selected
public preview (`telegram:viet_life_niachang`) yielded zero offers and therefore
zero priced offers. That is evidence of isolated/degraded source behavior, not
proof of live listing recall. The older multilingual browser baseline retains
its challenge and unconsumed-segment failures for comparison.

## Publication boundary

`gh variable list` and `gh secret list` returned no repository Docker Hub
settings. Accordingly, local native image behavior and the workflow's
amd64/arm64 publication structure are verified, but this run cannot claim that
application `latest` or immutable version manifests exist. `deployment.md`
documents the three required settings and exact manifest inspection commands.

## Known platform constraints

- One bot token supports one long poller, so redeploy has a short non-overlap
  handoff rather than simultaneous blue/green consumers.
- Bot privacy mode and membership determine live group visibility.
- MTProto cannot read a dialog the account cannot access, and this project does
  not auto-join communities.
- Public preview, DOM structure, CAPTCHA, popularity, exchange rates, and source
  terms can change; failure is isolated per source and evidence is timestamped.
