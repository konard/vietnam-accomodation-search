# Telegram bot conversation E2E — 2026-09-23

## Scope

This sanitized local observation used an already-authorized real Telegram user
session as the external client and the production Bot API command runtime as
the system under test. State was isolated in an automatically created temporary
directory and stored through canonical Links Notation plus the Rust
`link-cli` 0.2.10 binary mirror. The offer was synthetic and the Telegram
conversation was real.

The reusable runner is
[`experiments/telegram-bot-conversation-e2e.mjs`](../../../experiments/telegram-bot-conversation-e2e.mjs),
and its network-free safety regression is
[`experiments/test-telegram-bot-conversation-e2e.mjs`](../../../experiments/test-telegram-bot-conversation-e2e.mjs).

## Passed observation

- The existing user session was authorized, and the bot token resolved to the
  same numeric bot ID encoded in the token.
- The production bot became ready and accepted a private numeric allowlist
  derived from the authenticated test user.
- A named preset was saved and selected; `/subscribe` delivered the seeded
  fresh unseen offer.
- The bot stopped and restarted on the same LiNo/`clink` directory.
- The offer was not delivered again after restart.
- The active preset and subscription survived restart.
- A one-time room filter override found the offer without mutating the preset.
- Unsubscribe, preset reset/deletion, test-message deletion, bot shutdown, and
  temporary-directory removal completed.

The final sanitized result was: real conversation `true`, bot restart `true`,
preset persistence `true`, subscription persistence `true`, duplicate after
restart `false`, and test messages deleted `true`. No token, API hash, session,
numeric identity, raw message, or raw bot log was committed.

## Degraded gates retained as open

The local credential files did not contain independent expected numeric bot or
user identity pins, although both authenticated principals were checked for
internal consistency and the runtime allowlist used the authenticated user ID.
The available user session is a legacy Teleproto/GramJS session, so it was used
only as the external driver. It was not reinterpreted as a production mtcute
session, and combined bot-plus-user runtime mode was not claimed as tested.

[Issue #24](https://github.com/konard/vietnam-accomodation-search/issues/24)
retains the required native mtcute cutover, independent identity pins, healthy
combined-mode run, and degraded combined-mode evidence. The complete immutable
release qualification remains in
[Issue #26](https://github.com/konard/vietnam-accomodation-search/issues/26).

## Harness corrections found during the run

The first local attempt found that the host's `clink` name resolved to an
unrelated .NET tool. The successful run used the same Rust `link-cli` 0.2.10
version pinned by the Dockerfile. A second attempt showed that mirroring the
entire static source catalog was unnecessarily expensive; the deterministic
fixture now mirrors one synthetic source while attaching all registry source
IDs to the cached offer. Driver operations have explicit deadlines and emit
only non-sensitive stage names, so a stalled MTProto call cannot silently hide
the stage under test.
