import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Link, Parser, formatLinks } from 'links-notation';

import { deduplicateOffers } from './offers.js';

function encodeJson(value) {
  const bytes = new globalThis.TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis
    .btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeJson(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new globalThis.TextDecoder().decode(bytes));
}

function field(name, value) {
  return new Link(name, [new Link(encodeJson(value))]);
}

function serializeRecords(kind, records) {
  return formatLinks(
    records.map(
      (record, index) =>
        new Link(kind, [
          new Link(record.id || String(index)),
          ...(record.sourceId
            ? [new Link('source', [new Link(record.sourceId)])]
            : []),
          ...(record.type ? [new Link('type', [new Link(record.type)])] : []),
          ...(Number.isFinite(record.priceVnd)
            ? [new Link('price-vnd', [new Link(String(record.priceVnd))])]
            : []),
          ...(record.url ? [field('url', record.url)] : []),
          field('data', record),
        ])
    )
  );
}

function deserializeRecords(kind, notation = '') {
  if (!notation.trim()) {
    return [];
  }
  const links = new Parser().parse(notation);
  return links
    .filter((link) => link.id === kind)
    .map((link) => link.values.find((value) => value.id === 'data'))
    .filter((data) => data?.values?.[0]?.id)
    .map((data) => decodeJson(data.values[0].id));
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

let temporarySequence = 0;

async function syncDirectory(path) {
  let directory;
  try {
    directory = await open(path, 'r');
    await directory.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) {
      throw error;
    }
  } finally {
    await directory?.close();
  }
}

async function atomicWrite(path, contents) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  temporarySequence += 1;
  const pid = globalThis.process?.pid || 'runtime';
  const temporary = `${path}.${pid}.${Date.now()}.${temporarySequence}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'w', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(parent);
  } catch (error) {
    await handle?.close();
    await rm(temporary, { force: true });
    throw error;
  }
}

export class LinksStore {
  constructor({
    directory = '.vietnam-accomodation-search',
    maxBytes = 10 * 1024 ** 3,
  } = {}) {
    this.offersPath = join(directory, 'offers.lino');
    this.searchStatePath = join(directory, 'search-state.lino');
    this.sourcesPath = join(directory, 'sources.lino');
    this.maxBytes = maxBytes;
    this.writeQueue = Promise.resolve();
  }

  enqueue(operation) {
    const pending = this.writeQueue.then(operation, operation);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }

  async listOffers() {
    return deserializeOffers(await readOrEmpty(this.offersPath));
  }

  async saveOffers(incoming) {
    return this.enqueue(async () => {
      const offers = deduplicateOffers([
        ...(await this.listOffers()),
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
      await atomicWrite(this.offersPath, notation);
    });
  }

  async loadSources() {
    return deserializeSources(await readOrEmpty(this.sourcesPath));
  }

  async saveSources(sources) {
    return this.enqueue(() =>
      atomicWrite(this.sourcesPath, serializeSources(sources))
    );
  }

  async loadSearchState() {
    return deserializeSearchState(await readOrEmpty(this.searchStatePath));
  }

  saveSearchState(state) {
    return this.enqueue(() =>
      atomicWrite(this.searchStatePath, serializeSearchState(state))
    );
  }
}
