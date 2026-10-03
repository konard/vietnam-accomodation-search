import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';

import { LinksStore, serializeOffers } from '../src/links-store.js';
import {
  PHOTO_LIMIT,
  RAW_ARRAY_LIMIT,
  RAW_BYTE_LIMIT,
  RAW_TEXT_LIMIT,
  boundStoredOffer,
  boundedPhotos,
  boundedRaw,
  mediaIdentity,
  scalarId,
} from '../src/offer-bounds.js';
import { writeOfferCollection } from '../src/offer-chunks.js';
import { deduplicateOffers, normalizeOffer } from '../src/offers.js';
import { parseTelegramOffer } from '../src/telegram-parser.js';
import { assembleTelegramAlbums } from '../src/telegram-pipeline.js';

const isDeno = typeof globalThis.Deno !== 'undefined';
// Per-offer JSON budget from the #82 acceptance criteria. Associative LiNo
// writes about 150 bytes per JSON leaf, so a minimal offer is already ~23 KB
// of LiNo; the LiNo ceiling guards against the 2.2 MB per offer measured.
const OFFER_JSON_BUDGET = 16 * 1024;
const OFFER_LINO_CEILING = 128 * 1024;
const NOW = new Date('2026-10-03T00:00:00.000Z');

// Mirrors the big-integer `Integer` GramJS uses for 64-bit IDs.
class Integer {
  constructor(value) {
    this.value = BigInt(value);
  }

  toString() {
    return this.value.toString();
  }
  // big-integer serializes to its decimal string.
  toJSON() {
    return this.toString();
  }
}

// Mirrors GramJS TL objects: class instances with `className` and buffers.
class TlObject {
  constructor(className, fields) {
    this.className = className;
    Object.assign(this, fields);
  }
}

function gramPhoto(id, thumbnailBytes = 900) {
  return new TlObject('Photo', {
    accessHash: new Integer('-123456789'),
    dcId: 5,
    fileReference: Buffer.alloc(32, 7),
    id: new Integer(id),
    sizes: [
      new TlObject('PhotoStrippedSize', {
        bytes: Buffer.alloc(thumbnailBytes, 1),
        type: 'i',
      }),
      new TlObject('PhotoSize', { h: 240, size: 12_000, type: 'm', w: 320 }),
    ],
  });
}

function gramPhotoMedia(id) {
  return new TlObject('MessageMediaPhoto', { photo: gramPhoto(id) });
}

function gramDocumentMedia(id) {
  return new TlObject('MessageMediaDocument', {
    document: new TlObject('Document', {
      fileReference: Buffer.alloc(16, 3),
      id: new Integer(id),
      mimeType: 'video/mp4',
      size: new Integer(1000),
      thumbs: [new TlObject('PhotoStrippedSize', { bytes: Buffer.alloc(64) })],
    }),
  });
}

function albumMessages(count, { text = 'Studio for rent 7 000 000 VND' } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    chatId: -1001,
    date: Math.floor(Date.parse('2026-10-01T00:00:00.000Z') / 1000),
    groupedId: 'album-1',
    id: index + 1,
    media: gramPhotoMedia(`54312345678901234${String(index).padStart(2, '0')}`),
    text: index === 0 ? text : '',
  }));
}

// Finds any binary value or the JSON form earlier releases persisted.
function binaryPaths(value, path = '') {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return [path];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (value.type === 'Buffer' && Array.isArray(value.data)) {
    return [path];
  }
  return Object.entries(value).flatMap(([key, item]) =>
    binaryPaths(item, `${path}/${key}`)
  );
}

function legacyOffer(id = 'legacy-1') {
  // The shape #82 measured: whole GramJS photos in photos, raw, and variants.
  const photos = JSON.parse(
    JSON.stringify([gramPhoto('1', 400), gramPhoto('2', 400)])
  );
  const raw = { id: 7, media: photos[0], photos, text: 'Legacy studio' };
  return {
    collectedAt: '2026-10-01T00:00:00.000Z',
    id,
    photos,
    postedAt: '2026-10-01T00:00:00.000Z',
    raw,
    sourceId: 'telegram:legacy',
    title: 'Legacy studio',
    variants: [{ id: `${id}:v`, photos, raw, sourceId: 'telegram:legacy' }],
  };
}

async function withDirectory(prefix, run) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function failureOf(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

describe('bounded offers: scalar media identity', () => {
  it('reads GramJS photo and document IDs, never the media object', () => {
    expect(
      mediaIdentity({ media: gramPhotoMedia('5431234567890123456') })
    ).toBe('5431234567890123456');
    expect(
      mediaIdentity({ media: gramDocumentMedia('6431234567890123456') })
    ).toBe('6431234567890123456');
    expect(
      mediaIdentity({
        media: new TlObject('MessageMediaWebPage', {
          webpage: { photo: { id: new Integer('77') } },
        }),
      })
    ).toBe('77');
    expect(
      mediaIdentity({
        media: { webpage: { document: { id: new Integer('78') } } },
      })
    ).toBe('78');
  });

  it('reads mtcute raw TL media and normalized mtcute media', () => {
    expect(
      mediaIdentity({
        media: {
          raw: {
            _: 'messageMediaPhoto',
            photo: { _: 'photo', fileReference: new Uint8Array(8), id: 88n },
          },
          type: 'photo',
        },
      })
    ).toBe('88');
    expect(
      mediaIdentity({
        media: { id: '89', mimeType: 'image/jpeg', type: 'photo' },
      })
    ).toBe('89');
  });

  it('falls back through scalar message fields and never returns an object', () => {
    expect(mediaIdentity({ media: { id: 1 }, mediaId: 'explicit' })).toBe(
      'explicit'
    );
    expect(mediaIdentity({ media: '[PHOTO_1]' })).toBe('[PHOTO_1]');
    expect(mediaIdentity({ photo: { id: new Integer('90') } })).toBe('90');
    expect(mediaIdentity({ document: { id: 91 } })).toBe('91');
    expect(mediaIdentity({ photos: ['p-1'] })).toBe('p-1');
    expect(
      mediaIdentity({
        media: new TlObject('MessageMediaPhoto', {
          photo: new TlObject('PhotoEmpty', { fileReference: Buffer.alloc(4) }),
        }),
      })
    ).toBe(undefined);
    expect(mediaIdentity({})).toBe(undefined);
  });

  it('accepts only scalar identifiers', () => {
    expect(scalarId('id')).toBe('id');
    expect(scalarId('')).toBe(undefined);
    expect(scalarId('x'.repeat(2049))).toBe(undefined);
    expect(scalarId(12)).toBe('12');
    expect(scalarId(Number.NaN)).toBe(undefined);
    expect(scalarId(12n)).toBe('12');
    expect(scalarId(new Integer('-5'))).toBe('-5');
    expect(scalarId(new TlObject('Photo', {}))).toBe(undefined);
    expect(scalarId({ id: 1 })).toBe(undefined);
    expect(scalarId(Buffer.from('12'))).toBe(undefined);
    expect(scalarId(new ArrayBuffer(2))).toBe(undefined);
    expect(scalarId({ data: [1], type: 'Buffer' })).toBe(undefined);
    expect(scalarId(true)).toBe(undefined);
  });

  it('deduplicates one GramJS photo shared by album members', () => {
    const media = gramPhotoMedia('5431234567890123456');
    const [album] = assembleTelegramAlbums([
      { chatId: 1, groupedId: 'g', id: 1, media, text: 'Studio' },
      { chatId: 1, groupedId: 'g', id: 2, media },
      {
        chatId: 1,
        groupedId: 'g',
        id: 3,
        media: gramDocumentMedia('6431234567890123456'),
      },
    ]);
    expect(album.mediaIds).toEqual([
      '5431234567890123456',
      '6431234567890123456',
    ]);
  });

  it('caps album media IDs at the photo limit', () => {
    const [album] = assembleTelegramAlbums(albumMessages(PHOTO_LIMIT + 2));
    expect(album.mediaIds.length).toBe(PHOTO_LIMIT);
    expect(album.mediaIds.every((id) => typeof id === 'string')).toBe(true);
  });
});

describe('bounded offers: bounded offer shape', () => {
  it('keeps a ten-photo GramJS album offer within the per-offer budget', () => {
    const [album] = assembleTelegramAlbums(albumMessages(PHOTO_LIMIT));
    // The stored shape: deduplication adds the source variant.
    const [offer] = deduplicateOffers([
      parseTelegramOffer(
        { ...album, photos: album.mediaIds, sourceId: 'telegram:test' },
        { now: NOW }
      ),
    ]);
    expect(offer.photos.length).toBe(PHOTO_LIMIT);
    expect(offer.variants[0].photos).toEqual(offer.photos);
    expect(binaryPaths(offer)).toEqual([]);
    expect(offer.raw.members).toBe(undefined);
    expect(offer.raw.media).toEqual({
      id: '5431234567890123400',
      type: 'MessageMediaPhoto',
    });
    expect(offer.raw.mediaIds).toBe(undefined);
    expect(Buffer.byteLength(JSON.stringify(offer)) <= OFFER_JSON_BUDGET).toBe(
      true
    );
    expect(
      Buffer.byteLength(serializeOffers([offer])) <= OFFER_LINO_CEILING
    ).toBe(true);
  });

  it('bounds provider objects passed straight to normalization', () => {
    const media = gramPhotoMedia('11');
    const offer = normalizeOffer(
      {
        photos: [media, media, gramDocumentMedia('12'), 'https://x.test/a.jpg'],
        raw: new TlObject('Message', {
          _client: new TlObject('TelegramClient', {}),
          id: 5,
          media,
          peerId: new TlObject('PeerChannel', { channelId: new Integer('9') }),
        }),
        sourceId: 'telegram:test',
        title: 'Studio',
      },
      { now: NOW }
    );
    expect(offer.photos).toEqual(['11', '12', 'https://x.test/a.jpg']);
    expect(offer.raw).toEqual({
      className: 'Message',
      id: 5,
      media: { id: '11', type: 'MessageMediaPhoto' },
    });
    expect(deduplicateOffers([offer])[0].variants[0].photos).toEqual(
      offer.photos
    );
    expect(binaryPaths(offer)).toEqual([]);
  });

  it('keeps the input fields as raw when no raw record is given', () => {
    const offer = normalizeOffer(
      { photos: [gramPhotoMedia('13')], sourceId: 'web:test', title: 'Room' },
      { now: NOW }
    );
    expect(offer.raw.photos).toBe(undefined);
    expect(offer.raw.title).toBe('Room');
  });

  it('bounds photo lists from every entry shape', () => {
    expect(boundedPhotos(undefined)).toEqual([]);
    expect(
      boundedPhotos([
        null,
        { photo: { id: 1 }, raw: { _: 'messageMediaDocument' } },
        { id: 2 },
        { data: [1], type: 'Buffer' },
        Buffer.alloc(4),
        3,
        '3',
      ])
    ).toEqual(['1', '2', '3']);
    expect(
      boundedPhotos(Array.from({ length: 30 }, (_, index) => `p${index}`))
    ).toEqual(Array.from({ length: PHOTO_LIMIT }, (_, index) => `p${index}`));
  });

  it('sanitizes every JSON value class in raw records', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const raw = boundedRaw({
      array: Array.from({ length: RAW_ARRAY_LIMIT + 5 }, (_, index) => index),
      big: 5n,
      buffer: Buffer.alloc(8),
      date: new Date('2026-10-01T00:00:00.000Z'),
      deep,
      empty: null,
      flag: false,
      infinite: Number.POSITIVE_INFINITY,
      invalidDate: new Date(Number.NaN),
      map: new Map([[1, 2]]),
      media: {
        mimeType: 'image/jpeg',
        raw: { className: 'MessageMediaPhoto' },
      },
      emptyMedia: { media: {} },
      documentMedia: {
        media: { document: { id: 4, mimeType: 'application/pdf' } },
      },
      members: [{ id: 1 }],
      photos: [gramPhoto('1')],
      text: 'x'.repeat(RAW_TEXT_LIMIT + 10),
      typed: new Uint8Array(3),
      undefinedValue: undefined,
      fn: () => 1,
    });
    expect(raw).toEqual({
      array: Array.from({ length: RAW_ARRAY_LIMIT }, (_, index) => index),
      big: '5',
      date: '2026-10-01T00:00:00.000Z',
      deep: { a: { b: {} } },
      documentMedia: {
        media: { id: '4', mimeType: 'application/pdf' },
      },
      emptyMedia: {},
      empty: null,
      flag: false,
      media: { mimeType: 'image/jpeg', type: 'MessageMediaPhoto' },
      text: 'x'.repeat(RAW_TEXT_LIMIT),
    });
  });

  it('rejects raw values that are not records', () => {
    expect(boundedRaw(null)).toEqual({});
    expect(boundedRaw('text')).toEqual({});
    expect(boundedRaw([1])).toEqual({});
    expect(boundedRaw(Buffer.alloc(2))).toEqual({});
  });

  it('falls back to core fields, then shorter text, within the raw budget', () => {
    const noisy = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `extra${index}`,
        'n'.repeat(RAW_TEXT_LIMIT),
      ])
    );
    const core = boundedRaw({ ...noisy, id: 1, text: 'Studio' });
    expect(core).toEqual({ id: 1, text: 'Studio' });
    const shortened = boundedRaw({
      ...noisy,
      caption: 'c'.repeat(RAW_TEXT_LIMIT),
      id: 2,
      text: 't'.repeat(RAW_TEXT_LIMIT),
    });
    expect(shortened.caption.length).toBe(RAW_TEXT_LIMIT);
    expect(shortened.text.length < RAW_TEXT_LIMIT).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(shortened)) <= RAW_BYTE_LIMIT).toBe(
      true
    );
    const oversizedCore = boundedRaw({
      messageIds: Array.from({ length: 5 }, () => 'm'.repeat(RAW_TEXT_LIMIT)),
    });
    expect(oversizedCore).toEqual({});
  });
});

describe('bounded offers: stored offer migration', () => {
  it('returns bounded offers unchanged and rewrites legacy offers', () => {
    const current = normalizeOffer(
      { photos: ['1'], sourceId: 'telegram:test', title: 'Studio' },
      { now: NOW }
    );
    expect(boundStoredOffer(current)).toBe(current);
    const bare = { id: 'bare' };
    expect(boundStoredOffer(bare)).toBe(bare);
    const migrated = boundStoredOffer(legacyOffer());
    expect(migrated.photos).toEqual(['1', '2']);
    expect(migrated.raw).toEqual({
      id: 7,
      media: { id: '1', type: 'Photo' },
      text: 'Legacy studio',
    });
    expect(migrated.variants[0].photos).toEqual(['1', '2']);
    expect(migrated.variants[0].raw).toEqual(migrated.raw);
    expect(binaryPaths(migrated)).toEqual([]);
    const topOnly = boundStoredOffer({
      ...legacyOffer(),
      variants: [{ id: 'clean', photos: [] }],
    });
    expect(topOnly.variants[0]).toEqual({ id: 'clean', photos: [] });
  });

  it('migrates legacy stored offers once and keeps them readable', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory('issue-82-migrate-', async (directory) => {
      const store = new LinksStore({ directory });
      const legacy = [legacyOffer('legacy-1'), legacyOffer('legacy-2')];
      // Write the legacy shape directly, as releases before #82 did.
      await writeFile(store.offersPath, serializeOffers(legacy));
      const before = Buffer.byteLength(await readFile(store.offersPath));
      const listed = await store.listOffers();
      expect(binaryPaths(listed)).toEqual([]);
      expect(await store.migrateOffers()).toBe(2);
      const after = await readFile(store.offersPath, 'utf8');
      expect(Buffer.byteLength(after) * 4 < before).toBe(true);
      expect(after.includes('fileReference')).toBe(false);
      expect(await store.migrateOffers()).toBe(0);
      expect((await store.listOffers()).map(({ photos }) => photos)).toEqual([
        ['1', '2'],
        ['1', '2'],
      ]);
    });
  });

  it('persists the bounded shape when a mirrored store lists legacy offers', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory('issue-82-list-', async (directory) => {
      const staged = [];
      const mirror = {
        ensure: async () => {},
        stage: async ({ notation }) => {
          staged.push(notation);
          return { activate: async () => {} };
        },
      };
      const store = new LinksStore({ directory, mirror });
      await writeFile(store.offersPath, serializeOffers([legacyOffer()]));
      await store.listOffers();
      expect(staged.length).toBe(1);
      expect(staged[0].includes('fileReference')).toBe(false);
      await store.listOffers();
      expect(staged.length).toBe(1);
    });
  });

  it('migrates legacy offers while deleting message variants', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory('issue-82-delete-', async (directory) => {
      const store = new LinksStore({ directory });
      await writeFile(store.offersPath, serializeOffers([legacyOffer()]));
      await store.deleteOffersByMessages('telegram:unrelated', [1]);
      const notation = await readFile(store.offersPath, 'utf8');
      expect(notation.includes('fileReference')).toBe(false);
    });
  });
});

describe('bounded offers: unindexed chunk cleanup', () => {
  function offers(count) {
    return Array.from({ length: count }, (_, index) => ({
      collectedAt: '2026-10-01T00:00:00.000Z',
      id: `offer-${index}`,
      postedAt: '2026-10-01T00:00:00.000Z',
      raw: { text: `Room ${index} `.repeat(40) },
      sourceId: 'telegram:test',
      title: `Room ${index}`,
    }));
  }

  async function chunkNames(directory) {
    return readdir(join(directory, 'offers.chunks')).catch(() => []);
  }

  it('removes the chunks a failed save created before its index committed', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory('issue-82-failed-save-', async (directory) => {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await store.saveOffers(offers(30));
      const committed = (await chunkNames(directory)).sort();
      await writeFile(
        join(directory, '.state-schema.json'),
        '{"schemaVersion":0}\n'
      );
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const failure = await failureOf(() => store.saveOffers(offers(60)));
        expect(failure.message).toBe(
          'Data schema marker has an invalid version.'
        );
        expect((await chunkNames(directory)).sort()).toEqual(committed);
      }
    });
  });

  it('removes created chunks from a first failed save without an index', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory('issue-82-first-failure-', async (directory) => {
      await writeFile(
        join(directory, '.state-schema.json'),
        '{"schemaVersion":0}\n'
      );
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await failureOf(() => store.saveOffers(offers(60)));
      expect(await chunkNames(directory)).toEqual([]);
    });
  });

  it('prunes orphan chunks left by an interrupted save on the next save', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory('issue-82-orphans-', async (directory) => {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await store.saveOffers(offers(30));
      const orphan = join(directory, 'offers.chunks', 'f'.repeat(64));
      await mkdir(orphan, { recursive: true });
      await writeFile(join(orphan, 'offers.lino'), 'orphan\n');
      await writeFile(
        join(directory, '.state-schema.json'),
        '{"schemaVersion":0}\n'
      );
      // Even a save that fails later clears the earlier orphan first.
      await failureOf(() => store.saveOffers(offers(60)));
      expect((await chunkNames(directory)).includes('f'.repeat(64))).toBe(
        false
      );
    });
  });

  it('leaves chunks alone before a save when the index is unreadable', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory('issue-82-bad-index-', async (directory) => {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await store.saveOffers(offers(30));
      const before = await chunkNames(directory);
      await writeFile(join(directory, 'offers.index.json'), '{not json');
      await writeFile(
        join(directory, '.state-schema.json'),
        '{"schemaVersion":0}\n'
      );
      await failureOf(() =>
        writeOfferCollection({
          directory,
          maxBytes: store.maxBytes,
          maxShardBytes: 32_000,
          offers: offers(60),
          offersPath: store.offersPath,
        })
      );
      expect((await chunkNames(directory)).sort()).toEqual(before.sort());
    });
  });
});
