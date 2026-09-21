# Issue 1 development notes

This document distills the durable engineering information from the issue and
pull-request work logs. The source session log is available in the maintainer's
[authenticated gist](https://gist.github.com/konard/2ff1125ccac6bc33dc9e80745436519f),
but the multi-megabyte raw transcript is intentionally not committed.

## Product constraints

- Search configured web and Telegram sources through real browser pages, using
  Browser Commander with Playwright rather than private accommodation APIs.
- Keep 20 ranked general web sources, 20 ranked nationwide Telegram sources,
  and a separate 20-source Nha Trang Telegram cohort.
- Read public Telegram preview history back to a rolling two-month cutoff.
- Preserve no more than ten photos per offer and enforce a shared 10 GiB local
  budget without deleting original media URLs from records.
- Normalize comparable prices to VND while retaining the quoted amount,
  currency, and period.
- Persist records as Links Notation and preserve complete raw inputs so parsing
  can improve without recollecting every source.
- Never contact an owner during search. An availability inquiry requires an
  explicit command and a separately configured mtcute user session.

## Architecture decisions

- `BrowserCollector` isolates failures per source and closes both Browser
  Commander and the browser in a `finally` block.
- `parseListingText` is the shared multilingual parser for website and Telegram
  text. Label extraction uses bounded string scanning instead of a broad regular
  expression over attacker-controlled whitespace.
- `normalizeOffer` creates the common data model; `deduplicateOffers` applies
  identity reconciliation and transitive union/merge; `LinksStore.saveOffers`
  performs reconciliation on every write.
- Canonical URLs discard fragments and known tracking parameters while keeping
  stable property query parameters.
- Merged records retain `sourceIds`, `sourceTypes`, `variants`, `identityKeys`,
  identifiers, raw payloads, attributes, contacts, photos, query aliases, and
  price observations.
- Official property URLs are modeled independently from marketplace URLs.
  Direct checks use `official-web` provenance, which is required before an
  observation can produce an official price-change event.
- Search source-completeness checks recognize every source alias on a merged
  offer, preventing unnecessary refreshes after deduplication.

## Parsing coverage

The shared parser recognizes English, Vietnamese, and Russian variants for:

- property IDs, property kind, address/district, availability date;
- studio, bedrooms, bathrooms, beds, guests, area, and floor;
- minimum stay, deposit, agency fee, furnishing, pets, and included utilities;
- rating, review count, check-in/check-out, latitude, and longitude;
- air conditioning, balcony, elevator, gym, kitchen, parking, pool, sea view,
  washing machine, and Wi-Fi;
- bounded Telegram usernames, `t.me` links, phone numbers, email addresses, and
  explicitly labeled official-property web URLs;
- every unfamiliar `label: value` field, retained in `labeledFields`.

## Security and reliability findings

- CodeQL identified polynomial regular-expression behavior in early price and
  Telegram parsing. Numeric tokens, usernames, email components, and separator
  spans are now bounded.
- A 10,000-character adversarial whitespace fixture exercises the parser within
  a 150 ms test budget on the reference environment.
- Telegram platform limits are documented rather than bypassed: bots cannot
  retrieve arbitrary private history, and user-session credentials are used
  only for explicit owner inquiries.
- Consent pages, CAPTCHAs, and access failures are logged and skipped. The
  project does not implement anti-bot circumvention.
- Official links originate in untrusted listing text. Before navigation, the
  collector rejects credentials, localhost names, private/link-local IPv4,
  local hostnames, and loopback/link-local/unique-local IPv6 forms.
- Cache writes use a temporary file plus atomic rename; unknown filesystem
  errors propagate instead of being mistaken for an empty cache.

## Validation protocol

The implementation is checked with Node.js, Bun, and Deno. Node's built-in
coverage runner enforces 100% line coverage for every `src/**/*.js` module via
`npm run test:coverage`; branch and function percentages are also printed for
review. The coverage suite includes browser-DOM extraction, optional runtime
boundaries, malformed input, provider failures, persistence limits, official
site checks, deduplication aliases, and price history.

The release workflow runs the 100% line-coverage gate on Ubuntu in addition to
the existing nine-platform/runtime test matrix. Local handoff should also run
`npm run check`, inspect the complete pull-request diff, and verify that the
branch is up to date with the default branch.
