# Multilingual Vietnam real-estate browser audit — 2026-09-22

This privacy-safe document is a **pre-PR #11 historical baseline**: it tests
public real-estate pages through a local Chrome session and an explicitly
invoked `browser-commander` experiment at the audited commit. Its failures are
preserved and are not claims about the post-implementation runtime. No account
data, cookies, raw listing text, contact details, or reusable browser state is
committed.

## Browser observations

The local browser discovery pass used Vietnamese, English, and Russian queries.
It confirmed relevant public result pages for Nha Trang Renting, Dot Property,
Vietdom, Xmetr, Be Jib, Vietnam Real Estate, and ICEKEM in addition to the two
real-estate routes already configured in production.

Important defects were reproduced:

- Batdongsan presented an automated-traffic challenge. The audit did not click,
  solve, or bypass it.
- The configured Chợ Tốt URL redirects to Nha Tốt sale inventory (`mua-ban`),
  not a rental search. Rental intent must be asserted after every redirect.
- Nha Trang Renting, Vietdom, and Dot Property rental pages loaded in the local
  browser in English or Russian, proving useful candidates beyond generic hotel
  booking sites. This is discovery evidence, not a popularity ranking.

The candidate manifest is
[`experiments/fixtures/vietnam-real-estate-sites.json`](../../../experiments/fixtures/vietnam-real-estate-sites.json).
The audit correctly declined to call a candidate “top” without reproducible
popularity evidence. PR #11 persists metric, value, evidence URL, and timestamp
for current rankings rather than turning this historical discovery set into a
timeless popularity claim.

## Manual `browser-commander` E2E result

The committed runner is
[`experiments/audit-browser-real-estate.mjs`](../../../experiments/audit-browser-real-estate.mjs),
with privacy/completeness/scheduling helpers in
[`experiments/browser-real-estate-audit-lib.mjs`](../../../experiments/browser-real-estate-audit-lib.mjs)
and offline checks in
[`experiments/test-browser-real-estate-audit.mjs`](../../../experiments/test-browser-real-estate-audit.mjs).

A corrected representative run used one Vietnamese route, one English route,
and one Russian route concurrently across separate domains. Actions within a
domain remain serialized and start after a 3–5 second jittered delay.

| Source/language             | Result           | Sanitized evidence                                     |
| --------------------------- | ---------------- | ------------------------------------------------------ |
| Batdongsan / Vietnamese     | challenge        | zero cards; HTTP 401/403 observed; no bypass attempted |
| Nha Trang Renting / English | parse incomplete | 25 cards; 219/322 segments classified; 103 unconsumed  |
| Xmetr / Russian             | challenge        | zero cards; HTTP 401/403 observed; no bypass attempted |

All 25 extracted English cards contained at least one unconsumed segment, so
this run fails the 100%-parsed requirement. A segment is represented in the
structured event log by its index, length, hash, parser categories, and consumed
state—not its raw text. Unconsumed segments are emitted at error severity.

## Trace and pacing contract demonstrated by the experiment

- Each site gets an isolated ephemeral Chrome profile.
- Sites on different domains may run concurrently; the same domain cannot.
- The default delay is jittered and grows exponentially after a challenge,
  access denial, or rate limit.
- CAPTCHA/challenge outcomes stop extraction. The runner never attempts an
  automatic solve; a future retry must use a longer interval or explicit human
  action under the applicable policy.
- Every stage writes schema-versioned JSONL with run, site, sequence, timestamp,
  duration, network-status aggregate, outcome, and parser completeness.
- Browser Commander also writes a replay trace and live Links Notation export.
  Secret query parameters, contacts, email-like values, and handles are redacted
  before trace persistence.
- The containing temporary directory is mode `0700`; the event stream is mode
  `0600`. Live artifacts stay outside the repository.

## Deliberate CI boundary

Real-data browser and Telegram E2E probes are manual/local-only. They are not
listed in `package.json`, are not imported by `tests/`, and are not invoked by a
GitHub Actions workflow. The browser runner refuses to start when common CI/CD
environment markers are present. The code remains committed under
`experiments/` so a release operator can reproduce the audit locally.

## Post-baseline disposition

PR #11 implements ranked evidence records, rental-intent validation after
redirect, polite per-domain scheduling, challenge classification, correlated
redacted decision traces, and manual-only reusable E2E harnesses. The current
public smoke completed without a harness error but the selected public Telegram
preview yielded zero offers; that degraded observation is recorded in the
[Issue #1 revalidation](../issue-1-revalidation/README.md).

Issues #16–#18 remain useful historical decomposition/context, but none of
Issues #3–#9 is deferred to them. A new credentialed or mutable-site run must
still report what it actually observes; these 25 cards and 103 unconsumed
segments remain a failed baseline, not a retroactive success.
