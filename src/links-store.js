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
  return first === formatLinks([schemaHeader(kind)]);
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

function validKind(kind) {
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
  constructor({
    binaryMirror = false,
    directory = '.vietnam-accomodation-search',
    maxBytes = 10 * 1024 ** 3,
    maxOfferShardBytes = DEFAULT_OFFER_SHARD_BYTES,
    mirror,
  } = {}) {
    this.directory = directory;
    this.offersPath = join(directory, 'offers.lino');
    this.searchStatePath = join(directory, 'search-state.lino');
    this.sourcesPath = join(directory, 'sources.lino');
    this.maxBytes = maxBytes;
    this.maxOfferShardBytes = maxOfferShardBytes;
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
  #loadNotation(collection, path = this.pathFor(collection)) {
    const kind =
      collection === 'search-state' ? collection : singular(collection);
    const load = async () => {
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
    };
    return this.mirror ? this.#locked(load) : load();
  }

  async #commit(collection, path, notation) {
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
    const notation = await this.#loadNotation(collection);
    return deserializeRecords(singular(collection), notation);
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
    return queryRecords(
      singular(collection),
      await this.#loadNotation(collection),
      query
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
          : deserializeRecords(
              singular(collection),
              await readOrEmpty(this.pathFor(collection))
            );
      const next = await update(current);
      if (!Array.isArray(next)) {
        throw new TypeError('A record update must return an array.');
      }
      await this.#saveRecords(collection, next);
      return next;
    });
  }

  #saveRecords(collection, records) {
    if (collection === 'offers') {
      return this.#saveOffers(records);
    }
    return this.#commit(
      collection,
      this.pathFor(collection),
      serializeRecords(singular(collection), records)
    );
  }

  // Offers written before #82 may hold provider media objects and their
  // bytes. Every read returns the bounded shape; writes persist it.
  async #readOffers(mirror) {
    const stored = await readOfferCollection({
      directory: this.directory,
      mirror,
      offersPath: this.offersPath,
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
      maxBytes: this.maxBytes,
      maxShardBytes: this.maxOfferShardBytes,
      mirror: this.mirror,
      offers,
      offersPath: this.offersPath,
    });
  }

  saveOffers(incoming) {
    return this.#locked(async () => {
      const offers = orderOffersByRecency(
        deduplicateOffers([...(await this.#readOffers()).offers, ...incoming])
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

  async loadSources() {
    const notation = await this.#loadNotation('sources');
    return deserializeSources(notation);
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
