# Associative storage and recovery

## Canonical schema

Human-inspectable `.lino` text is authoritative. Each collection has a schema
marker, record link, and one typed link per JSON Pointer-like field path.
Objects, arrays, strings, finite numbers, booleans, and null have explicit
types. Raw input and future unknown fields use the same recursively addressable
representation; they are not hidden in a single base64 JSON value. Every link
has exactly two values so `clink` can import it.

The generic collection API is used for sources, offers and variants,
identities, observations, contacts, presets, user settings, subscriptions,
shown deliveries, Telegram update IDs, transport provenance, and persisted
send outcomes. `queryRecords` locates field relationships in links before
materializing matching records.

## Binary projection and commit protocol

Each canonical text snapshot has a SHA-256 content hash. `LinkCliMirror`
imports it into a fresh immutable `.binary/KIND-HASH` database, exports it
again, and verifies every source link before the text commit is allowed. The
canonical file is fsynced, atomically renamed, and followed by a parent
directory fsync. Only then is a small `KIND.current.json` pointer atomically
activated. Old candidates are compacted after activation.

The text is authoritative because it is portable and reviewable. A missing,
corrupt, or mismatched binary pointer is rebuilt from its hash-matched text on
read. A binary-stage failure leaves the prior text untouched. Interruption
after the text rename but before pointer activation leaves a complete text
snapshot that is repaired on restart. `clink` performs its import against a
new database, so a partial database is never made current.

In-process writes share a promise queue. Separate processes coordinate through
`.write.lock/owner.json`; a dead owner PID is recovered, while a live owner is
never stolen. Offer merge/read/write occurs under this lock, preventing lost
updates. Failed lock acquisition is bounded and actionable.

## Migration and local installation

The reader recognizes the previous opaque base64url LiNo record and the first
associative schema. The next successful save deterministically writes schema
v2 and creates the binary mirror without data loss. Install the supported CLI:

```bash
cargo install link-cli --version 0.2.10 --locked
clink --help
LINKS_BINARY_MIRROR=1 node bin/vietnam-accomodation-search.js search Nha Trang
```

The production image includes this exact version. Mirror errors are surfaced;
they are never silently treated as a successful write.

## Budget, backup, corruption, and compaction

The 10 GiB budget counts every file below the data directory: canonical text,
binary and recovery metadata, offer state, and media. Oldest media blobs are
evicted first. Offer `photos` URLs remain intact; only local `cachedPhotos`
entries are removed. If durable state alone exceeds the budget, it is retained
rather than corrupted, and operators must archive/compact it.

For a consistent point-in-time backup, stop the writer and archive the entire
data volume as described in [deployment](deployment.md). To restore, extract
into an empty stopped volume. On first read, content hashes and verified
`clink` export repair the binary projection. Corrupt canonical text is not
guessed around: restore the last archive, retain the damaged file for
forensics, and run the test/query preflight before restart.

Compaction is snapshot based: successful writes replace old logical records,
binary activation prunes non-current candidates, shown-update and send-outcome
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
