# Persistent collected-data cache

The local `data/` folder is git-ignored. It is deliberately persistent, not an
automatic test fixture: tests must never remove it as part of temporary cleanup.
Keep its directory private and do not put bot tokens, user sessions or env files
there.

The local prepared cache contains canonical `offers.lino`/indexed offer shards,
source records, a `cache-status.json` provenance manifest, checksummed retained
raw history, web review packs and already-downloaded native media. Original
collection timestamps remain original; offline reparsing is not a new live
observation. Missing media, incomplete source collection and unreviewed fields
remain explicit partial-coverage limitations. Raw source data and real offer
links must not be added to commits or public issues.

The reviewed local shortlist is `data/top-10-nha-trang-monthly-reviewed.md`, with
matching JSON and cached original-post checks. It is a manually reviewed partial
subset, not an automatically accepted production result. Canonical deduplication
collapsed two distinct studios; the failed readback is preserved for
[issue 238](https://github.com/konard/vietnam-accomodation-search/issues/238).

To inspect automatic Nha Trang monthly-total candidates without contacting any source:

```sh
node experiments/query-cached-offers.mjs --directory data --days 7 --limit 10 --min-monthly-vnd 500000
```

The private candidate JSON contains direct original listing/message links and
per-bedroom/room/bed values only when supported by the stored quote and counts.
It uses the production ranking engine with `refresh: false`, accepts original
VND monthly whole-offer quotes and excludes unavailable/review-required records.
It does not mix nightly rates, unit/person quotes or unverified FX conversions
into a total-monthly ranking. Live availability is not established by this query.
The explicit 500,000 VND screen excludes implausibly small literal quotes from
this partial shortlist; it is not a currency-scale repair or a production parser
fix. Original malformed/contradictory prices stay unaltered in the cache for
review. Use `--min-monthly-vnd 0` to inspect the unscreened engine result. A minimum
price screen does not fix fee-as-rent, expired listings, informational posts,
scope errors or mismatched quote links. Review original posts before using these
candidates; do not label this output a verified best-offer list.

For ordinary application use, select the persistent store per process:

```sh
DATA_DIRECTORY="$PWD/data" node bin/vietnam-accomodation-search.js search Nha Trang
```

Ordinary searches may refresh stale/incomplete source checkpoints; having raw
snapshots does not mean every production checkpoint is complete. Use the
cache-only query above when no API requests are wanted. Do not silently mark
incomplete history, OCR or pagination complete to suppress a refresh.
