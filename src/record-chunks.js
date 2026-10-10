import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StreamParser } from 'links-notation';

import {
  committedChunks,
  digest,
  markIndexedSchema,
  pruneChunks,
  readOrEmpty,
  removeChunks,
} from './chunk-files.js';
import { durableWrite, fnv1a, notationLimit } from './link-cli-mirror.js';
import {
  RECORDS_SCHEMA,
  deserializeRecords,
  formatRecord,
  formatSchemaHeader,
  queryRecords,
  recordsFromSchemaLinks,
} from './links-store.js';

// links-notation parses a document as one string, so every canonical file
// that is parsed whole (a single-file collection, a chunk, or a sub-shard of
// either) stays at or below a quarter of the parse bound.
export const DEFAULT_RECORD_CHUNK_BYTES = 4 * 1024 * 1024;
const IDS_FILE = 'ids.json';

export function maxNotationBytes() {
  return Math.floor(notationLimit() / 4);
}

export function recordChunkPaths(directory, collection) {
  return {
    chunks: join(directory, `${collection}.chunks`),
    index: join(directory, `${collection}.index.json`),
  };
}

function invalid(collection) {
  return new Error(`Invalid canonical ${collection} index.`);
}

function validChunk(chunk) {
  return (
    /^[a-f\d]{64}$/u.test(chunk?.sha256) &&
    Number.isSafeInteger(chunk.bytes) &&
    Number.isSafeInteger(chunk.count) &&
    chunk.count > 0
  );
}

function validateIndex(index, collection) {
  if (
    index?.version !== 1 ||
    index.kind !== collection ||
    !Array.isArray(index.chunks) ||
    !index.chunks.every(validChunk) ||
    index.count !== index.chunks.reduce((sum, { count }) => sum + count, 0) ||
    index.bytes !== index.chunks.reduce((sum, { bytes }) => sum + bytes, 0)
  ) {
    throw invalid(collection);
  }
  return index;
}

export async function readRecordIndex(directory, collection) {
  const text = await readOrEmpty(recordChunkPaths(directory, collection).index);
  if (!text) {
    return undefined;
  }
  let index;
  try {
    index = JSON.parse(text);
  } catch {
    throw invalid(collection);
  }
  return validateIndex(index, collection);
}

function chunkDirectory(context, sha256) {
  return join(
    recordChunkPaths(context.directory, context.collection).chunks,
    sha256
  );
}

function chunkFile(context, sha256) {
  return join(chunkDirectory(context, sha256), `${context.collection}.lino`);
}

async function readChunk(context, chunk, ensure) {
  const notation = await readFile(chunkFile(context, chunk.sha256), 'utf8');
  if (
    digest(notation) !== chunk.sha256 ||
    Buffer.byteLength(notation) !== chunk.bytes
  ) {
    throw new Error(
      `Canonical ${context.collection} chunk does not match its index.`
    );
  }
  if (ensure) {
    await context.mirror?.ensure?.({
      directory: chunkDirectory(context, chunk.sha256),
      kind: context.collection,
      notation,
    });
  }
  return notation;
}

async function chunkRecords(context, chunk, ensure = false) {
  const records = deserializeRecords(
    context.kind,
    await readChunk(context, chunk, ensure)
  );
  if (records.length !== chunk.count) {
    throw new Error(
      `Canonical ${context.collection} chunk count does not match its index.`
    );
  }
  return records;
}

// Yields each chunk's records in collection order, so a caller can scan an
// indexed collection while holding one chunk at a time.
export async function* indexedRecordBatches(context, index, ensure = true) {
  for (const chunk of index.chunks) {
    yield await chunkRecords(context, chunk, ensure);
  }
}

export async function readIndexedRecords(context, index, ensure = true) {
  const records = [];
  for await (const batch of indexedRecordBatches(context, index, ensure)) {
    for (const record of batch) {
      records.push(record);
    }
  }
  return records;
}

export async function queryIndexedRecords(context, index, query) {
  const matches = [];
  for (const chunk of index.chunks) {
    const notation = await readChunk(context, chunk, true);
    matches.push(...queryRecords(context.kind, notation, query));
  }
  return matches;
}

// Ids are derived from the chunk text, so a missing or stale sidecar is
// rebuilt from the chunk itself.
async function chunkIds(context, chunk) {
  const path = join(chunkDirectory(context, chunk.sha256), IDS_FILE);
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'));
    if (
      stored.sha256 === chunk.sha256 &&
      Array.isArray(stored.ids) &&
      stored.ids.length === chunk.count
    ) {
      return stored.ids;
    }
  } catch {
    // Rebuilt below.
  }
  const ids = (await chunkRecords(context, chunk)).map(({ id }) => id ?? null);
  await durableWrite(
    path,
    `${JSON.stringify({ ids, sha256: chunk.sha256 })}\n`
  );
  return ids;
}

// Every record of the oversized single file, read one top-level link at a
// time so the whole text is never one string.
export async function* streamSingleFileRecords(path, kind) {
  const limit = maxNotationBytes();
  const parser = new StreamParser({
    collect: false,
    maxBufferSize: limit,
    maxInputSize: limit,
  });
  let header = false;
  let group = [];
  function* take(links) {
    for (const link of links) {
      if (!header) {
        if (link.id !== kind || link.values[0]?.id !== RECORDS_SCHEMA) {
          const error = new Error(
            'A canonical collection above the parse bound must use the current schema.'
          );
          error.code = 'legacy-collection-too-large';
          throw error;
        }
        header = true;
      } else if (
        link.values[0]?.id === `kind:${kind}` &&
        link.id.startsWith(`record:${kind}:`) &&
        group.length
      ) {
        yield recordsFromSchemaLinks(kind, group)[0];
        group = [link];
      } else {
        group.push(link);
      }
    }
  }
  for await (const text of createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: 1024 * 1024,
  })) {
    yield* take(parser.write(text));
  }
  yield* take(parser.end());
  if (group.length) {
    yield recordsFromSchemaLinks(kind, group)[0];
  }
}

// True when a single-file collection is too large to be parsed as one text.
export async function oversizedSingleFile(path) {
  try {
    return (await stat(path)).size > maxNotationBytes();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function tooLarge(collection) {
  const error = new Error(
    `One ${collection} record exceeds the maximum canonical LiNo chunk size.`
  );
  error.code = 'record-too-large';
  return error;
}

// Groups records into chunks whose boundaries depend on record ids and sizes
// only, so a save that changes a few records rewrites only their chunks.
// A cut follows a record once the chunk holds a quarter of the chunk size,
// with a probability that makes chunks average half of it.
class ChunkWriter {
  constructor(context, { committed = new Set(), hold = 0, reuse = [] } = {}) {
    this.context = context;
    this.committed = committed;
    this.created = [];
    this.entries = [];
    this.header = formatSchemaHeader(context.kind);
    this.maxBytes = Math.min(context.maxChunkBytes, maxNotationBytes());
    this.hold = Math.min(hold, this.maxBytes);
    this.pending = [];
    this.pendingBytes = 0;
    this.reuse = reuse;
    this.#reset();
  }

  #reset() {
    this.bytes = Buffer.byteLength(this.header);
    this.ids = [];
    this.lines = [];
  }

  get totalBytes() {
    return (
      this.entries.reduce((sum, { bytes }) => sum + bytes, 0) +
      this.pendingBytes
    );
  }

  async add(record) {
    let line = formatRecord(this.context.kind, record, this.ids.length);
    if (
      this.ids.length &&
      this.bytes + Buffer.byteLength(line) + 1 > this.maxBytes
    ) {
      await this.#flush();
      line = formatRecord(this.context.kind, record, 0);
    }
    const size = Buffer.byteLength(line) + 1;
    if (this.bytes + size > maxNotationBytes()) {
      throw tooLarge(this.context.collection);
    }
    this.bytes += size;
    this.ids.push(record.id ?? null);
    this.lines.push(line);
    const minimum = this.maxBytes / 4;
    const cut =
      this.bytes >= this.maxBytes ||
      (this.bytes >= minimum &&
        fnv1a(record.id === undefined ? line : String(record.id)) / 2 ** 32 <
          size / (this.maxBytes / 2 - minimum));
    if (cut) {
      await this.#flush();
    }
  }

  async #flush() {
    if (!this.ids.length) {
      return;
    }
    const notation = [this.header, ...this.lines].join('\n');
    const entry = {
      bytes: this.bytes,
      count: this.ids.length,
      sha256: digest(notation),
    };
    this.pending.push({ entry, ids: this.ids, notation });
    this.pendingBytes += entry.bytes;
    this.#reset();
    if (this.pendingBytes > this.hold) {
      await this.#writePending();
    }
  }

  async #writePending() {
    for (const chunk of this.pending) {
      await this.#write(chunk);
      this.entries.push(chunk.entry);
    }
    this.pending = [];
    this.pendingBytes = 0;
    this.hold = 0;
  }

  async #write({ entry, ids, notation }) {
    const directory = chunkDirectory(this.context, entry.sha256);
    const path = chunkFile(this.context, entry.sha256);
    // A committed chunk was written and projected by the save that indexed
    // it; reads ensure its projection.
    if (
      this.committed.has(entry.sha256) &&
      digest(await readOrEmpty(path)) === entry.sha256
    ) {
      return;
    }
    // `mkdir` returns undefined when the chunk exists; a retry reuses it.
    if (await mkdir(directory, { mode: 0o700, recursive: true })) {
      this.created.push(entry.sha256);
    }
    await durableWrite(path, notation);
    await durableWrite(
      join(directory, IDS_FILE),
      `${JSON.stringify({ ids, sha256: entry.sha256 })}\n`
    );
    const staged = await this.context.mirror?.stage?.({
      directory,
      kind: this.context.collection,
      notation,
      reuse: this.reuse,
    });
    await staged?.activate();
  }

  // Returns the written chunk entries, or undefined when every record fit
  // within the held bytes and none was written.
  async finish() {
    await this.#flush();
    if (this.pending.length && !this.entries.length) {
      return undefined;
    }
    await this.#writePending();
    return this.entries;
  }
}

function budgetError(collection) {
  const error = new Error(
    `The ${collection} collection exceeds its storage budget.`
  );
  error.code = 'record-budget-exhausted';
  return error;
}

// Projections of committed chunks, and of a single-file collection that
// becomes chunked, hold most sub-shards of a chunk that changed.
function reusableRoots(context, committed) {
  const shards = `${context.collection}.shards`;
  return [
    ...[...committed].map((sha256) =>
      join(chunkDirectory(context, sha256), '.binary', shards)
    ),
    join(context.directory, '.binary', shards),
  ];
}

async function commitIndex(context, chunks) {
  const paths = recordChunkPaths(context.directory, context.collection);
  const index = {
    bytes: chunks.reduce((sum, { bytes }) => sum + bytes, 0),
    chunks,
    count: chunks.reduce((sum, { count }) => sum + count, 0),
    kind: context.collection,
    version: 1,
  };
  await mkdir(paths.chunks, { mode: 0o700, recursive: true });
  await markIndexedSchema(context.directory);
  await durableWrite(paths.index, `${JSON.stringify(index)}\n`);
  return index;
}

async function transaction(context, write) {
  const { chunks: chunksPath } = recordChunkPaths(
    context.directory,
    context.collection
  );
  const created = [];
  let index;
  try {
    index = await write(created);
  } catch (error) {
    // A failed save removes the chunks it created before any index used them.
    await removeChunks(created, chunksPath, context.removeChunk || rm);
    throw error;
  }
  // The new index is durable; stale chunks are safe to prune.
  await pruneChunks(
    chunksPath,
    new Set(index.chunks.map(({ sha256 }) => sha256)),
    context.removeChunk || rm
  );
  return index;
}

async function existingChunks(context) {
  const paths = recordChunkPaths(context.directory, context.collection);
  const existing = await readOrEmpty(paths.index);
  const committed = committedChunks(existing, 'chunks');
  if (committed) {
    // An interrupted earlier save may have left unindexed chunks.
    await pruneChunks(paths.chunks, committed, context.removeChunk || rm);
  }
  return { committed: committed || new Set(), existing };
}

// Writes a whole collection. Without an index, a collection that fits one
// chunk is handed to `writeSingle` as one file, which the parse bound limits;
// otherwise it is written as chunks within `maxBytes` and an index that is
// replaced last.
export async function writeRecordCollection(
  context,
  records,
  { maxBytes, writeSingle }
) {
  const { committed, existing } = await existingChunks(context);
  const writer = new ChunkWriter(context, {
    committed,
    hold: !existing && writeSingle ? context.maxChunkBytes : 0,
    reuse: reusableRoots(context, committed),
  });
  return transaction(context, async (created) => {
    try {
      for await (const record of records) {
        await writer.add(record);
      }
      const chunks = await writer.finish();
      if (!chunks) {
        await writeSingle();
        return { chunks: [] };
      }
      if (writer.totalBytes > maxBytes) {
        throw budgetError(context.collection);
      }
      return await commitIndex(context, chunks);
    } finally {
      created.push(...writer.created);
    }
  });
}

// Keeps the `Map` semantics of an id-keyed merge: a replaced record keeps
// its position, and `replace: false` keeps the first record with an id.
export function mergeRecords(existing, incoming, replace) {
  const byId = new Map(existing.map((record) => [record.id, record]));
  for (const record of incoming) {
    if (replace || !byId.has(record.id)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()];
}

// Drops the oldest records until the collection fits the record and byte
// budgets.
export function retainNewest(kind, records, { maxBytes, maxRecords }) {
  let retained = records.slice(-maxRecords);
  let bytes = Buffer.byteLength(formatSchemaHeader(kind));
  const sizes = retained.map(
    (record, index) => Buffer.byteLength(formatRecord(kind, record, index)) + 1
  );
  bytes += sizes.reduce((sum, size) => sum + size, 0);
  let drop = 0;
  while (drop < sizes.length && bytes > maxBytes) {
    bytes -= sizes[drop];
    drop += 1;
  }
  retained = retained.slice(drop);
  return retained;
}

async function rewriteChunk(context, chunk, writer, transform) {
  const records = transform(await chunkRecords(context, chunk));
  for (const record of records) {
    await writer.add(record);
  }
}

function newWriter(context, committed) {
  return new ChunkWriter(context, {
    committed,
    reuse: reusableRoots(context, committed),
  });
}

async function writeWith(context, committed, created, produce) {
  const writer = newWriter(context, committed);
  try {
    await produce(writer);
    return await writer.finish();
  } finally {
    created.push(...writer.created);
  }
}

// Evicts from the head: whole chunks while they fit within the excess, then
// the oldest records of the first remaining chunk.
async function evictHead(context, chunks, budget, write) {
  for (;;) {
    const count = chunks.reduce((sum, chunk) => sum + chunk.count, 0);
    const bytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    const excessCount = count - budget.maxRecords;
    const excessBytes = bytes - budget.maxBytes;
    if (excessCount <= 0 && excessBytes <= 0) {
      return chunks;
    }
    const [head] = chunks;
    if (head.count <= excessCount || head.bytes <= excessBytes) {
      chunks.shift();
      continue;
    }
    const replaced = await write((writer) =>
      rewriteChunk(context, head, writer, (records) => {
        let drop = Math.max(1, excessCount);
        let freed = 0;
        for (const [index, record] of records.entries()) {
          if (index >= drop && freed >= excessBytes) {
            break;
          }
          freed +=
            Buffer.byteLength(formatRecord(context.kind, record, index)) + 1;
          drop = Math.max(drop, index + 1);
        }
        return records.slice(drop);
      })
    );
    chunks.splice(0, 1, ...replaced);
  }
}

async function locateIds(context, index) {
  const located = new Map();
  for (const [position, chunk] of index.chunks.entries()) {
    for (const id of await chunkIds(context, chunk)) {
      if (id !== null && !located.has(id)) {
        located.set(id, position);
      }
    }
  }
  return located;
}

function planAppend(located, incoming, replace) {
  const dirty = new Map();
  const added = new Map();
  for (const record of incoming) {
    const position = located.get(record.id);
    if (position === undefined) {
      if (replace || !added.has(record.id)) {
        added.set(record.id, record);
      }
    } else if (replace) {
      const changes = dirty.get(position) || new Map();
      changes.set(record.id, record);
      dirty.set(position, changes);
    }
  }
  return { added: [...added.values()], dirty };
}

// Appends to an indexed collection, touching only the chunks that hold a
// replaced id, the tail chunk that new records extend, and the head chunks
// that eviction drops.
export async function appendIndexedRecords(context, incoming, options) {
  const { committed } = await existingChunks(context);
  const index = await readRecordIndex(context.directory, context.collection);
  const { added, dirty } = planAppend(
    await locateIds(context, index),
    incoming,
    options.replace
  );
  return transaction(context, async (created) => {
    const write = (produce) => writeWith(context, committed, created, produce);
    const groups = [];
    for (const [position, chunk] of index.chunks.entries()) {
      const changes = dirty.get(position);
      groups.push(
        changes
          ? await write((writer) =>
              rewriteChunk(context, chunk, writer, (records) =>
                records.map((record) => changes.get(record.id) ?? record)
              )
            )
          : [chunk]
      );
    }
    let chunks = groups.flat();
    if (added.length) {
      const maxChunkBytes = Math.min(context.maxChunkBytes, maxNotationBytes());
      const tail = chunks.at(-1);
      const reopen = tail && tail.bytes < maxChunkBytes / 2;
      if (reopen) {
        chunks.pop();
      }
      chunks.push(
        ...(await write(async (writer) => {
          if (reopen) {
            await rewriteChunk(context, tail, writer, (records) => records);
          }
          for (const record of added) {
            await writer.add(record);
          }
        }))
      );
    }
    const before = chunks.reduce((sum, chunk) => sum + chunk.count, 0);
    chunks = await evictHead(context, chunks, options, write);
    const result = await commitIndex(context, chunks);
    return { ...result, dropped: before - result.count };
  });
}
