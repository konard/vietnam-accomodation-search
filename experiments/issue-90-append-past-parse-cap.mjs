#!/usr/bin/env node
// Appends audit-shaped domain records in batches with the production parse
// bound and chunk size until the collection is larger than the 256 MiB bound,
// and reports the time per batch, the chunk sizes, and a full streamed read.
// Usage: node experiments/issue-90-append-past-parse-cap.mjs [targetMiB] [batch]

import { performance } from 'node:perf_hooks';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LinksStore } from '../src/index.js';
import { MAX_NOTATION_LENGTH } from '../src/link-cli-mirror.js';
import { indexedRecordBatches } from '../src/record-chunks.js';

const targetBytes = Number(process.argv[2] || 300) * 1024 * 1024;
const batchSize = Number(process.argv[3] || 5000);
const directory = await mkdtemp(join(tmpdir(), 'issue-90-cap-'));
const store = new LinksStore({ directory });

function record(index) {
  return {
    id: `telegram:source-${index % 40}:${index}#values.text`,
    object: `Cho thuê căn hộ ${index} gần biển Nha Trang, 2 phòng ngủ, ${index % 900} USD/tháng`,
    predicate: 'values.text',
    sourceId: `source-${index % 40}`,
    subject: `telegram:source-${index % 40}:${index}`,
    type: 'semantic-link',
  };
}

const readIndex = async () =>
  JSON.parse(
    await readFile(join(directory, 'domain-records.index.json'), 'utf8')
  );

try {
  let next = 0;
  let bytes = 0;
  const times = [];
  while (bytes <= targetBytes) {
    const batch = Array.from({ length: batchSize }, () => record(next++));
    const started = performance.now();
    await store.appendRecords('domain-records', batch);
    times.push(performance.now() - started);
    bytes = (await readIndex().catch(() => ({ bytes: 0 }))).bytes;
  }
  const index = await readIndex();
  const sizes = index.chunks.map((chunk) => chunk.bytes);
  const started = performance.now();
  let streamed = 0;
  for await (const records of indexedRecordBatches(
    {
      collection: 'domain-records',
      directory,
      kind: 'domain-record',
      maxChunkBytes: store.maxRecordChunkBytes,
    },
    index,
    false
  )) {
    streamed += records.length;
  }
  console.log(
    JSON.stringify(
      {
        batches: times.length,
        collectionMiB: +(index.bytes / 1024 ** 2).toFixed(1),
        parseBoundMiB: MAX_NOTATION_LENGTH / 1024 ** 2,
        records: index.count,
        chunks: index.chunks.length,
        largestChunkKiB: Math.round(Math.max(...sizes) / 1024),
        meanChunkKiB: Math.round(index.bytes / sizes.length / 1024),
        firstBatchMs: Math.round(times[0]),
        lastBatchMs: Math.round(times.at(-1)),
        medianBatchMs: Math.round(
          [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
        ),
        streamedRecords: streamed,
        streamedReadMs: Math.round(performance.now() - started),
        peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
      },
      null,
      2
    )
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}
