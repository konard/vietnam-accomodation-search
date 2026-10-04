#!/usr/bin/env node

// Aggregate-only progress probe for a protected local Telegram audit copy.
// It never prints source aliases, IDs, messages, offers, or session data.

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { LinksStore } from '../src/index.js';

if (!process.argv[2]) {
  throw new TypeError('Pass the protected audit state directory.');
}

const directory = resolve(process.argv[2]);
const checkpoints = await new LinksStore({
  directory: join(directory, 'checkpoints'),
}).loadRecords('audit-checkpoints');
async function readIndex(name) {
  try {
    return JSON.parse(
      await readFile(join(directory, 'typed-results', name), 'utf8')
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return undefined;
  }
}
const index = await readIndex('offers.index.json');
const domainIndex = await readIndex('domain-records.index.json');
console.log(
  JSON.stringify({
    checkpointCount: checkpoints.length,
    completeCheckpointCount: checkpoints.filter(({ complete }) => complete)
      .length,
    indexedOfferCount: index?.count ?? null,
    indexedShardCount: index?.shards?.length ?? null,
    indexedDomainRecordBytes: domainIndex?.bytes ?? null,
    indexedDomainRecordChunkCount: domainIndex?.chunks?.length ?? null,
    indexedDomainRecordCount: domainIndex?.count ?? null,
  })
);
