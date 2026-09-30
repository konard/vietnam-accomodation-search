# Associative storage and recovery

## Canonical schema

Human-inspectable `.lino` text is authoritative. Each collection has a schema
marker, record link, and one typed link per JSON Pointer-like field path.
Objects, arrays, strings, finite numbers, booleans, and null have explicit
types. Raw input and future unknown fields use the same recursively addressable
representation; they are not hidden in a single base64 JSON value. Every link
has exactly two values so `clink` can import it.

Schema v3 (`schema:associative-records-v3`) writes every name so `clink`
imports it unchanged (#55). `clink` 0.2.10 and 0.2.11 trim every line of an
imported document and every name, including trailing colons
(`normalize_links_notation` and `normalize_identifier` in
`src/lino_database_input.rs`). A value with a trailing newline or space, a
blank or indented line, CRLF, a double space, or the empty string (whose name
`value:string:` ends in a colon) was therefore imported as a different name.
The export then failed verification with one missing link and two unexpected
links. `links-notation` also writes a name containing both quote kinds with
backslash escapes that its own parser does not read back. Schema v3
percent-encodes (as UTF-8 `%XX`) `%`, both quotes, the backtick, the
backslash, all whitespace except a single interior space, control characters,
and a trailing colon. Other text, including Vietnamese and Cyrillic, stays
readable, and `experiments/inspect-failed-clink-shard.mjs` classifies a
retained failure as `name-rewritten` or `link-mismatch` from counts alone.

The generic collection API is used for sources, offers and variants,
identities, observations, contacts, presets, user settings, subscriptions,
shown deliveries, Telegram update IDs, transport provenance, and persisted
send outcomes. `queryRecords` locates field relationships in links before
materializing matching records.

Large offer collections use `offers.index.json` as an atomic commit pointer to
content-addressed canonical `offers.chunks/HASH/offers.lino` files. Each file
still uses typed schema-v3 LiNo. A chunk is limited to 16 MiB by default;
the collection is partitioned by offer-id hash before any combined formatting.
The byte budget is checked from individually formatted offers in one pass.
Offers posted within the rolling two-month window are never evicted. If a
posting time is unavailable, the collection time is used; an offer with no
usable time is also protected. An insufficient budget fails the write and
leaves the prior index active. Older offers are evicted from oldest to newest,
with ID as the tie-breaker. Search
state, update cursors, subscriptions, and delivery cursors are separate
collections and are never included in offer eviction. Small collections keep
the existing `offers.lino` layout. The first large write stages and verifies
all chunks, then atomically activates the index; any interrupted staging
leaves the older file or index authoritative. An old `offers.lino` is retained
as a migration backup after index activation but is no longer current.

## Binary projection and commit protocol

Each canonical text snapshot has a SHA-256 content hash. `LinkCliMirror`
imports it into a fresh immutable `.binary/KIND-HASH` database, exports it
again, and verifies every source link before the text commit is allowed. The
canonical file is fsynced, atomically renamed, and followed by a parent
directory fsync. Only then is a small `KIND.current.json` pointer atomically
activated. Old candidates are compacted after activation.

`clink` 0.2.x imports in time quadratic in the database size, because every
update scans the whole store for uniqueness and usages; a 16 MiB collection
did not finish within the 10-minute process deadline (#43). Collections larger
than 128 top-level links are therefore projected as content-defined shards:
boundaries fall after whole links chosen by a hash of the link id (32 links
minimum, about 64 on average, 128 maximum), and the shards must concatenate to
the canonical text byte-for-byte or the collection is projected as a single
database. Each shard is imported into its own `.binary/KIND.shards/SHARD-HASH`
database with bounded parallelism, and its export is verified link-by-link
before its manifest is written. The `KIND-HASH` manifest lists the ordered
shard hashes. A later save reuses every unchanged shard by hash and imports
only the shards containing edits. Reuse requires the database, names database,
and verified export to match the SHA-256 digests recorded after verification,
so an unchanged shard is never trusted without its verified bytes. Progress is
reported as aggregate `completed`/`reused`/`total` shard counts only. A failed
or interrupted projection keeps its verified shards, because only activation
prunes, so the next attempt imports only the rest. A verification failure
records only counts (canonical, exported, missing, rewritten, and unexpected
links) in the candidate's `failure.json`, never names or values.

The 10-minute `clink` deadline applies to each process, which now imports at
most 128 links. On the reference host (6 vCPU, 11 GiB, four concurrent `clink`
processes), a 4.8 MB collection of 42,001 links in 647 shards projected cold in
77–100 seconds with a peak resident set of about 400 MiB for the whole process
tree, and re-saved after a one-record edit in about 10 seconds. Cold time and
memory grow linearly with the text, so a 16 MiB collection is expected to need
roughly 5–6 minutes and about 1.4 GiB once, then seconds per incremental save.
That is an extrapolation until the private corpus is rerun.
`experiments/sample-tree-rss.sh` measures the peak memory of any benchmark.

`links-notation` rejects input longer than 10 MiB by default, which a single
real Telegram source already exceeds, so canonical snapshots are parsed with
an explicit 256 MiB bound (`parseNotation`). Decoding indexes links by id and
owner once instead of scanning every link per record and field, so reading
42,001 links fell from about 60 seconds to about 8 seconds, most of which is
the parse itself. An unchanged save still parses the text once to derive its
shard layout; `experiments/measure-sharded-projection.mjs` and
`experiments/measure-deserialize.mjs` reproduce these measurements.

The text is authoritative because it is portable and reviewable. A missing,
corrupt, or mismatched binary pointer is rebuilt from its hash-matched text on
read. A binary-stage failure leaves the prior text untouched. Interruption
after the text rename but before pointer activation leaves a complete text
snapshot that is repaired on restart. `clink` performs its import against a
new database, so a partial database is never made current.

For indexed offers, each chunk has its own verified binary projection.
Readers compare the chunk's SHA-256, byte length, and record count with the
index, then check or repair that chunk's binary projection. Duplicate index
entries and duplicate offer IDs fail closed. An interrupted write cannot
expose some new chunks and some old chunks because the index is written last.
The data schema marker advances to version 3 before index activation, so an
older image cannot silently read the stale legacy file after an indexed write.
Generic record reads, queries, replacements, and updates for `offers` also
resolve through the active index. Deploy snapshots include the index and
canonical chunks, while excluding each chunk's rebuildable `.binary` cache;
the cutover drill fingerprints decoded offers from the active index.

In-process writes share a promise queue. Separate processes coordinate through
`.write.lock/owner.json`; a dead owner PID is recovered, while a live owner is
never stolen. Offer merge/read/write occurs under this lock, preventing lost
updates. Failed lock acquisition is bounded and actionable.

## Migration and local installation

The reader recognizes the previous opaque base64url LiNo record and the
associative schemas v1, v2, and v3. With the binary mirror enabled, a read of
text written by an earlier schema first rewrites it as schema v3 under the
write lock, projects and verifies it, and only then replaces the text, so a v2
collection that `clink` cannot import unchanged is still readable. Without the
mirror, the next successful save writes schema v3. A v2 name containing both
quote kinds was never readable as written. With the mirror enabled, `clink`
refused that text before it was committed; without the mirror, the damaged
value was already read back on the first load and cannot be recovered.
Install the supported CLI:

```bash
cargo install link-cli --version 0.2.10 --locked
clink --help
LINKS_BINARY_MIRROR=1 node bin/vietnam-accomodation-search.js search Nha Trang
```

The production image includes this exact version. Mirror errors are surfaced;
they are never silently treated as a successful write.

## Budget, backup, corruption, and compaction

The default offer ceiling is 10 GiB of canonical LiNo. The media cache has a
separate 10 GiB ceiling and evicts its oldest blobs first. Offer `photos` URLs
remain intact; only local `cachedPhotos` entries are removed. Provision space
for canonical text, binary projections, recovery metadata, and media together.
If protected durable state cannot fit its configured ceiling, the write fails
without replacing the current snapshot; operators must expand or compact it.

For a consistent point-in-time backup, stop the writer and archive the entire
host data root as described in [deployment](deployment.md). To restore, extract
into an empty stopped `0700` directory. On first read, content hashes and verified
`clink` export repair the binary projection. Corrupt canonical text is not
guessed around: restore the last archive, retain the damaged file for
forensics, and run the test/query preflight before restart.

### Offer order contract

`saveRecords('offers', records)` replaces the collection in the supplied order.
`updateRecords('offers', update)` preserves the returned array's order. Both
`listOffers()` and `loadRecords('offers')` return that order, including after a
restart, and `queryRecords` retains the relative order of matching records.
Budget eviction removes only eligible old offers and preserves survivor order.

`saveOffers(incoming)` is the merging API: it deduplicates existing and incoming
offers and retains its established newest-collection-first order, breaking ties
by offer ID. Search applies its requested recency/price ranking explicitly;
subscriptions retain their existing freshness checks and delivered-ID ledger.

Single-file canonical LiNo retains record order directly. Indexed collections
record an explicit `order` array of unique offer IDs alongside deterministic
hash-partitioned chunks; chunks sort by ID independently of public order.
Readers reject duplicate, missing, extra, or malformed order entries. Existing
v1 indexes without `order` retain their historical time/ID read order until the
next write adds it. Previously discarded insertion order cannot be reconstructed.
The additive v1 metadata is readable by older readers, which continue their old
sorting behavior; use the current reader when insertion order matters.

The `Required real clink 0.2.10 integration` CI job builds the production binary
with Cargo's locked dependency graph and runs the complete Node suite and line
coverage with `REQUIRE_REAL_CLINK=1`. Missing or mismatched binaries fail the job;
both publication paths and the terminal pipeline gate depend on its success.

The offer collection also has its own configured byte ceiling. Its conservative
preflight sum includes one schema header per offer, so it can reject a tight
budget before a formatted shard would exceed it. Indexed chunks are bounded
individually; `experiments/measure-offer-serialization.mjs` measures time,
peak process RSS, expansion, and shard sizes using synthetic records.

Compaction is snapshot based: successful writes replace old logical records,
binary activation prunes non-current candidates and shards (keeping only the
three newest `.failed-*` diagnostics per directory), shown-update and send-outcome
sets are bounded, and media eviction handles blobs. Never edit `.binary`
directly. Editing canonical LiNo intentionally causes a verified binary rebuild
on next read.

## Recovery drill

1. Stop the service and copy the volume.
2. Remove one `*.current.json` pointer, then start a read with
   `LINKS_BINARY_MIRROR=1`; verify it is recreated with the canonical hash.
3. Start two writer processes; verify both offers remain.
4. Terminate a writer after lock creation; verify the next writer recovers the
   dead-owner lock.
5. Reduce the cache budget in a test deployment; verify local media disappears
   while remote photo URLs and canonical records remain.
6. Restore the archive and run `telegram preflight` before returning traffic.
