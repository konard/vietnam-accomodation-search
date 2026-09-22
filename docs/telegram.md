# Telegram operations and security

## Credential modes and capabilities

| Mode         | Commands/live updates                     | Public preview | Two-month private history                | Owner send                             |
| ------------ | ----------------------------------------- | -------------- | ---------------------------------------- | -------------------------------------- |
| Bot token    | Yes where the bot is present              | Yes            | Unavailable                              | Only reachable bot chats               |
| User session | MTProto ingestion; no command surface     | Yes            | Yes where the account already has access | Explicit operator action               |
| Both         | Bot first                                 | Yes            | MTProto fallback                         | Bot first; safe pre-send fallback only |
| None         | Unavailable with precise capability error | Yes            | Unavailable                              | Unavailable                            |

The capability router covers identity, send, live updates, history, entity
resolution, media, membership/visibility, and popularity. It falls back only
after a classified capability/permission rejection. An ambiguous timeout may
have delivered a message, so non-idempotent sends never fall back. Persisted
idempotency outcomes and bounded update/edit IDs prevent replay after restart.
Diagnostics expose only mode, transport, and available capability—not secrets.

Public Telegram preview remains the credential-free evidence path and is
driven through `browser-commander`. Bot API, MTProto, and preview records pass
through the same normalizer/reconciler and carry transport, source, topic,
album, and edit provenance. History uses a strict rolling two-month cutoff.
Bot-only mode reports private-history unavailability and continues other
sources. The service never auto-joins a private source.

Run continuous MTProto backfill and monitoring independently with:

```bash
node bin/vietnam-accomodation-search.js telegram ingest
```

`bot` starts the same ingestion service when user credentials are present, in
addition to the Bot API command surface. Both paths normalize topics, albums,
media metadata, edits, deletions, service events, and transport provenance.
Subscription delivery is intentionally Bot API only and includes only offers
whose collection timestamp is within the configured six-hour freshness window.

## Authentication lifecycle

```bash
node bin/vietnam-accomodation-search.js telegram auth login --phone +84... \
  --session-stdout
node bin/vietnam-accomodation-search.js telegram auth login --qr
node bin/vietnam-accomodation-search.js telegram auth status
node bin/vietnam-accomodation-search.js telegram auth validate
node bin/vietnam-accomodation-search.js telegram auth rotate
node bin/vietnam-accomodation-search.js telegram auth logout
node bin/vietnam-accomodation-search.js telegram preflight
```

Login code and 2FA are hidden prompts or injected secrets. A 2FA password is
rejected on argv. Session output requires an explicit stdout handler or atomic,
fsynced `0600` file and is never stored in LiNo or silently appended to `.env`.
Expected numeric bot/user IDs pin principals against swapped secrets. Help and
argument validation run before application or Telegram construction.

A user session is equivalent to account access. Exclude it from application
backups, restrict its mount to the service identity, revoke it from Telegram's
active-sessions UI after suspected disclosure, rotate API/token credentials,
replace the mounted secret, validate the expected identity, and redeploy.

## Authorization and privacy

Private mode is the default. Configure stable numeric
`TELEGRAM_ALLOWED_USER_IDS` and/or `TELEGRAM_ALLOWED_CHAT_IDS`; usernames are
not authorization boundaries. Source updates and user-account sends always
fail closed without an allowlisted numeric identity. Public mode permits
rate-limited search/subscription commands per numeric user/chat, while
privileged actions remain allowlisted.

For groups, BotFather privacy mode may hide ordinary messages. Disable it only
when ingestion requires those messages and grant only the minimum group/channel
permissions. A bot cannot retrieve arbitrary pre-join or private history.
MTProto reads only dialogs the configured account can already access. Respect
source Terms of Service, privacy expectations, and Telegram flood limits.
Owner contact is never automatic: `/check_availability` or its CLI equivalent
is an explicit action.

## Failure policy

Bot API, transport, MTProto/flood, invalid auth, entity, duplicate poller,
blocked recipient, capability, and malformed errors are classified centrally.
Only idempotent or known pre-send operations retry. Retry-after/flood waits are
bounded by attempt, elapsed-time, delay, jitter, and cancellation budgets.
Fatal auth exits with code 20; duplicate poller conflict exits with code 21;
incomplete cleanup exits with code 22.
Raw updates, tokens, API hashes, sessions, phone/code/password fields, and
nested causes are redacted from logs.

On shutdown, readiness drops first, subscription timers stop, `bot.stop()` and
polling settle, active middleware drains to a deadline, resources close with
aggregated diagnostics, and the health server closes. Per-update malformed
data is isolated by `bot.catch` and does not kill polling.
