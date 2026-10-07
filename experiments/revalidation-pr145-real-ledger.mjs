#!/usr/bin/env node

// Manual, private-data acceptance probe. Prints counters and hashes, not bodies.
// QA_REAL_LEDGER=1 node --max-old-space-size=2048 SCRIPT JOURNAL_JSON REPORT_JSON
// Run without another projection, parser replay, or runtime suite for timing.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { LinkCliMirror, runClink } from '../src/link-cli-mirror.js';
import { LinksStore } from '../src/links-store.js';

if (
  process.env.QA_REAL_LEDGER !== '1' ||
  !process.argv[2] ||
  !process.argv[3]
) {
  throw new TypeError(
    'Opt in with QA_REAL_LEDGER=1 and supply journal/report.'
  );
}
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const command = process.env.CLINK_COMMAND || 'clink';
const clinkVersion = execFileSync(command, ['--version'], {
  encoding: 'utf8',
}).trim();
assert.equal(clinkVersion, 'clink 0.2.11');
const shardLinks = process.env.QA_LEDGER_SHARD_LINKS
  ? Number(process.env.QA_LEDGER_SHARD_LINKS)
  : undefined;
if (shardLinks !== undefined) {
  assert(
    Number.isInteger(shardLinks) && shardLinks >= 32 && shardLinks <= 2048
  );
}
const journal = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(digest(journal.payload), journal.digest);
assert.equal(journal.payload.version, 1);
assert.equal(journal.payload.reachedCutoff, true);
assert.equal(journal.payload.hitCap, false);
const batch = journal.payload.batch;
assert(Array.isArray(batch.domainRecords) && batch.domainRecords.length > 0);
assert(Array.isArray(batch.traceRecords) && Array.isArray(batch.offers));

// Fail before any test-state writes when shared machine headroom is unsafe.
const initialSpace = await statfs(tmpdir());
const initialFreeBytes = initialSpace.bavail * initialSpace.bsize;
if (initialFreeBytes < 8 * 1024 ** 3) {
  throw new Error('QA_DISK_PREFLIGHT: at least 8 GiB free is required.');
}
const directory = await mkdtemp(join(tmpdir(), 'pr145-real-ledger-e2e-'));
// Deduplication, recency ordering and bounds are intentional offer semantics.
// Establish the expected stored shape before timing actual binary projection.
const reference = new LinksStore({ directory: join(directory, 'reference') });
await reference.saveOffers(batch.offers);
const expectedOffers = await reference.listOffers();
const started = performance.now();
const result = {
  mode: 'retained-real-journal',
  startedAt: new Date().toISOString(),
  journalChecksumVerified: true,
  clinkVersion,
  shardConfiguration: shardLinks || 'production-default',
  initialFreeBytes,
  minimumFreeBytes: 2 * 1024 ** 3,
  messages: journal.payload.messagesCount,
  records: batch.domainRecords.length,
  recordJsonBytes: Buffer.byteLength(JSON.stringify(batch.domainRecords)),
  offers: batch.offers.length,
  expectedStoredOffers: expectedOffers.length,
  traces: batch.traceRecords.length,
  reachedCutoff: true,
  hitCap: false,
  imports: 0,
  importMs: 0,
  phases: [],
  pass: false,
};
const save = () =>
  writeFile(process.argv[3], `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
const headroom = async () => {
  const stats = await statfs(directory);
  const available = stats.bavail * stats.bsize;
  if (available < result.minimumFreeBytes) {
    const error = new Error('QA disk floor reached; no complete-store claim.');
    error.code = 'QA_DISK_HEADROOM';
    throw error;
  }
  if (performance.now() - started > 30 * 60_000) {
    const error = new Error('QA time budget reached; no complete-store claim.');
    error.code = 'QA_TIME_BUDGET';
    throw error;
  }
};
try {
  await headroom();
  const store = new LinksStore({
    directory: join(directory, 'actual'),
    binaryMirror: true,
    maxBytes: 512 * 1024 ** 2,
    mirror: new LinkCliMirror({
      command,
      ...(shardLinks === undefined
        ? {}
        : {
            minShardLinks: Math.floor(shardLinks / 4),
            averageShardLinks: Math.floor(shardLinks / 2),
            maxShardLinks: shardLinks,
          }),
      run: async (...arguments_) => {
        await headroom();
        const importStarted = performance.now();
        try {
          await runClink(...arguments_);
        } finally {
          result.imports += 1;
          result.importMs += performance.now() - importStarted;
          if (result.imports % 1000 === 0) {
            console.log(
              JSON.stringify({
                phase: 'projection',
                imports: result.imports,
                elapsedMs: Math.round(performance.now() - started),
              })
            );
          }
        }
      },
    }),
  });
  for (const [name, operation] of [
    [
      'domain-write',
      () => store.appendRecords('domain-records', batch.domainRecords),
    ],
    ['trace-write', () => store.appendRecords('traces', batch.traceRecords)],
    ['offer-write', () => store.saveOffers(batch.offers)],
  ]) {
    await headroom();
    const phaseStarted = performance.now();
    await operation();
    result.phases.push({
      name,
      elapsedMs: Math.round(performance.now() - phaseStarted),
    });
    await save();
    console.log(JSON.stringify(result.phases.at(-1)));
  }
  const readStarted = performance.now();
  // A fresh store must restore the entire ledger, not reuse write-side caches.
  const restarted = new LinksStore({
    directory: join(directory, 'actual'),
    binaryMirror: true,
    mirror: new LinkCliMirror({ command }),
  });
  assert.deepEqual(
    await restarted.loadRecords('domain-records'),
    batch.domainRecords
  );
  assert.deepEqual(await restarted.loadRecords('traces'), batch.traceRecords);
  const restored = await restarted.listOffers();
  assert.deepEqual(restored, expectedOffers);
  result.phases.push({
    name: 'fresh-store-readback',
    elapsedMs: Math.round(performance.now() - readStarted),
  });
  result.pass = true;
} catch (error) {
  result.error = {
    type: error.constructor.name,
    code: error.code || 'QA_FAILURE',
  };
  process.exitCode = 1;
} finally {
  result.importMs = Math.round(result.importMs);
  result.totalMs = Math.round(performance.now() - started);
  await save();
  await rm(directory, { recursive: true, force: true });
  console.log(JSON.stringify(result));
}
