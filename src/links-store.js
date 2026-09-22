import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, path);
}

export class LinksStore {
  constructor({
    directory = '.vietnam-accomodation-search',
    maxBytes = 10 * 1024 ** 3,
  } = {}) {
    this.offersPath = join(directory, 'offers.lino');
    this.sourcesPath = join(directory, 'sources.lino');
    this.maxBytes = maxBytes;
  }

  async listOffers() {
    return deserializeOffers(await readOrEmpty(this.offersPath));
  }

  async saveOffers(incoming) {
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
  }

  async loadSources() {
    return deserializeSources(await readOrEmpty(this.sourcesPath));
  }

  async saveSources(sources) {
    await atomicWrite(this.sourcesPath, serializeSources(sources));
  }
}
