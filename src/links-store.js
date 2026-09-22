import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Link, Parser, formatLinks } from 'links-notation';

import { LinkCliMirror, durableWrite } from './link-cli-mirror.js';
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

function flatten(value, path = '', output = []) {
  output.push([path, scalar(value)]);
  if (value && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [index, item])
      : Object.entries(value).sort(([left], [right]) =>
          left.localeCompare(right)
        );
    for (const [key, child] of entries) {
      flatten(child, `${path}/${pointerSegment(key)}`, output);
    }
  }
  return output;
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

function legacyRecords(kind, links) {
  return links
    .filter((link) => link.id === kind)
    .map((link) => link.values.find((value) => value.id === 'data'))
    .filter((data) => data?.values?.[0]?.id)
    .map((data) => decodeJson(data.values[0].id));
}

export function serializeRecords(kind, records) {
  if (!records.length) {
    return '';
  }
  const links = [
    new Link(kind, [
      new Link('schema:associative-records-v2'),
      new Link(`kind:${kind}`),
    ]),
  ];
  for (const [index, input] of records.entries()) {
    const record = normalized(input);
    const id = record.id ?? String(index);
    const reference = `record:${kind}:${id}`;
    links.push(
      new Link(reference, [new Link(`kind:${kind}`), new Link(scalar(id))])
    );
    for (const [path, value] of flatten(record)) {
      const field = `${reference}:field:${path || '/'}`;
      const valueNode = `${field}:value`;
      links.push(
        new Link(field, [new Link(reference), new Link(valueNode)]),
        new Link(valueNode, [new Link(valueNode), new Link(value)])
      );
    }
  }
  return formatLinks(links);
}

function deserializeAssociativeV1(headers, links) {
  return headers.map((header) => {
    const reference = header.values[0].id;
    const fields = links.filter(
      (link) => link.id.startsWith('field:') && link.values[0]?.id === reference
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
  const links = new Parser().parse(notation);
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
      (header) => header.values[0]?.id !== 'schema:associative-records-v2'
    )
  ) {
    return deserializeAssociativeV1(legacyHeaders, links);
  }
  return headers.map((header) => {
    const reference = header.id;
    const prefix = `${reference}:field:`;
    const fields = links.filter(
      (link) => link.id.startsWith(prefix) && link.values[0]?.id === reference
    );
    const valueOf = (field) => {
      const valueNode = field.values[1].id;
      const definition = links.find((link) => link.id === valueNode);
      return scalarValue(definition.values[1].id);
    };
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
  const links = new Parser().parse(notation);
  const suffix = `:field:/${path.split('/').map(pointerSegment).join('/')}`;
  const expected = scalar(value);
  const references = new Set(
    links
      .filter((link) => link.id.endsWith(suffix))
      .filter((field) => {
        const definition = links.find(
          (candidate) => candidate.id === field.values[1]?.id
        );
        return definition?.values[1]?.id === expected;
      })
      .map((field) => field.values[0]?.id)
  );
  const identifiers = new Set(
    [...references].map((reference) =>
      reference.slice(`record:${kind}:`.length)
    )
  );
  return deserializeRecords(kind, notation).filter((record) =>
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

async function staleLock(path) {
  let owner;
  try {
    owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      try {
        return Date.now() - (await stat(path)).mtimeMs >= 1000;
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
    mirror,
  } = {}) {
    this.directory = directory;
    this.offersPath = join(directory, 'offers.lino');
    this.searchStatePath = join(directory, 'search-state.lino');
    this.sourcesPath = join(directory, 'sources.lino');
    this.maxBytes = maxBytes;
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

  #loadNotation(collection) {
    const load = async () => {
      const notation = await readOrEmpty(this.pathFor(collection));
      await this.mirror?.ensure?.({
        directory: this.directory,
        kind: collection,
        notation,
      });
      return notation;
    };
    return this.mirror ? this.#locked(load) : load();
  }

  async loadRecords(kind) {
    const collection = validKind(kind);
    const notation = await this.#loadNotation(collection);
    return deserializeRecords(singular(collection), notation);
  }

  async queryRecords(kind, query) {
    const collection = validKind(kind);
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
      const current = deserializeRecords(
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

  async #saveRecords(collection, records) {
    const notation = serializeRecords(singular(collection), records);
    const staged = this.mirror
      ? await this.mirror.stage({
          directory: this.directory,
          kind: collection,
          notation,
        })
      : undefined;
    await durableWrite(this.pathFor(collection), notation);
    await staged?.activate();
  }

  async listOffers() {
    const notation = await this.#loadNotation('offers');
    return deserializeOffers(notation);
  }

  saveOffers(incoming) {
    return this.#locked(async () => {
      const offers = deduplicateOffers([
        ...deserializeOffers(await readOrEmpty(this.offersPath)),
        ...incoming,
      ]).sort(
        (left, right) =>
          new Date(right.collectedAt || 0) - new Date(left.collectedAt || 0)
      );
      let notation = serializeOffers(offers);
      while (
        offers.length &&
        new globalThis.TextEncoder().encode(notation).length > this.maxBytes
      ) {
        offers.pop();
        notation = serializeOffers(offers);
      }
      const staged = this.mirror
        ? await this.mirror.stage({
            directory: this.directory,
            kind: 'offers',
            notation,
          })
        : undefined;
      await durableWrite(this.offersPath, notation);
      await staged?.activate();
    });
  }

  deleteOffersByMessages(sourceId, messageIds) {
    const identifiers = new Set(messageIds.map(String));
    return this.#locked(async () => {
      const offers = deserializeOffers(await readOrEmpty(this.offersPath));
      let changed = false;
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
      const notation = serializeOffers(remaining);
      const staged = this.mirror
        ? await this.mirror.stage({
            directory: this.directory,
            kind: 'offers',
            notation,
          })
        : undefined;
      await durableWrite(this.offersPath, notation);
      await staged?.activate();
    });
  }

  async loadSources() {
    const notation = await this.#loadNotation('sources');
    return deserializeSources(notation);
  }

  saveSources(sources) {
    return this.saveRecords('sources', sources);
  }

  loadSearchState() {
    const load = async () => {
      const notation = await readOrEmpty(this.searchStatePath);
      await this.mirror?.ensure?.({
        directory: this.directory,
        kind: 'search-state',
        notation,
      });
      return deserializeSearchState(notation);
    };
    return this.mirror ? this.#locked(load) : load();
  }

  saveSearchState(state) {
    return this.#locked(async () => {
      const notation = serializeSearchState(state);
      const staged = this.mirror
        ? await this.mirror.stage({
            directory: this.directory,
            kind: 'search-state',
            notation,
          })
        : undefined;
      await durableWrite(this.searchStatePath, notation);
      await staged?.activate();
    });
  }
}
