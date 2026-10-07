#!/usr/bin/env node
// Finite, isolated, synthetic full-body ledger. No private source data is read.
// node --max-old-space-size=2048 experiments/issue-143-ledger-profile.mjs 24 128
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { auditTelegramBatch } from './telegram-live-audit-runtime.mjs';
import { LinkCliMirror, runClink } from '../src/link-cli-mirror.js';
import { LinksStore } from '../src/links-store.js';

const count = Number(process.argv[2] || 24);
const shardLinks = Number(process.argv[3] || 128);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 368 ||
  !Number.isInteger(shardLinks) ||
  shardLinks < 32 ||
  shardLinks > 2048
) {
  throw new RangeError('Use 1..368 offers and 32..2048 shard links.');
}
const now = new Date('2026-10-07T00:00:00Z');
const messages = Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  chatId: 'qa-profile',
  date: now,
  text: `For rent: studio apartment ${index} in Nha Trang, 13 million VND/month.\n${Array.from(
    { length: 32 },
    (_, line) => `Amenity ${line}: furnished accommodation detail ${index}.`
  ).join('\n')}`,
}));
const batch = await auditTelegramBatch(messages, {
  now,
  sourceAlias: 'qa-profile',
});
const directory = await mkdtemp(join(tmpdir(), 'issue-143-ledger-'));
let imports = 0;
let importMs = 0;
const started = performance.now();
try {
  const store = new LinksStore({
    directory,
    binaryMirror: true,
    mirror: new LinkCliMirror({
      command: process.env.CLINK_COMMAND || 'clink',
      minShardLinks: Math.floor(shardLinks / 4),
      averageShardLinks: Math.floor(shardLinks / 2),
      maxShardLinks: shardLinks,
      onProgress:
        process.env.ISSUE_143_PROGRESS === '1'
          ? (event) => console.error(JSON.stringify(event))
          : undefined,
      run: async (...args) => {
        imports += 1;
        const importStarted = performance.now();
        try {
          await runClink(...args);
        } finally {
          importMs += performance.now() - importStarted;
        }
      },
    }),
  });
  await store.appendRecords('domain-records', batch.domainRecords);
  const elapsedMs = Math.round(performance.now() - started);
  if (process.env.ISSUE_143_PROGRESS === '1') {
    console.error(JSON.stringify({ status: 'ledger-persisted', elapsedMs }));
  }
  const readStarted = performance.now();
  const loaded = await store.loadRecords('domain-records');
  const readMs = Math.round(performance.now() - readStarted);
  const roundTrip =
    JSON.stringify(loaded) === JSON.stringify(batch.domainRecords);
  console.log(
    JSON.stringify({
      count,
      shardLinks,
      records: batch.domainRecords.length,
      jsonBytes: Buffer.byteLength(JSON.stringify(batch.domainRecords)),
      imports,
      importMs: Math.round(importMs),
      elapsedMs,
      readMs,
      totalMs: Math.round(performance.now() - started),
      roundTrip,
    })
  );
  if (!roundTrip) {
    process.exitCode = 1;
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
