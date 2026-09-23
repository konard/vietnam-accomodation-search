# Multilingual browser revalidation — 2026-09-23

## Evidence status

A fresh manual local Chrome run exercised one Vietnamese, one English, and one
Russian public route after the production scheduler changes. The result is a
**failed mutable-site gate**, not a simulated pass. The runner did not solve or
bypass a challenge, and no HTML, screenshot, profile, contact, raw listing, or
reusable browser state is committed.

| Source language | Result           | Sanitized aggregate evidence                           |
| --------------- | ---------------- | ------------------------------------------------------ |
| Vietnamese      | challenge        | zero cards; HTTP 401/403 observed; no bypass attempted |
| English         | parse incomplete | 25 cards; 219/322 segments classified; 103 unconsumed  |
| Russian         | challenge        | zero cards; HTTP 401/403 observed; no bypass attempted |

The run began at `2026-09-23T11:30:58Z`. Separate-domain work ran concurrently,
each domain received a randomized 3–8 second initial delay, and all three
outcomes were terminal. The English route loaded successfully at the transport
level, but all 25 cards contained at least one unconsumed segment. It therefore
did not pass parser completeness.

## Implemented production contract

The production `DomainScheduler` now owns navigation, extraction, page
classification, and retries within one per-domain serialized operation. It:

- defaults to configurable 3–8 second jitter;
- persists retry-after and bounded exponential cooldown records in the
  application store;
- stops a challenged domain without blocking unrelated domains;
- classifies challenges, access denial, rate limits, timeouts, redirects,
  wrong intent/location, empty pages, and selector drift;
- never invokes a CAPTCHA solver; and
- uses schema-versioned adapters and privacy-redacted correlated traces.

The known Chợ Tốt sale route remains disabled with an explicit reviewed reason.
Deterministic challenge/cooldown/serialization/adapter tests pass, but they do
not replace public-site evidence.

## Disposition

The raw run directory was created mode `0700`, with event and trace files mode
`0600`, outside the repository. The current mutable-site gate stays pending for
an immutable released build: enabled VI, EN, and RU cohorts do not yet each
have a fully parsed Nha Trang rental source. Future release audits must preserve
these outcomes as challenge/incomplete—not reinterpret them as success merely
because the scheduler implementation passes offline tests.
