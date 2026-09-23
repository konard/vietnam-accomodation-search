# Telegram complete-parser revalidation — 2026-09-23

## Evidence status

The implementation and privacy-safe offline gates pass. The credentialed
40-source result is **pending**, not inferred: this checkout has no Telegram
bot/user credentials, `clink`, or Tesseract executable. No live source count,
message count, identity, content, contact, or excerpt is committed here.

| Gate                                                | Sanitized result                         |
| --------------------------------------------------- | ---------------------------------------- |
| User/UserEmpty excluded before retrieval            | pass (automated constructor tests)       |
| Safety-cap verdict                                  | pass (cap is always incomplete/non-pass) |
| Flood-wait retry and durable resume position        | pass (automated)                         |
| Album/caption/photo-only terminal accounting        | pass (automated synthetic corpus)        |
| Parser failure/empty extraction terminal accounting | pass (automated)                         |
| Production reconciliation and domain graph          | pass (automated)                         |
| Typed LiNo round-trip/query/edit/delete             | pass (automated text-store integration)  |
| Transactional `clink` mirror                        | pending credentialed local audit         |
| Two-month boundary reached for all selected sources | pending credentialed local audit         |
| No unresolved live media-only candidates            | pending credentialed local audit         |

## What changed

The manual runner now:

- selects at most 40 community sources and rejects `User`/`UserEmpty` before
  retrieval;
- requests one item past each message page so reaching the safety ceiling can
  never be mistaken for reaching the time boundary;
- persists an oldest-message checkpoint only after reconciled domain records,
  offers, traces, and the `clink` mirror are durable;
- resumes an incomplete source by Telegram message ID and honors bounded
  `FLOOD_WAIT` responses;
- reconstructs albums, consumes captions, and optionally sends media through
  Tesseract with English, Russian, and Vietnamese language models;
- assigns every material an accepted, excluded, reviewed, degraded, or error
  terminal state and writes a correlated privacy-redacted trace;
- sends accepted material through the production classifier, reconciler,
  parser, segment ledger, and typed domain graph;
- verifies deterministic typed LiNo and transactional `clink` round-trip,
  query, edit, and delete behavior; and
- reports discovery evidence, reviewed-corpus relevance precision/recall,
  field extraction, media handling, segments/traces, and storage independently.

The reviewed synthetic corpus is schema v2. It adds observed false-positive
categories in English and Vietnamese plus a photo-only Vietnamese OCR case;
raw source material is not retained.

## Authorized local command

Stop any competing Telegram poller first. Put credentials in mode-0600 local
environment files outside Git, install `clink` and Tesseract with the
`eng+rus+vie` models, and explicitly declare the audit transport's session as
`TELEGRAM_USER_SESSION_FORMAT=gramjs/string-session-v1`; raw or foreign session
formats are rejected without a network trial. Then run:

```sh
node experiments/audit-telegram-accommodations.mjs \
  --user-env /private/path/user.env \
  --bot-env /private/path/bot.env \
  --tesseract-command tesseract \
  --state-directory /private/path/telegram-audit-state \
  --output /private/path/telegram-audit-report.json
```

Repeat the command while any source reports `message-cap-exhausted`; the
checkpoint advances only after its page is stored. Publication is allowed only
when `acceptance.pass` is `true`. Reduce the private result to the gate table
and pass/fail counts above—never commit the report, state directory, source
aliases, messages, contacts, credentials, or stable identities.
