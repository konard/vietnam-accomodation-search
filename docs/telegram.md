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
driven through `browser-commander`. Creating the bot registers its Bot API
discovery provider ahead of the user-only MTProto provider. Bot API, MTProto,
and preview records pass through the same normalizer/reconciler and carry
transport, source, topic, album, and edit provenance. History uses a strict
rolling two-month cutoff. Incomplete backfills persist the oldest message
ID/date, reload stored material, and scan both newer arrivals and the remaining
older side of the checkpoint on restart. Bot-only mode reports private-history
unavailability and continues other sources. The service never auto-joins a
private source.

Run continuous MTProto backfill and monitoring independently with:

```bash
node bin/vietnam-accomodation-search.js telegram ingest
```

`bot` starts the same ingestion service when user credentials are present, in
addition to the Bot API command surface. Both paths normalize topics, albums,
media metadata, edits, deletions, service events, and transport provenance.
Subscription delivery is intentionally Bot API only and includes only offers
whose collection timestamp is within the configured six-hour freshness window.
If the user credential set is incomplete, uses a declared foreign format, or
fails MTProto startup/authentication, combined `bot` mode records a redacted
warning and continues bot-only. `telegram ingest` has no such fallback and
fails with the actionable user-credential error.

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

mtcute is the production MTProto library. Persisted sessions use the explicit
versioned `mtcute/session-string-v1` envelope; set
`TELEGRAM_USER_SESSION_FORMAT=mtcute/session-string-v1` when injecting a raw
native session. Format validation is local and happens before a client or
network connection is created. A GramJS/Teleproto `StringSession` must be
declared as `gramjs/string-session-v1`; it is never tried against mtcute. The
status command reports `relogin-required`, and the supported migration is:

`telegram preflight` returns independent `bot` and `user` capability states
plus the effective mode. Combined mode reports an unavailable, foreign,
expired, or revoked user session as redacted bot-only degradation. User-only
mode and every expected-ID mismatch fail closed. Raw session strings without
`TELEGRAM_USER_SESSION_FORMAT` are rejected; versioned mtcute envelopes carry
their own declaration.

1. Keep the old GramJS session active and backed up outside application data.
2. Log in explicitly with mtcute to a new session destination.
3. Validate the expected numeric account ID with `telegram auth validate`.
4. Atomically activate the new `0600` session file and restart/preflight.
5. Revoke the old GramJS session in Telegram's active-sessions UI only after
   the new identity and required capabilities pass.

If validation fails, the active destination is unchanged. Roll back by
restoring the preserved old secret to its original GramJS consumer; do not
reinterpret it as an mtcute session. Direct auth-key conversion is deliberately
not automatic because it expands the secret-handling surface and can carry an
incorrect data-center/account binding. An operator who elects to convert must
use mtcute's separately reviewed `@mtcute/convert` path, validate into a new
destination, and follow the same cutover/revocation sequence.

Login code and 2FA are hidden prompts or injected secrets. Both are rejected on
argv. Session output requires an explicit stdout handler or atomic,
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

Only messages from public or explicitly configured member-visible communities
enter local ingestion storage. Raw public text is retained only in the bounded
`telegram-events` working set (10,000 events by default) and entries older than
the rolling two-month ingestion window are pruned at startup. It is excluded
from traces, CI artifacts, issue evidence, and release-audit output. Extracted
public listing contacts are local application data, never authorization
identities: typed contact links carry `local-listing-lifetime`, are removed with
the source message on edit/deletion, and must be deleted with the application's
data directory when the operator ends the listing-retention purpose. Encrypt
the data volume at rest when local policy requires it; the application does not
export contacts or raw text to a separate analytics store.

## Failure policy

Bot API, transport, MTProto/flood, invalid auth, entity, duplicate poller,
blocked recipient, capability, and malformed errors are classified centrally.
Only idempotent or known pre-send operations retry. Retry-after/flood waits are
bounded by attempt, elapsed-time, delay, jitter, and cancellation budgets.
Fatal auth exits with code 20; duplicate poller conflict exits with code 21;
incomplete cleanup exits with code 22. A user-auth failure is fatal in
user-only mode but degrades only that capability when the independently
validated Bot API runtime is available.
Raw updates, tokens, API hashes, sessions, phone/code/password fields, and
nested causes are redacted from logs.

On shutdown, readiness drops first, subscription timers stop, `bot.stop()` and
polling settle, active middleware drains to a deadline, resources close with
aggregated diagnostics, and the health server closes. Per-update malformed
data is isolated by `bot.catch` and does not kill polling.

## Manual real-user conversation E2E

The local-only conversation harness uses an already-authorized Teleproto/
GramJS user session as the external test driver. It starts the production bot,
sends real private commands through Telegram, verifies preset and subscription
state, restarts the bot against the same isolated data directory, proves that a
fresh offer is not delivered twice, exercises a one-time search override, and
then removes its test messages and preset. A synthetic offer is seeded in the
real LiNo/`clink` cache so this test is deterministic; source discovery and
real-message parsing remain covered by the separate live audit harnesses.

Stop every other poller for the same bot token, use Node.js 22 or newer, and
run explicitly from a local terminal (never CI):

```bash
cargo install --root .deploy/e2e-tools link-cli --version 0.2.10 --locked
PATH="$PWD/.deploy/e2e-tools/bin:$PATH" \
TELEGRAM_CONVERSATION_E2E=1 node \
  experiments/telegram-bot-conversation-e2e.mjs \
  --bot-env .env \
  --user-env ../follow/.env
```

The `PATH` prefix is intentional: another unrelated executable also uses the
name `clink`. `clink --version` for this test must report `clink 0.2.10`, the
same Rust `link-cli` version pinned in the production image.

The bot environment needs `TELEGRAM_BOT_TOKEN` and should pin
`TELEGRAM_EXPECTED_BOT_ID`. The driver environment needs
`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and a legacy
`TELEGRAM_USER_SESSION`; set `TELEGRAM_E2E_EXPECTED_USER_ID` to pin the test
account. The harness derives the private numeric allowlist from the authorized
driver account, never prints message text or identities, writes only redacted
`0600` process logs, and deletes its temporary data directory by default.
Explicit `--data-directory` paths must be empty real directories whose final
name contains `e2e`; they are preserved for inspection. `--keep-data` preserves
an automatically created temporary directory only when requested.

The runner records a pre-test conversation boundary and deletes every command
and bot reply created after it, including replies that did not match an
expected assertion. A bot error/usage reply fails the run even if a later reply
would otherwise satisfy the command assertion. On failure, the complete test
conversation is token/session-redacted into a mode-`0600` ignored file under
`experiments/logs/` before Telegram cleanup and temporary-state removal. At
startup, narrowly recognized leftovers from an interrupted earlier E2E are
logged the same way and deleted; ordinary bot conversations are never selected
by this cleanup rule. Failure transcripts are local QA evidence and must not be
committed.

Use `--cleanup-leftovers-only` with the same bot/user environment arguments to
verify or remove narrowly recognized remnants without starting the bot or
running the scenario.

To verify the combined production runtime as well, add `--mode both` and
`--runtime-user-env PATH`. That second file must contain a native
`mtcute/session-string-v1` session and `TELEGRAM_EXPECTED_USER_ID`; the harness
does not reinterpret the legacy driver session. Use `--help` for the complete
option list. The runner refuses common CI environments and an explicit
`TELEGRAM_BOT_POLLER_ACTIVE=1` safety marker, and it is deliberately excluded
from normal test scripts.
