# Telegram accommodation live-audit baseline — 2026-09-22

This is a privacy-preserving **pre-PR #11 historical baseline** for Telegram
ingestion and parsing. It records aggregates and synthetic/anonymized
conformance cases at the audited commit—not Telegram message bodies, private
identities, tokens, API hashes, or session strings. Its successful identity and
source observations and its parser failures are both preserved verbatim; they
are not relabeled as post-change live evidence.

## Scope and method

- Validated the configured Bot API identity with `getMe` without starting a
  competing update poller.
- Connected an existing authorized user session without performing a new login
  or writing session material.
- Located the exact custom folder `Нячанг жильё`.
- Rejected every Telegram `User` entity before source selection. The operator
  reported two visible private conversations; the API returned three unique
  private-dialog entities, all of which were ignored. This conservative rule
  also covers stale, pinned, deleted, and bot dialogs.
- Searched with twelve English, Russian, and Vietnamese Nha Trang housing
  queries, ranked the public results, combined them with the safe folder
  communities, and selected at most 40 sources.
- Read only the rolling two-month window, with a hard ceiling of 3,000 messages
  per source.
- Parsed candidate offer text with the production parser and serialized every
  returned offer with the production Links Notation serializer.
- Kept the detailed report in a mode-`0600` temporary file. It is deliberately
  not committed.

The reproducible driver is
[`experiments/audit-telegram-accommodations.mjs`](../../../experiments/audit-telegram-accommodations.mjs),
its privacy and classification helpers are in
[`experiments/telegram-accommodation-audit-lib.mjs`](../../../experiments/telegram-accommodation-audit-lib.mjs),
and its offline regression coverage is in
[`experiments/test-telegram-accommodation-audit.mjs`](../../../experiments/test-telegram-accommodation-audit.mjs).
The live runner is manual/local-only, refuses common CI/CD environments, and is
not selected by the repository's unit/integration test scripts or workflows.

## Results

| Measurement                         | Result |
| ----------------------------------- | -----: |
| Bot identity active                 |    yes |
| User session active                 |    yes |
| Matching folder found               |    yes |
| Folder community sources            |      5 |
| Private-dialog entities ignored     |      3 |
| Public discovery candidates         |     44 |
| Selected community sources          |     40 |
| Source read errors                  |      0 |
| Messages scanned                    | 62,655 |
| Sources reaching the 3,000 cap      |     14 |
| Heuristic text-offer candidates     |  9,093 |
| Candidates serialized to text LiNo  |  9,093 |
| Explicit accommodation requests cut |      8 |
| Media-only message parts/candidates | 50,115 |

The 9,093 count is **not** a ground-truth offer count. Manual inspection of the
redacted exceptions found false positives such as a SIM-card advertisement that
mentioned delivery to a hotel, a currency-exchange advertisement located in an
apartment complex, a property sale, and a Da Nang listing in a cross-promoted
Nha Trang channel. A reviewed relevance corpus is therefore required before a
100% claim is meaningful.

Fourteen sources reached the per-source ceiling. The experiment proves bounded
operation, not exhaustive history for those sources; production backfill must
checkpoint and resume until it reaches the strict two-month cutoff.

## Parser gaps

Among the 9,093 heuristic text candidates, the independent signal checks found:

| Gap or unparsed signal         | Count |
| ------------------------------ | ----: |
| No normalized location         | 8,657 |
| No normalized price            | 3,096 |
| Deposit wording not extracted  | 3,721 |
| Availability wording missed    | 1,705 |
| Explicit location label missed | 1,616 |
| No normalized contact          | 1,570 |
| Utility wording not extracted  | 1,172 |
| Pet policy not extracted       |   956 |
| Floor wording not extracted    |   343 |
| Generic accommodation kind     |   254 |
| Phone wording not extracted    |   249 |
| Bedroom wording not extracted  |   199 |
| Minimum stay wording missed    |   123 |
| Bathroom wording not extracted |    84 |

The checks intentionally over-report rather than silently declare success. For
example, a location may be implied by the source or channel instead of the post,
and media-only messages are often sibling items in a Telegram album. Production
logic must coalesce albums, preserve source context, and distinguish missing,
unknown, explicitly absent, and inherited values.

The anonymized, synthetic conformance cases are stored in
[`experiments/fixtures/telegram-accommodation-parser-cases.json`](../../../experiments/fixtures/telegram-accommodation-parser-cases.json).
They cover Russian, English, and Vietnamese offers; decimal-million and symbol
prices; absolute versus month-count deposits; itemized utilities; partial dates;
`WC`; Telegram albums; requests; unrelated services; sales; and wrong-city
listings.

## Associative-storage result at the audited commit

All 9,093 parser outputs passed the then-existing text serializer. That did not
meet the associative-stack requirement: that serializer placed the complete
semantic record in one opaque base64url JSON `data` value. That result did not
prove that offer fields, messages, albums, media, observations, contacts,
unknown labeled fields, or transport provenance were independently addressable
typed links, and it did not exercise a transactional `link-cli` binary mirror.

## Privacy and repeatability rules

1. Never include one-to-one `User` dialogs in discovery, scanning, examples, or
   aggregate source counts.
2. Never commit raw Telegram messages or stable private identifiers.
3. Redact contacts, addresses, IDs, and URLs before an excerpt can leave the
   temporary report; prefer synthetic minimal reproductions in fixtures.
4. Never print tokens, API hashes, phone numbers, login codes, 2FA input, or
   session strings.
5. Treat the user session as account-equivalent access. Use it only for a
   capability unavailable to the bot or credential-free public preview.
6. A future release passes only after the reviewed corpus and a fresh live audit
   reach the acceptance criteria tracked in the linked follow-up issues.

## Post-baseline disposition

PR #11 adds community-only discovery filters, bounded resumable history,
complete event adapters, classified bot/user routing, explicit session
destinations, typed associative v2 records, transactional `clink` mirroring,
and correlated privacy-safe decision traces. Issues #12–#18 remain useful
historical decomposition/context, but none of Issues #3–#9 is deferred to them.

This preserved corpus still found false positives and missing parser signals.
Without the original credentials, PR #11 cannot ethically rerun those private
sources or assert 100% current live recall. The [Issue #1
revalidation](../issue-1-revalidation/README.md) therefore distinguishes the
implemented/tested contract, this authorized baseline, and the current
no-credential behavior instead of fabricating a pass.
