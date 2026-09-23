# Multilingual browser revalidation — 2026-09-23

## Failed baseline retained

A manual local Chrome run exercised one Vietnamese, one English, and one
Russian public route after the production scheduler changes. The result was a
**failed mutable-site gate**, not a simulated pass. The runner did not solve or
bypass a challenge, and no HTML, screenshot, profile, contact, raw listing, or
reusable browser state is committed.

| Source language | Result           | Sanitized aggregate evidence                           |
| --------------- | ---------------- | ------------------------------------------------------ |
| Vietnamese      | challenge        | zero cards; HTTP 401/403 observed; no bypass attempted |
| English         | parse incomplete | 25 cards; 219/322 segments classified; 103 unconsumed  |
| Russian         | challenge        | zero cards; HTTP 401/403 observed; no bypass attempted |

That run began at `2026-09-23T11:30:58Z`. Separate-domain work ran
concurrently, each domain received a randomized 3–8 second initial delay, and
all three outcomes were terminal. The English route loaded successfully at the
transport level, but all 25 cards contained at least one unconsumed segment. It
therefore did not pass parser completeness.

## Passing source-cohort rerun

A later manual local run on the issue #37 candidate selected independent public
Nha Trang rental pages after discovering that the original domains either
challenged Chrome or did not expose a complete semantic card contract. It used
Browser Commander with local Chrome, production schema-v2 adapters, three
cross-domain workers, and the same 3–8 second pacing policy.

| Cohort     | Public UI source              | Cards | Accounted segments | Incomplete / unconsumed | Result  |
| ---------- | ----------------------------- | ----: | -----------------: | ----------------------: | ------- |
| Vietnamese | Alo Nhà Đất Nha Trang rentals |    20 |            140/140 |                   0 / 0 | success |
| English    | Nha Trang Renting             |    24 |            166/166 |                   0 / 0 | success |
| Russian    | Be Jib Nha Trang rentals      |    72 |            467/467 |                   0 / 0 | success |

The run began at `2026-09-23T15:41:52Z` and completed with three success
verdicts at `2026-09-23T15:42:39Z`. For every cohort the sanitized gate records
true checks for prices/periods, rooms/beds, location, contacts, media,
availability, redirects, rental intent, and stable identity. It records zero
missing checks. Sold/rented cards remain accounted audit evidence but are not
emitted as production offers.

A separate `batdongsan.com.vn` run beginning at `2026-09-23T15:46:38Z`
encountered a challenge and exited non-zero. It persisted a domain-only
cooldown record for restart recovery rather than counting that page as a pass.
The cooldown directory was mode `0700` and its files mode `0600`.

## Implemented production contract

The production `DomainScheduler` owns navigation, extraction, page
classification, and retries within one per-domain serialized operation. It:

- defaults to configurable 3–8 second jitter;
- persists retry-after and bounded exponential cooldown records in the
  application store, while the manual runner persists the same policy across
  audit-process restarts;
- stops a challenged domain without blocking unrelated domains;
- classifies challenges, access denial, rate limits, timeouts, redirects,
  wrong intent/location, empty pages, selector drift, incomplete cards, and
  unknown semantic segments;
- never invokes a CAPTCHA solver; and
- uses schema-versioned source-specific adapters and privacy-redacted
  correlated traces.

The known Chợ Tốt sale route remains disabled with an explicit reviewed reason.
Deterministic challenge/cooldown/serialization/adapter tests pass alongside the
public-site evidence above.

## Disposition

Every raw run directory was created mode `0700`, with event, cooldown, and trace
files mode `0600`, outside the repository. No raw page, listing, contact,
screenshot, or reusable browser state is committed. WEB-2 now has a passing
mutable-site cohort on this candidate; the post-release repetition remains part
of issue #36. Future release audits must preserve the earlier challenge and
incomplete outcomes above rather than rewriting them as successes.
