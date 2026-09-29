#!/usr/bin/env node

// Synthetic, aggregate-only offer storage profile. No Telegram data is read.
// Usage: node experiments/measure-offer-serialization.mjs [count] [shardBytes]

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { LinksStore, serializeOffers } from '../src/index.js';

const count = Number(process.argv[2] || 80);
const shardBytes = Number(process.argv[3] || 1024 * 1024);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  !Number.isSafeInteger(shardBytes) ||
  shardBytes < 1
) {
  throw new Error('Pass a positive offer count and shard byte limit.');
}

const offers = Array.from({ length: count }, (_, index) => ({
  collectedAt: '2026-09-29T00:00:00.000Z',
  id: `synthetic-${index}`,
  postedAt: '2026-09-28T00:00:00.000Z',
  raw: {
    segments: Array.from({ length: 12 }, (_, segment) => ({
      content: `Căn hộ apartment квартира ${index} ${segment} ${'x'.repeat(70)}`,
      language: ['vi', 'en', 'ru'][segment % 3],
    })),
  },
  sourceId: `synthetic-source-${index % 40}`,
  title: `Synthetic room ${index}`,
}));
const jsonBytes = offers.reduce(
  (sum, offer) => sum + Buffer.byteLength(JSON.stringify(offer)),
  0
);
const offerBytes = offers.map((offer) =>
  Buffer.byteLength(serializeOffers([offer]))
);
const directory = await mkdtemp(join(tmpdir(), 'offer-serialization-profile-'));
let peakRss = process.memoryUsage().rss;
const monitor = globalThis.setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 20);
try {
  const store = new LinksStore({
    directory,
    maxBytes: 10 * 1024 ** 3,
    maxOfferShardBytes: shardBytes,
  });
  const start = performance.now();
  await store.saveOffers(offers);
  const firstMs = Math.round(performance.now() - start);
  const index = JSON.parse(
    await readFile(join(directory, 'offers.index.json'), 'utf8')
  );
  const restored = await store.listOffers();
  const secondStart = performance.now();
  await store.saveOffers(offers);
  const secondMs = Math.round(performance.now() - secondStart);
  const repeatedIndex = JSON.parse(
    await readFile(join(directory, 'offers.index.json'), 'utf8')
  );
  if (restored.length !== count || index.count !== count) {
    throw new Error('The synthetic round trip lost an offer.');
  }
  console.log(
    JSON.stringify({
      count,
      expansionFactor: Number((index.bytes / jsonBytes).toFixed(2)),
      firstMs,
      jsonBytes,
      maxOfferBytes: Math.max(...offerBytes),
      maxShardBytes: Math.max(...index.shards.map(({ bytes }) => bytes)),
      peakRssBytes: peakRss,
      reusedShards: repeatedIndex.shards.filter((shard) =>
        index.shards.some(({ sha256 }) => sha256 === shard.sha256)
      ).length,
      secondMs,
      shards: index.shards.length,
      storedBytes: index.bytes,
    })
  );
} finally {
  globalThis.clearInterval(monitor);
  await rm(directory, { recursive: true, force: true });
}
