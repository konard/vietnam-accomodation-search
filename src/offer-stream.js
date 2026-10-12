import { readFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, markIndexedSchema } from './chunk-files.js';
import { durableWrite } from './link-cli-mirror.js';
import {
  deserializeOffers,
  serializeOffers,
  serializeOfferBounded,
} from './links-store.js';
import { boundStoredOffer } from './offer-bounds.js';
import { streamSingleFileRecords } from './record-chunks.js';

const INDEX = 'offers.index.json';
const CHUNKS = 'offers.chunks';
const METADATA_BYTES = 8 * 1024 * 1024;

async function boundedText(path, maximum) {
  if ((await stat(path)).size > maximum) {
    throw new Error('Offer stream input exceeds its configured memory bound.');
  }
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > maximum) {
    throw new Error('Offer stream input grew beyond its memory bound.');
  }
  return text;
}

/** Storage order, one verified shard at a time; no process-wide parsed cache. */
// eslint-disable-next-line complexity -- Streaming validation handles legacy and indexed stores without eager materialization.
export async function* iterateOffers({
  directory,
  mirror,
  maxShardBytes = 16 * 1024 * 1024,
  signal,
}) {
  let index;
  try {
    index = JSON.parse(
      await boundedText(join(directory, INDEX), METADATA_BYTES)
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    const path = join(directory, 'offers.lino');
    try {
      await stat(path);
    } catch (missing) {
      if (missing.code === 'ENOENT') {
        return;
      }
      throw missing;
    }
    const size = (await stat(path)).size;
    if (size <= maxShardBytes) {
      for (const record of deserializeOffers(
        await boundedText(path, maxShardBytes)
      )) {
        signal?.throwIfAborted();
        yield boundStoredOffer(record);
      }
    } else {
      for await (const record of streamSingleFileRecords(path, 'offer')) {
        signal?.throwIfAborted();
        yield boundStoredOffer(record);
      }
    }
    return;
  }
  if (
    index.version !== 1 ||
    !Array.isArray(index.shards) ||
    !Number.isSafeInteger(index.count) ||
    !Number.isSafeInteger(index.bytes) ||
    index.count < 0 ||
    index.count * 128 > METADATA_BYTES
  ) {
    throw new Error('Invalid or oversized offer stream index.');
  }
  const seen = new Set();
  let count = 0;
  let bytes = 0;
  for (const shard of index.shards) {
    signal?.throwIfAborted();
    if (
      !/^[a-f\d]{64}$/u.test(shard.sha256) ||
      !Number.isSafeInteger(shard.count) ||
      !Number.isSafeInteger(shard.bytes) ||
      shard.bytes < 0
    ) {
      throw new Error('Invalid offer stream shard.');
    }
    const shardDirectory = join(directory, CHUNKS, shard.sha256);
    const notation = await boundedText(
      join(shardDirectory, 'offers.lino'),
      maxShardBytes
    );
    if (
      digest(notation) !== shard.sha256 ||
      Buffer.byteLength(notation) !== shard.bytes
    ) {
      throw new Error('Offer stream shard checksum mismatch.');
    }
    await mirror?.ensure?.({
      directory: shardDirectory,
      kind: 'offers',
      notation,
    });
    const records = deserializeOffers(notation);
    if (records.length !== shard.count) {
      throw new Error('Offer stream shard count mismatch.');
    }
    for (const record of records) {
      signal?.throwIfAborted();
      const id = String(record.id);
      if (seen.has(id)) {
        throw new Error('Duplicate offer stream identity.');
      }
      seen.add(id);
      count += 1;
      yield boundStoredOffer(record);
    }
    bytes += shard.bytes;
  }
  if (
    count !== index.count ||
    bytes !== index.bytes ||
    (index.order &&
      (index.order.length !== count || index.order.some((id) => !seen.has(id))))
  ) {
    throw new Error('Offer stream totals or order mismatch.');
  }
}

/** Publish an already reconciled stream atomically; incomplete chunks stay resumable. */
export async function writeOfferStream({
  directory,
  offers,
  mirror,
  maxBytes,
  maxShardBytes = 1024 * 1024,
  signal,
  check = async () => {},
}) {
  if (
    !Number.isSafeInteger(maxShardBytes) ||
    maxShardBytes < 1 ||
    !Number.isFinite(maxBytes) ||
    maxBytes < 1
  ) {
    throw new RangeError('Offer stream budgets must be positive finite bytes.');
  }
  const index = { version: 1, shards: [], order: [], count: 0, bytes: 0 };
  const ids = new Set();
  let batch = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) {
      return;
    }
    signal?.throwIfAborted();
    await check();
    const notation = serializeOffers(batch);
    const bytes = Buffer.byteLength(notation);
    if (bytes > maxShardBytes || index.bytes + bytes > maxBytes) {
      throw Object.assign(
        new Error('Canonical streaming storage budget exceeded.'),
        { code: 'offer-budget-exhausted' }
      );
    }
    const sha256 = digest(notation);
    const shardDirectory = join(directory, CHUNKS, sha256);
    await mkdir(shardDirectory, { recursive: true, mode: 0o700 });
    await durableWrite(join(shardDirectory, 'offers.lino'), notation);
    const projection = await mirror?.stage?.({
      directory: shardDirectory,
      kind: 'offers',
      notation,
    });
    await projection?.activate();
    index.shards.push({ sha256, bytes, count: batch.length });
    index.bytes += bytes;
    index.count += batch.length;
    batch = [];
    batchBytes = 0;
  };
  for await (const input of offers) {
    signal?.throwIfAborted();
    const offer = boundStoredOffer(input);
    const id = String(offer.id);
    if (ids.has(id)) {
      throw new Error('Offer stream must be reconciled before publication.');
    }
    if ((index.order.length + 1) * 128 > METADATA_BYTES) {
      throw new Error(
        'Offer stream metadata budget exceeded; staged data retained.'
      );
    }
    ids.add(id);
    index.order.push(id);
    const size = Buffer.byteLength(serializeOfferBounded(offer, maxShardBytes));
    if (batch.length && batchBytes + size > maxShardBytes) {
      await flush();
    }
    batch.push(offer);
    batchBytes += size;
  }
  await flush();
  signal?.throwIfAborted();
  await check();
  const notation = JSON.stringify(index);
  if (Buffer.byteLength(notation) > METADATA_BYTES) {
    throw new Error('Offer stream metadata budget exceeded.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await markIndexedSchema(directory);
  await durableWrite(join(directory, INDEX), `${notation}\n`);
  // Stale chunks remain until the ordinary writer prunes them. This permits
  // interrupted imports and avoids deleting a concurrent reader's evidence.
}
