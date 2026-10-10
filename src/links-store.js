import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Link, formatLinks } from 'links-notation';

import {
  LinkCliMirror,
  durableWrite,
  parseNotation,
} from './link-cli-mirror.js';
import {
  DEFAULT_OFFER_SHARD_BYTES,
  orderOffersByRecency,
  readOfferCollection,
  writeOfferCollection,
} from './offer-chunks.js';
import { boundStoredOffer } from './offer-bounds.js';
import {
  DEFAULT_RECORD_CHUNK_BYTES,
  appendIndexedRecords,
  maxNotationBytes,
  mergeRecords,
  oversizedSingleFile,
  queryIndexedRecords,
  readIndexedRecords,
  readRecordIndex,
  retainNewest,
  streamSingleFileRecords,
  writeRecordCollection,
} from './record-chunks.js';
import { deduplicateOffers, removeOfferMessageVariants } from './offers.js';

function decodeJson(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new globalThis.TextDecoder().decode(bytes));
}

function pointerSegment(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function pointerParts(path) {
  return path
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function scalar(value) {
  if (value === null) {
    return 'value:null';
  }
  if (typeof value === 'string') {
    return `value:string:${value}`;
  }
  if (typeof value === 'number') {
    return `value:number:${value}`;
  }
  if (typeof value === 'boolean') {
    return `value:boolean:${value}`;
  }
  if (Array.isArray(value)) {
    return 'value:array';
  }
  return 'value:object';
}

function scalarValue(id) {
  if (id === 'value:null') {
    return null;
  }
  if (id === 'value:array') {
    return [];
  }
  if (id === 'value:object') {
    return {};
  }
  if (id.startsWith('value:string:')) {
    return id.slice(13);
  }
  if (id.startsWith('value:number:')) {
    return Number(id.slice(13));
  }
  if (id.startsWith('value:boolean:')) {
    return id.slice(14) === 'true';
  }
  throw new Error(`Unknown associative value type: ${id}`);
}

function normalized(value) {
  return JSON.parse(JSON.stringify(value));
}

function* flatten(value, path = '') {
  yield [path, scalar(value)];
  if (value && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [index, item])
      : Object.entries(value).sort(([left], [right]) =>
          left.localeCompare(right)
        );
    for (const [key, child] of entries) {
      yield* flatten(child, `${path}/${pointerSegment(key)}`);
    }
  }
}

function assignPath(root, path, value) {
  const parts = pointerParts(path);
  let target = root;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      target[part] = value;
    } else {
      target = target[part];
    }
  }
}

// The record its serialized text reads back as: the same flattened fields
// assigned in the same order, without formatting or parsing any text.
export function readBackRecord(input) {
  let root;
  for (const [path, value] of flatten(normalized(input))) {
    if (path) {
      assignPath(root, path, scalarValue(value));
    } else {
      root = scalarValue(value);
    }
  }
  return root;
}

export const RECORDS_SCHEMA = 'schema:associative-records-v3';
const SCHEMA_V2 = 'schema:associative-records-v2';

// clink 0.2.x trims every line of an imported document and every name,
// including a trailing colon, and links-notation cannot round-trip a name that
// contains both quote kinds (#55). Schema v3 therefore percent-encodes, as
// UTF-8, each character one of those steps could rewrite: the escape itself,
// quotes, backslashes, all whitespace except a single interior space, control
// characters, and a trailing colon. Other text, including non-Latin scripts,
// stays readable.
const UNSAFE_NAME = /[%'"`\\]|[^\S ]|\p{Cc}|^ | $| (?= )|:$/gu;

function percentEncode(character) {
  return [...new globalThis.TextEncoder().encode(character)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('');
}

export function encodeName(name) {
  return name.replace(UNSAFE_NAME, percentEncode);
}

export function decodeName(name) {
  return name.includes('%') ? decodeURIComponent(name) : name;
}

function decodeLink(link) {
  return {
    id: decodeName(link.id),
    values: (link.values || []).map(decodeLink),
  };
}

function nameLink(name, values) {
  return values
    ? new Link(encodeName(name), values)
    : new Link(encodeName(name));
}

function legacyRecords(kind, links) {
  return links
    .filter((link) => link.id === kind)
    .map((link) => link.values.find((value) => value.id === 'data'))
    .filter((data) => data?.values?.[0]?.id)
    .map((data) => decodeJson(data.values[0].id));
}

function schemaHeader(kind) {
  return nameLink(kind, [nameLink(RECORDS_SCHEMA), nameLink(`kind:${kind}`)]);
}

function* recordLinks(kind, input, index) {
  const record = normalized(input);
  const id = record.id ?? String(index);
  const reference = `record:${kind}:${id}`;
  yield nameLink(reference, [nameLink(`kind:${kind}`), nameLink(scalar(id))]);
  for (const [path, value] of flatten(record)) {
    const field = `${reference}:field:${path || '/'}`;
    const valueNode = `${field}:value`;
    yield nameLink(field, [nameLink(reference), nameLink(valueNode)]);
    yield nameLink(valueNode, [nameLink(valueNode), nameLink(value)]);
  }
}

// The schema header and each record format to whole lines, so a collection
// can be written in chunks that each equal `serializeRecords` of their part.
export function formatSchemaHeader(kind) {
  return formatLinks([schemaHeader(kind)]);
}

export function formatRecord(kind, record, index) {
  return formatLinks([...recordLinks(kind, record, index)]);
}

export function serializeRecords(kind, records) {
  if (!records.length) {
    return '';
  }
  const links = [schemaHeader(kind)];
  for (const [index, input] of records.entries()) {
    for (const link of recordLinks(kind, input, index)) {
      links.push(link);
    }
  }
  return formatLinks(links);
}

// Format one record link at a time so the offer limit is checked before a
// large document or even a large link list can be materialized.
export function serializeOfferBounded(offer, maxBytes) {
  const lines = [];
  let bytes = 0;
  const append = (link) => {
    const rawCharacters =
      link.id.length +
      link.values.reduce((sum, value) => sum + value.id.length, 0);
    if (rawCharacters > maxBytes) {
      const error = new Error(
        'One offer exceeds the maximum canonical LiNo shard size.'
      );
      error.code = 'offer-shard-too-large';
      throw error;
    }
    const line = formatLinks([link]);
    bytes += Buffer.byteLength(line) + Number(lines.length > 0);
    if (bytes > maxBytes) {
      const error = new Error(
        'One offer exceeds the maximum canonical LiNo shard size.'
      );
      error.code = 'offer-shard-too-large';
      throw error;
    }
    lines.push(line);
  };
  append(schemaHeader('offer'));
  for (const link of recordLinks('offer', offer, 0)) {
    append(link);
  }
  return lines.join('\n');
}

// True when the text already uses the current schema. The schema header is
// always the first link, so this avoids parsing a whole large collection.
export function isCurrentSchema(kind, notation) {
  const end = notation.indexOf('\n');
  const first = end === -1 ? notation : notation.slice(0, end);
  return first === formatSchemaHeader(kind);
}

function parseRecordLinks(notation) {
  const links = parseNotation(notation);
  return links.some((link) => link.values[0]?.id === RECORDS_SCHEMA)
    ? links.map(decodeLink)
    : links;
}

// Index links once so decoding stays linear in the collection size instead
// of scanning every link for each record and field.
function indexLinks(links) {
  const byId = new Map();
  const byOwner = new Map();
  for (const link of links) {
    if (!byId.has(link.id)) {
      byId.set(link.id, link);
    }
    const owner = link.values[0]?.id;
    if (!byOwner.has(owner)) {
      byOwner.set(owner, []);
    }
    byOwner.get(owner).push(link);
  }
  return { byId, byOwner };
}

function deserializeAssociativeV1(headers, { byOwner }) {
  return headers.map((header) => {
    const reference = header.values[0].id;
    const fields = (byOwner.get(reference) || []).filter((link) =>
      link.id.startsWith('field:')
    );
    const root = scalarValue(
      fields.find((link) => link.id === 'field:/').values[1].id
    );
    for (const field of fields.filter((link) => link.id !== 'field:/')) {
      assignPath(root, field.id.slice(6), scalarValue(field.values[1].id));
    }
    return root;
  });
}

export function deserializeRecords(kind, notation = '') {
  if (!notation.trim()) {
    return [];
  }
  return recordsFromLinks(kind, parseRecordLinks(notation));
}

// Decodes the links of current-schema records parsed one link at a time.
export function recordsFromSchemaLinks(kind, links) {
  return recordsFromLinks(kind, links.map(decodeLink));
}

function recordsFromLinks(kind, links) {
  const legacyHeaders = links.filter((link) => link.id === kind);
  if (
    legacyHeaders.some((link) => link.values.some(({ id }) => id === 'data'))
  ) {
    return legacyRecords(kind, links);
  }
  const headers = links.filter(
    (link) =>
      link.id.startsWith(`record:${kind}:`) &&
      link.values[0]?.id === `kind:${kind}`
  );
  if (
    !headers.length &&
    legacyHeaders.some(
      (header) => ![SCHEMA_V2, RECORDS_SCHEMA].includes(header.values[0]?.id)
    )
  ) {
    return deserializeAssociativeV1(legacyHeaders, indexLinks(links));
  }
  const { byId, byOwner } = indexLinks(links);
  return headers.map((header) => {
    const reference = header.id;
    const prefix = `${reference}:field:`;
    const fields = (byOwner.get(reference) || []).filter((link) =>
      link.id.startsWith(prefix)
    );
    const valueOf = (field) =>
      scalarValue(byId.get(field.values[1].id).values[1].id);
    const rootField = fields.find((link) => link.id === `${prefix}/`);
    const root = valueOf(rootField);
    for (const field of fields.filter((link) => link !== rootField)) {
      assignPath(root, field.id.slice(prefix.length), valueOf(field));
    }
    return root;
  });
}

export function queryRecords(kind, notation, { path, value }) {
  if (!notation.trim()) {
    return [];
  }
  const links = parseRecordLinks(notation);
  const { byId } = indexLinks(links);
  const suffix = `:field:/${path.split('/').map(pointerSegment).join('/')}`;
  const expected = scalar(value);
  const references = new Set(
    links
      .filter((link) => link.id.endsWith(suffix))
      .filter(
        (field) => byId.get(field.values[1]?.id)?.values[1]?.id === expected
      )
      .map((field) => field.values[0]?.id)
  );
  const identifiers = new Set(
    [...references].map((reference) =>
      reference.slice(`record:${kind}:`.length)
    )
  );
  return recordsFromLinks(kind, links).filter((record) =>
    identifiers.has(String(record.id))
  );
}

export const serializeOffers = (offers) => serializeRecords('offer', offers);
export const deserializeOffers = (notation) =>
  deserializeRecords('offer', notation);
export const serializeSources = (sources) =>
  serializeRecords('source', sources);
export const deserializeSources = (notation) =>
  deserializeRecords('source', notation);
export const serializeSearchState = (state) =>
  serializeRecords('search-state', [{ id: 'telegram', ...state }]);
export const deserializeSearchState = (notation) =>
  deserializeRecords('search-state', notation)[0] || { users: {} };

async function readOrEmpty(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function singular(kind) {
  return kind.endsWith('ies')
    ? `${kind.slice(0, -3)}y`
    : kind.endsWith('s')
      ? kind.slice(0, -1)
      : kind;
}

export function validKind(kind) {
  if (!/^[a-z][a-z\d-]*s$/u.test(kind)) {
    throw new Error(`Invalid record collection: ${kind}`);
  }
  return kind;
}

export async function staleLock(path, statPath = stat) {
  let owner;
  try {
    owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      try {
        return Date.now() - (await statPath(path)).mtimeMs >= 1000;
      } catch (statError) {
        if (statError.code === 'ENOENT') {
          return false;
        }
        throw statError;
      }
    }
    throw error;
  }
  if (!Number.isInteger(owner.pid) || owner.pid < 1) {
    return true;
  }
  try {
    globalThis.process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

export class LinksStore {
  // Offers of the offer files this store last read or wrote, by exact text.
  #parsedOffers = new Map();

  // The text and records of each single-file record collection this store
  // last read or wrote, so an append does not parse what the last one wrote.
  #parsedRecords = new Map();

  constructor({
    binaryMirror = false,
    directory = '.vietnam-accomodation-search',
    historyDays = 90,
    maxBytes = 10 * 1024 ** 3,
    maxOfferShardBytes = DEFAULT_OFFER_SHARD_BYTES,
    maxRecordChunkBytes = DEFAULT_RECORD_CHUNK_BYTES,
    mirror,
  } = {}) {
    this.directory = directory;
    this.historyDays = historyDays;
    this.offersPath = join(directory, 'offers.lino');
    this.searchStatePath = join(directory, 'search-state.lino');
    this.sourcesPath = join(directory, 'sources.lino');
    this.maxBytes = maxBytes;
    this.maxOfferShardBytes = maxOfferShardBytes;
    this.maxRecordChunkBytes = maxRecordChunkBytes;
    this.mirror = mirror || (binaryMirror ? new LinkCliMirror() : undefined);
    this.pending = Promise.resolve();
  }

  pathFor(kind) {
    const collection = validKind(kind);
    if (collection === 'offers') {
      return this.offersPath;
    }
    if (collection === 'sources') {
      return this.sourcesPath;
    }
    return join(this.directory, `${collection}.lino`);
  }

  // Reads canonical text and ensures its binary projection. Text written by an
  // earlier schema may hold names clink rewrites on import (#55), so with the
  // mirror enabled it is first rewritten as schema v3 under the write lock.
  async #readNotation(collection, path = this.pathFor(collection)) {
    const kind =
      collection === 'search-state' ? collection : singular(collection);
    const notation = await readOrEmpty(path);
    if (this.mirror && notation.trim() && !isCurrentSchema(kind, notation)) {
      const migrated = serializeRecords(
        kind,
        deserializeRecords(kind, notation)
      );
      await this.#commit(collection, path, migrated);
      return migrated;
    }
    await this.mirror?.ensure?.({
      directory: this.directory,
      kind: collection,
      notation,
    });
    return notation;
  }

  #loadNotation(collection, path) {
    const load = () => this.#readNotation(collection, path);
    return this.mirror ? this.#locked(load) : load();
  }

  #chunkContext(collection) {
    return {
      collection,
      directory: this.directory,
      kind: singular(collection),
      maxChunkBytes: this.maxRecordChunkBytes,
      mirror: this.mirror,
    };
  }

  // The index of a chunked collection. A single file too large to parse as
  // one text is first rewritten as chunks, one record at a time; `locked`
  // tells whether the caller already holds the write lock.
  async #indexFor(collection, locked) {
    const path = this.pathFor(collection);
    const index = await readRecordIndex(this.directory, collection);
    if (index || !(await oversizedSingleFile(path))) {
      return index;
    }
    const migrate = async () =>
      (await readRecordIndex(this.directory, collection)) ||
      writeRecordCollection(
        this.#chunkContext(collection),
        streamSingleFileRecords(path, singular(collection)),
        { maxBytes: this.maxBytes }
      );
    return locked ? migrate() : this.#locked(migrate);
  }

  #readRecords(collection, readIndexed, readSingle) {
    const load = async () => {
      const index = await this.#indexFor(collection, Boolean(this.mirror));
      return index
        ? readIndexed(this.#chunkContext(collection), index)
        : readSingle(await this.#readNotation(collection));
    };
    return this.mirror ? this.#locked(load) : load();
  }

  async #commit(collection, path, notation) {
    if (notation.length > maxNotationBytes()) {
      const error = new Error(
        `The ${collection} text exceeds the canonical single-file bound.`
      );
      error.code = 'notation-too-large';
      throw error;
    }
    const staged = this.mirror
      ? await this.mirror.stage({
          directory: this.directory,
          kind: collection,
          notation,
        })
      : undefined;
    await durableWrite(path, notation);
    await staged?.activate();
  }

  async loadRecords(kind) {
    const collection = validKind(kind);
    if (collection === 'offers') {
      return this.listOffers();
    }
    return await this.#readRecords(collection, readIndexedRecords, (notation) =>
      this.#recordsOf(collection, notation)
    );
  }

  #recordsOf(collection, notation) {
    const known = this.#parsedRecords.get(collection);
    if (known?.notation === notation) {
      return globalThis.structuredClone(known.records);
    }
    const records = deserializeRecords(singular(collection), notation);
    this.#parsedRecords.set(collection, {
      notation,
      records: globalThis.structuredClone(records),
    });
    return records;
  }

  // Text holding two records with one id reads back as merged records, so
  // only text with distinct ids is remembered without parsing it.
  #rememberRecords(collection, notation, records) {
    const ids = records.map(
      (record, index) => `${normalized(record).id ?? index}`
    );
    if (new Set(ids).size === ids.length) {
      this.#parsedRecords.set(collection, {
        notation,
        records: records.map(readBackRecord),
      });
    }
  }

  async queryRecords(kind, query) {
    const collection = validKind(kind);
    if (collection === 'offers') {
      const segments = query.path.split('/');
      return (await this.listOffers()).filter((offer) => {
        let value = offer;
        for (const segment of segments) {
          value = value?.[segment];
        }
        return value !== undefined && scalar(value) === scalar(query.value);
      });
    }
    return this.#readRecords(
      collection,
      (context, index) => queryIndexedRecords(context, index, query),
      (notation) => queryRecords(singular(collection), notation, query)
    );
  }

  #locked(task) {
    const run = async () => {
      await mkdir(this.directory, { recursive: true });
      const lock = join(this.directory, '.write.lock');
      let acquired = false;
      for (let attempt = 0; attempt < 200 && !acquired; attempt += 1) {
        try {
          await mkdir(lock);
          await writeFile(
            join(lock, 'owner.json'),
            `${JSON.stringify({ createdAt: new Date().toISOString(), pid: globalThis.process.pid })}\n`,
            { flag: 'wx', mode: 0o600 }
          );
          acquired = true;
        } catch (error) {
          if (error.code !== 'EEXIST') {
            throw error;
          }
          if (await staleLock(lock)) {
            await rm(lock, { force: true, recursive: true });
            continue;
          }
          await delay(10);
        }
      }
      if (!acquired) {
        throw new Error('Timed out acquiring the storage write lock');
      }
      try {
        return await task();
      } finally {
        await rm(lock, { force: true, recursive: true });
      }
    };
    const operation = this.pending.then(run, run);
    this.pending = operation.catch(() => {});
    return operation;
  }

  saveRecords(kind, records) {
    const collection = validKind(kind);
    return this.#locked(() => this.#saveRecords(collection, records));
  }

  updateRecords(kind, update) {
    const collection = validKind(kind);
    if (typeof update !== 'function') {
      throw new TypeError('A record update function is required.');
    }
    return this.#locked(async () => {
      const current =
        collection === 'offers'
          ? (await this.#readOffers()).offers
          : await this.#currentRecords(collection);
      const next = await update(current);
      if (!Array.isArray(next)) {
        throw new TypeError('A record update must return an array.');
      }
      await this.#saveRecords(collection, next);
      return next;
    });
  }

  // Reads a collection for a rewrite under the write lock; projections are
  // rebuilt by the write, so they are not ensured here.
  async #currentRecords(collection) {
    const index = await this.#indexFor(collection, true);
    return index
      ? readIndexedRecords(this.#chunkContext(collection), index, false)
      : this.#recordsOf(
          collection,
          await readOrEmpty(this.pathFor(collection))
        );
  }

  #saveRecords(collection, records, maxBytes = this.maxBytes) {
    if (collection === 'offers') {
      return this.#saveOffers(records);
    }
    return writeRecordCollection(this.#chunkContext(collection), records, {
      maxBytes,
      writeSingle: async () => {
        const notation = serializeRecords(singular(collection), records);
        await this.#commit(collection, this.pathFor(collection), notation);
        this.#rememberRecords(collection, notation, records);
      },
    });
  }

  // Merges records by id into an append-only collection and evicts its oldest
  // records past `maxRecords` or `maxBytes`. A chunked collection rewrites
  // only the chunks that hold a replaced id, its tail, and evicted head
  // chunks. `replace: false` keeps the stored record for a known id.
  appendRecords(
    kind,
    records,
    { maxBytes = this.maxBytes, maxRecords = Infinity, replace = true } = {}
  ) {
    const collection = validKind(kind);
    if (collection === 'offers') {
      throw new TypeError('Offers are merged with saveOffers.');
    }
    if (
      !Array.isArray(records) ||
      records.some((record) => record?.id === undefined || record.id === null)
    ) {
      throw new TypeError('Appended records require an id.');
    }
    if (
      !(
        maxRecords === Infinity ||
        (Number.isSafeInteger(maxRecords) && maxRecords > 0)
      ) ||
      !(maxBytes > 0)
    ) {
      throw new TypeError('Append budgets must be positive.');
    }
    const budget = {
      maxBytes: Math.min(maxBytes, this.maxBytes),
      maxRecords,
      replace,
    };
    return this.#locked(async () => {
      if (!records.length) {
        return;
      }
      const index = await this.#indexFor(collection, true);
      if (index) {
        const result = await appendIndexedRecords(
          this.#chunkContext(collection),
          records.map(normalized),
          budget
        );
        return { dropped: result.dropped, retained: result.count };
      }
      const merged = mergeRecords(
        await this.#currentRecords(collection),
        records.map(normalized),
        replace
      );
      const next = retainNewest(singular(collection), merged, budget);
      await this.#saveRecords(collection, next, budget.maxBytes);
      return { dropped: merged.length - next.length, retained: next.length };
    });
  }

  // Offers written before #82 may hold provider media objects and their
  // bytes. Every read returns the bounded shape, and every write persists
  // only the bounded shape.
  async #readOffers(mirror) {
    const stored = await readOfferCollection({
      directory: this.directory,
      mirror,
      offersPath: this.offersPath,
      parsed: this.#parsedOffers,
    });
    const offers = stored.map(boundStoredOffer);
    const migrated = offers.filter((offer, index) => offer !== stored[index]);
    return { migrated: migrated.length, offers };
  }

  listOffers() {
    const load = async () => {
      const { migrated, offers } = await this.#readOffers(this.mirror);
      if (migrated && this.mirror) {
        await this.#saveOffers(offers);
      }
      return offers;
    };
    return this.mirror ? this.#locked(load) : load();
  }

  // Rewrites oversized stored offers to the bounded shape under the write
  // lock and returns the number of rewritten offers.
  migrateOffers() {
    return this.#locked(async () => {
      const { migrated, offers } = await this.#readOffers(this.mirror);
      if (migrated) {
        await this.#saveOffers(offers);
      }
      return migrated;
    });
  }

  #saveOffers(offers) {
    return writeOfferCollection({
      directory: this.directory,
      historyDays: this.historyDays,
      maxBytes: this.maxBytes,
      maxShardBytes: this.maxOfferShardBytes,
      mirror: this.mirror,
      offers,
      offersPath: this.offersPath,
      parsed: this.#parsedOffers,
    });
  }

  saveOffers(incoming) {
    return this.#locked(async () => {
      const offers = orderOffersByRecency(
        deduplicateOffers([
          ...(await this.#readOffers()).offers,
          ...incoming.map(boundStoredOffer),
        ])
      );
      await this.#saveOffers(offers);
    });
  }

  deleteOffersByMessages(sourceId, messageIds) {
    const identifiers = new Set(messageIds.map(String));
    return this.#locked(async () => {
      const { migrated, offers } = await this.#readOffers();
      let changed = migrated > 0;
      const remaining = offers
        .map((offer) => {
          const result = removeOfferMessageVariants(
            offer,
            sourceId,
            identifiers
          );
          changed ||= result !== offer;
          return result;
        })
        .filter(Boolean);
      if (!changed) {
        return;
      }
      await this.#saveOffers(remaining);
    });
  }

  loadSources() {
    return this.loadRecords('sources');
  }

  saveSources(sources) {
    return this.saveRecords('sources', sources);
  }

  async loadSearchState() {
    return deserializeSearchState(
      await this.#loadNotation('search-state', this.searchStatePath)
    );
  }

  saveSearchState(state) {
    return this.#locked(() =>
      this.#commit(
        'search-state',
        this.searchStatePath,
        serializeSearchState(state)
      )
    );
  }
}
