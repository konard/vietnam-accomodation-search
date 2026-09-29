import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_SCHEMA_VERSION } from './data-schema.js';
import { durableWrite } from './link-cli-mirror.js';
import {
  deserializeOffers,
  isCurrentSchema,
  serializeOfferBounded,
  serializeOffers,
} from './links-store.js';

export const DEFAULT_OFFER_SHARD_BYTES = 16 * 1024 * 1024;
const INDEX_NAME = 'offers.index.json';
const CHUNK_DIRECTORY = 'offers.chunks';
const TWO_MONTHS_MS = 62 * 24 * 60 * 60 * 1000;
const SCHEMA_FILE = '.state-schema.json';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readOrEmpty(path) {
  return readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  });
}

function ordered(offers) {
  return [...offers].sort(
    (left, right) =>
      new Date(right.collectedAt || 0) - new Date(left.collectedAt || 0) ||
      String(left.id).localeCompare(String(right.id))
  );
}

function protectedOffer(offer, now) {
  const postedAt = Date.parse(offer.postedAt);
  return Number.isFinite(postedAt) && postedAt >= now - TWO_MONTHS_MS;
}

function preparedOffers(offers, maxBytes, maxShardBytes) {
  if (new Set(offers.map(({ id }) => String(id))).size !== offers.length) {
    throw new Error('Canonical offer collection contains duplicate offer IDs.');
  }
  const prepared = ordered(offers).map((offer) => ({
    bytes: Buffer.byteLength(serializeOfferBounded(offer, maxShardBytes)),
    offer,
  }));
  let total = prepared.reduce((sum, entry) => sum + entry.bytes, 0);
  const now = Date.now();
  for (
    let index = prepared.length - 1;
    total > maxBytes && index >= 0;
    index--
  ) {
    if (!protectedOffer(prepared[index].offer, now)) {
      total -= prepared[index].bytes;
      prepared.splice(index, 1);
    }
  }
  if (total > maxBytes) {
    const error = new Error(
      'Offer storage budget cannot retain the two-month listing window.'
    );
    error.code = 'offer-budget-exhausted';
    throw error;
  }
  return { prepared, total };
}

export function partitionOfferEntries(
  entries,
  maxShardBytes,
  prefix = '',
  depth = 0
) {
  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (bytes <= maxShardBytes) {
    return [{ entries, prefix }];
  }
  if (entries.length === 1 || depth === 64) {
    const error = new Error(
      'One offer exceeds the maximum canonical LiNo shard size.'
    );
    error.code = 'offer-shard-too-large';
    throw error;
  }
  const buckets = new Map();
  for (const entry of entries) {
    const digit = digest(String(entry.offer.id))[depth];
    buckets.set(digit, [...(buckets.get(digit) || []), entry]);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([digit, group]) =>
      partitionOfferEntries(
        group,
        maxShardBytes,
        `${prefix}${digit}`,
        depth + 1
      )
    );
}

function validateIndex(index) {
  if (
    index?.version !== 1 ||
    !Number.isSafeInteger(index.count) ||
    !Number.isSafeInteger(index.bytes) ||
    !Array.isArray(index.shards) ||
    index.shards.some(
      (shard) =>
        !/^[a-f\d]{64}$/u.test(shard.sha256) ||
        !Number.isSafeInteger(shard.bytes) ||
        !Number.isSafeInteger(shard.count)
    ) ||
    new Set(index.shards.map(({ sha256 }) => sha256)).size !==
      index.shards.length
  ) {
    throw new Error('Invalid canonical offer index.');
  }
}

async function markIndexedSchema(directory) {
  const path = join(directory, SCHEMA_FILE);
  const existing = await readOrEmpty(path);
  if (existing) {
    const version = JSON.parse(existing).schemaVersion;
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('Data schema marker has an invalid version.');
    }
    if (version >= DATA_SCHEMA_VERSION) {
      return;
    }
  }
  await durableWrite(
    path,
    `${JSON.stringify({ schemaVersion: DATA_SCHEMA_VERSION })}\n`
  );
}

async function readLegacyOffers({ directory, mirror, offersPath }) {
  let notation = await readOrEmpty(offersPath);
  if (mirror && notation.trim() && !isCurrentSchema('offer', notation)) {
    notation = serializeOffers(deserializeOffers(notation));
    const staged = await mirror.stage({ directory, kind: 'offers', notation });
    await durableWrite(offersPath, notation);
    await staged.activate();
  }
  await mirror?.ensure?.({ directory, kind: 'offers', notation });
  return deserializeOffers(notation);
}

async function readIndexedOffers(index, { directory, mirror }) {
  validateIndex(index);
  const offers = [];
  let bytes = 0;
  for (const shard of index.shards) {
    const chunkDirectory = join(directory, CHUNK_DIRECTORY, shard.sha256);
    const notation = await readFile(
      join(chunkDirectory, 'offers.lino'),
      'utf8'
    );
    if (
      digest(notation) !== shard.sha256 ||
      Buffer.byteLength(notation) !== shard.bytes
    ) {
      throw new Error('Canonical offer shard does not match its index.');
    }
    await mirror?.ensure?.({
      directory: chunkDirectory,
      kind: 'offers',
      notation,
    });
    const records = deserializeOffers(notation);
    if (records.length !== shard.count) {
      throw new Error('Canonical offer shard count does not match its index.');
    }
    offers.push(...records);
    bytes += shard.bytes;
  }
  if (offers.length !== index.count || bytes !== index.bytes) {
    throw new Error('Canonical offer totals do not match the index.');
  }
  if (new Set(offers.map(({ id }) => String(id))).size !== offers.length) {
    throw new Error('Canonical offer index contains duplicate offer IDs.');
  }
  return ordered(offers);
}

export async function readOfferCollection(options) {
  let index;
  try {
    index = JSON.parse(
      await readFile(join(options.directory, INDEX_NAME), 'utf8')
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      return readLegacyOffers(options);
    }
    throw error;
  }
  return readIndexedOffers(index, options);
}

export async function writeOfferCollection({
  directory,
  maxBytes,
  maxShardBytes,
  mirror,
  offers,
  offersPath,
  removeStaleChunk = rm,
}) {
  const { prepared, total } = preparedOffers(offers, maxBytes, maxShardBytes);
  const indexPath = join(directory, INDEX_NAME);
  const existingIndex = await readOrEmpty(indexPath);
  if (!existingIndex && total <= maxShardBytes) {
    const notation = serializeOffers(prepared.map(({ offer }) => offer));
    const staged = await mirror?.stage?.({
      directory,
      kind: 'offers',
      notation,
    });
    await durableWrite(offersPath, notation);
    await staged?.activate();
    return;
  }
  const groups = partitionOfferEntries(prepared, maxShardBytes);
  const shards = [];
  for (const { entries } of groups) {
    if (!entries.length) {
      continue;
    }
    const notation = serializeOffers(entries.map(({ offer }) => offer));
    const bytes = Buffer.byteLength(notation);
    const sha256 = digest(notation);
    const chunkDirectory = join(directory, CHUNK_DIRECTORY, sha256);
    await mkdir(chunkDirectory, { recursive: true, mode: 0o700 });
    await durableWrite(join(chunkDirectory, 'offers.lino'), notation);
    const staged = await mirror?.stage?.({
      directory: chunkDirectory,
      kind: 'offers',
      notation,
    });
    await staged?.activate();
    shards.push({ bytes, count: entries.length, sha256 });
  }
  const index = {
    bytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
    count: prepared.length,
    shards,
    version: 1,
  };
  await mkdir(join(directory, CHUNK_DIRECTORY), {
    recursive: true,
    mode: 0o700,
  });
  await markIndexedSchema(directory);
  await durableWrite(indexPath, `${JSON.stringify(index)}\n`);
  const keep = new Set(shards.map(({ sha256 }) => sha256));
  try {
    for (const name of await readdir(join(directory, CHUNK_DIRECTORY))) {
      if (!keep.has(name)) {
        await removeStaleChunk(join(directory, CHUNK_DIRECTORY, name), {
          recursive: true,
          force: true,
        });
      }
    }
  } catch {
    // The new index is already durable; stale chunks are safe to prune later.
  }
}
