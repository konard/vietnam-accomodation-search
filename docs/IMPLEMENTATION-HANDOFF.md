# Deployment, Telegram, subscriptions, and associative-stack handoff

This audit records the implementation boundary after re-checking the original
[Issue 1](https://github.com/konard/vietnam-accomodation-search/issues/1), the
three reference Telegram repositories, and the associative-stack guidance.
The linked issue bodies are the authoritative acceptance contracts; progress
should be recorded by editing those bodies and checklists rather than posting
status-only comments.

## Workstreams

| Issue                                                                | Ownership boundary                                                               | Depends on |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| [#3](https://github.com/konard/vietnam-accomodation-search/issues/3) | Docker image, local deploy/redeploy, readiness, rollback, registry configuration | #6, #9     |
| [#4](https://github.com/konard/vietnam-accomodation-search/issues/4) | Canonical Links Notation plus transactional `link-cli` binary storage            | —          |
| [#5](https://github.com/konard/vietnam-accomodation-search/issues/5) | Search presets, range filters, and unseen/fresh subscriptions                    | #4, #6, #7 |
| [#6](https://github.com/konard/vietnam-accomodation-search/issues/6) | Telegram errors, flood waits, retries, health, and graceful shutdown             | —          |
| [#7](https://github.com/konard/vietnam-accomodation-search/issues/7) | Bot-first/user-fallback capability routing and MTProto ingestion                 | #6, #9     |
| [#8](https://github.com/konard/vietnam-accomodation-search/issues/8) | Final live revalidation of every Issue 1 requirement                             | #3-#7, #9  |
| [#9](https://github.com/konard/vietnam-accomodation-search/issues/9) | Secure Telegram login/session lifecycle and authorization                        | —          |

## Reference audit

The issue contracts link to immutable commits and exact lines. The main
patterns selected for this project are:

- authenticate interactively without exposing 2FA input; validate help before
  connecting; always clean up clients;
- use stable numeric user IDs for privileged authorization;
- classify Telegram capability limits, rate limits, and transport ambiguity
  before retrying or falling back;
- stop polling and drain active work before process exit;
- keep `browser-commander` for real web-UI collection;
- retain inspectable Links Notation while adding `link-cli` transactions and
  crash recovery, using `use-m`, `command-stream`, and `lino-arguments` for
  applicable orchestration commands.

## Preserved implementation scaffold

The current commit intentionally preserves a tested starting point for #5 and
#4 so the implementing agent can continue rather than repeat parsing and state
work:

- `src/commands.js` parses accommodation types; independent room, total-price,
  per-room-price, and per-bed-price bounds; and one-time partial overrides.
- `src/search-service.js` applies the new structured filters.
- `src/search-presets.js` provides persisted named presets, one active preset
  per Telegram user, one subscription selection, bounded shown-offer IDs, and
  a non-overlapping subscription runner.
- `src/links-store.js` adds serialized search state, in-process write ordering,
  file fsync, atomic rename, and parent-directory fsync.
- `tests/search-presets.test.js` pins the scaffold's parser, merge, persistence,
  and unseen-delivery behavior.

This scaffold is deliberately not wired into Telegram handlers or the runtime
scheduler yet. Issue #5 owns that integration plus stable reconciled delivery
identity, partial-batch recovery, grouped crawling, Telegram message limits,
and the precise rooms-versus-bedrooms/studio semantics. Issue #4 owns replacing
opaque-only payload storage with the canonical binary/text associative schema.

## Completion policy

Issue #8 is the only final integration gate. It must not close from unit tests
alone: every original requirement needs a direct code link, an automated
regression test, and sanitized live evidence or a precise documented Telegram
platform limitation for a credential mode.
