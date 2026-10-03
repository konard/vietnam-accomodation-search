import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';

import {
  LinkCliMirror,
  sha256,
  splitNotation,
} from '../src/link-cli-mirror.js';
import { LinksStore, serializeOffers } from '../src/links-store.js';
import {
  PRICE_HISTORY_LIMIT,
  VARIANT_LIMIT,
  boundStoredOffer,
} from '../src/offer-bounds.js';
import { writeOfferCollection } from '../src/offer-chunks.js';
import { deduplicateOffers } from '../src/offers.js';

const isDeno = typeof globalThis.Deno !== 'undefined';
// The LiNo ceiling per offer from the bounded-offer tests.
const OFFER_LINO_CEILING = 128 * 1024;
// Small enough that every chunk spans several sub-shards.
const tinyShards = {
  averageShardLinks: 32,
  maxShardLinks: 64,
  minShardLinks: 16,
};

// A GramJS `Photo` as checkpoint journals stored it: JSON, with `Buffer`
// thumbnails and file references in `{type: 'Buffer', data: [...]}` form.
function journaledPhoto(id) {
  const bytes = (length, value) => ({
    data: Array.from({ length }, () => value),
    type: 'Buffer',
  });
  return {
    className: 'Photo',
    dcId: 5,
    fileReference: bytes(32, 7),
    id,
    sizes: [
      { bytes: bytes(900, 1), className: 'PhotoStrippedSize', type: 'i' },
      { className: 'PhotoSize', h: 240, size: 12_000, type: 'm', w: 320 },
    ],
  };
}

// The shape a replayed pre-bounding checkpoint batch carries in `raw.photos`.
function replayedOffer(id, collectedAt = '2026-09-25T00:00:00.000Z') {
  const photos = Array.from({ length: 10 }, (_, index) =>
    journaledPhoto(`${id}${index}`)
  );
  return {
    collectedAt,
    id: `telegram:replay:${id}`,
    photos: photos.map(({ id: photoId }) => photoId),
    postedAt: '2026-09-25T00:00:00.000Z',
    raw: { id, media: { photo: photos[0] }, photos, text: `Studio ${id}` },
    sourceId: 'telegram:replay',
    title: `Studio ${id}`,
  };
}

function bloated(notation) {
  return notation.includes('fileReference') || notation.includes('/bytes/');
}

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'issue-85-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function storedNotation(directory) {
  const root = await readFile(join(directory, 'offers.lino'), 'utf8').catch(
    () => ''
  );
  const chunks = await readdir(join(directory, 'offers.chunks')).catch(
    () => []
  );
  const shards = await Promise.all(
    chunks.map((name) =>
      readFile(join(directory, 'offers.chunks', name, 'offers.lino'), 'utf8')
    )
  );
  return [root, ...shards].join('\n');
}

describe('offers are bounded on every write path', () => {
  it('stores no byte arrays when a replayed batch is saved', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const store = new LinksStore({ directory });
      await store.saveOffers([replayedOffer('5431')]);
      const notation = await storedNotation(directory);
      expect(bloated(notation)).toBe(false);
      expect(Buffer.byteLength(notation) <= OFFER_LINO_CEILING).toBe(true);
      const [offer] = await store.listOffers();
      expect(offer.raw.photos).toBe(undefined);
      expect(offer.raw.media).toEqual({ id: '54310' });
      expect(offer.photos.length).toBe(10);
    });
  });

  it('bounds saveRecords, updateRecords, and deletions', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const store = new LinksStore({ directory });
      await store.saveRecords('offers', [replayedOffer('1')]);
      expect(bloated(await storedNotation(directory))).toBe(false);
      await store.updateRecords('offers', (offers) => [
        ...offers,
        replayedOffer('2'),
      ]);
      expect(bloated(await storedNotation(directory))).toBe(false);
      expect((await store.listOffers()).length).toBe(2);
      // A pre-bounding file is rewritten bounded by an unrelated deletion.
      await writeFile(
        join(directory, 'offers.lino'),
        serializeOffers([replayedOffer('3')])
      );
      await store.deleteOffersByMessages('telegram:unrelated', [1]);
      expect(bloated(await storedNotation(directory))).toBe(false);
    });
  });

  it('bounds offers written straight through the collection writer', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const options = {
        directory,
        maxBytes: 64 * 1024 * 1024,
        offersPath: join(directory, 'offers.lino'),
      };
      await writeOfferCollection({
        ...options,
        maxShardBytes: 16 * 1024 * 1024,
        offers: [replayedOffer('1')],
      });
      expect(bloated(await storedNotation(directory))).toBe(false);
      await writeOfferCollection({
        ...options,
        maxShardBytes: 15_000,
        offers: Array.from({ length: 6 }, (_, index) =>
          replayedOffer(String(index))
        ),
      });
      const index = JSON.parse(
        await readFile(join(directory, 'offers.index.json'), 'utf8')
      );
      expect(index.count).toBe(6);
      expect(bloated(await storedNotation(directory))).toBe(false);
    });
  });
});

describe('orphan chunks of a single-file collection', () => {
  it('are pruned when a small collection without an index is written', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const orphans = ['a', 'b', 'c'].map((digit) =>
        join(directory, 'offers.chunks', digit.repeat(64))
      );
      for (const orphan of orphans) {
        await mkdir(join(orphan, '.binary', 'offers.shards'), {
          recursive: true,
        });
        await writeFile(join(orphan, 'offers.lino'), 'orphan\n');
      }
      const store = new LinksStore({ directory });
      await store.saveOffers([replayedOffer('1')]);
      expect(await readdir(join(directory, 'offers.chunks'))).toEqual([]);
      expect((await store.listOffers()).length).toBe(1);
      expect((await readdir(directory)).includes('offers.index.json')).toBe(
        false
      );
    });
  });
});

describe('bounded variant and price history growth', () => {
  function repost(index, overrides = {}) {
    return {
      collectedAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
      id: `telegram:rent:${index}`,
      identityKeys: ['telegram-post:rent:same-listing'],
      price: { amount: 7_000_000 + index, currency: 'VND', period: 'month' },
      priceVnd: 7_000_000 + index,
      sourceId: 'telegram:rent',
      sourceType: 'telegram',
      title: 'Studio',
      ...overrides,
    };
  }

  it('keeps the newest collection of each source message', () => {
    const first = repost(1, { raw: { text: 'first collection' } });
    const again = repost(1, {
      collectedAt: '2026-09-02T00:00:00.000Z',
      priceVnd: 6_500_000,
      raw: { text: 'second collection' },
    });
    const [merged] = deduplicateOffers([first, again, repost(2)]);
    expect(merged.variants.map(({ id }) => id)).toEqual([
      'telegram:rent:2',
      'telegram:rent:1',
    ]);
    expect(merged.variants[1].raw.text).toBe('second collection');
    // Both observations of the re-collected message stay in the history.
    expect(merged.priceHistory.map(({ priceVnd }) => priceVnd)).toEqual([
      7_000_001, 7_000_002, 6_500_000,
    ]);
  });

  it('caps variants and price history at their limits, keeping the newest', () => {
    const reposts = Array.from({ length: VARIANT_LIMIT * 3 }, (_, index) =>
      repost(index)
    );
    let [merged] = deduplicateOffers(reposts);
    expect(merged.variants.length).toBe(VARIANT_LIMIT);
    expect(merged.variants.at(-1).id).toBe(
      `telegram:rent:${VARIANT_LIMIT * 3 - 1}`
    );
    expect(merged.priceHistory.length).toBe(PRICE_HISTORY_LIMIT);
    expect(merged.priceHistory.at(-1).priceVnd).toBe(
      7_000_000 + VARIANT_LIMIT * 3 - 1
    );
    // Repeated merges of the stored offer never grow it again.
    for (let round = 0; round < 3; round += 1) {
      [merged] = deduplicateOffers([merged, repost(round)]);
    }
    expect(merged.variants.length).toBe(VARIANT_LIMIT);
    expect(merged.priceHistory.length).toBe(PRICE_HISTORY_LIMIT);
  });

  it('migrates stored offers over the limits when they are read', () => {
    const stored = {
      id: 'stored',
      priceChanges: Array.from({ length: 200 }, (_, index) => ({ index })),
      priceHistory: Array.from({ length: 200 }, (_, index) => ({ index })),
      variants: Array.from({ length: 200 }, (_, index) => ({
        id: `v${index}`,
      })),
    };
    const bounded = boundStoredOffer(stored);
    expect(bounded.variants.length).toBe(VARIANT_LIMIT);
    expect(bounded.variants.at(-1).id).toBe('v199');
    expect(bounded.priceHistory.length).toBe(PRICE_HISTORY_LIMIT);
    expect(bounded.priceHistory.at(-1).index).toBe(199);
    expect(bounded.priceChanges.length).toBe(PRICE_HISTORY_LIMIT);
    expect(boundStoredOffer(bounded)).toBe(bounded);
  });
});

// Emulates clink: writes the database files and exports the import exactly.
function countingClink() {
  const calls = [];
  const run = async (_command, arguments_) => {
    calls.push(arguments_);
    const argument = (name) => arguments_[arguments_.indexOf(name) + 1];
    const notation = await readFile(argument('--import'), 'utf8');
    await writeFile(argument('--db'), `binary:${sha256(notation)}`);
    await writeFile(argument('--export'), notation);
  };
  return { calls, run };
}

function listing(index, text = `Room ${index} near the beach`) {
  return {
    collectedAt: '2026-10-01T00:00:00.000Z',
    id: `offer-${String(index).padStart(3, '0')}`,
    postedAt: '2026-10-01T00:00:00.000Z',
    raw: { text },
    sourceId: 'telegram:test',
    title: `Room ${index}`,
  };
}

// Every clink database under the committed offer chunks.
async function projectionFiles(directory) {
  const root = join(directory, 'offers.chunks');
  const entries = await readdir(root, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith('data.links'))
    .map((entry) => join(root, entry));
}

async function shardDigests(directory) {
  const index = JSON.parse(
    await readFile(join(directory, 'offers.index.json'), 'utf8')
  );
  const digests = new Set();
  for (const { sha256: chunk } of index.shards) {
    const notation = await readFile(
      join(directory, 'offers.chunks', chunk, 'offers.lino'),
      'utf8'
    );
    for (const shard of splitNotation(notation, {
      averageLinks: tinyShards.averageShardLinks,
      maxLinks: tinyShards.maxShardLinks,
      minLinks: tinyShards.minShardLinks,
    })) {
      digests.add(sha256(shard));
    }
  }
  return { digests, index };
}

describe('projection work per batch', () => {
  it('stages only the chunks whose content changed', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const staged = [];
      const mirror = {
        ensure: async () => {},
        stage: async ({ directory: chunk }) => {
          staged.push(chunk);
          return { activate: async () => {} };
        },
      };
      const store = new LinksStore({
        directory,
        maxOfferShardBytes: 64_000,
        mirror,
      });
      const offers = Array.from({ length: 40 }, (_, index) => listing(index));
      await store.saveOffers(offers);
      const { index } = await shardDigests(directory);
      expect(index.shards.length > 2).toBe(true);
      expect(staged.length).toBe(index.shards.length);
      staged.length = 0;
      await store.saveOffers([listing(7, 'Room 7, price lowered')]);
      expect(staged.length).toBe(1);
      staged.length = 0;
      await store.saveOffers([listing(7, 'Room 7, price lowered')]);
      expect(staged).toEqual([]);
    });
  });

  // Saves 40 listings with real sharded projections, then edits one.
  async function editOneListing(directory, mirrorOptions, beforeEdit) {
    const clink = countingClink();
    const store = new LinksStore({
      directory,
      maxOfferShardBytes: 64_000,
      mirror: new LinkCliMirror({
        ...tinyShards,
        ...mirrorOptions,
        run: clink.run,
      }),
    });
    await store.saveOffers(
      Array.from({ length: 40 }, (_, index) => listing(index))
    );
    const before = await shardDigests(directory);
    expect(clink.calls.length).toBe(before.digests.size);
    await beforeEdit?.(before);
    clink.calls.length = 0;
    await store.saveOffers([listing(7, 'Room 7, price lowered')]);
    const after = await shardDigests(directory);
    const fresh = [...after.digests].filter(
      (digest) => !before.digests.has(digest)
    );
    return { after, clink, fresh, store };
  }

  it('reuses unchanged sub-shard projections from the previous chunk', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const { clink, fresh, store } = await editOneListing(directory);
      expect(fresh.length > 0).toBe(true);
      expect(fresh.length <= 2).toBe(true);
      // Only sub-shards with new content run clink; the rest are adopted.
      expect(clink.calls.length).toBe(fresh.length);
      // Adopted projections pass verification on the next read.
      clink.calls.length = 0;
      expect((await store.listOffers()).length).toBe(40);
      expect(clink.calls.length).toBe(0);
    });
  });

  it('copies adopted projections when hard links are unavailable', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const linkFile = async () => {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      };
      const { clink, fresh } = await editOneListing(directory, {
        linkFile,
      });
      expect(clink.calls.length).toBe(fresh.length);
      for (const path of await projectionFiles(directory)) {
        expect((await stat(path)).nlink).toBe(1);
      }
    });
  });

  it('imports again when a previous projection fails verification', async () => {
    if (isDeno) {
      return;
    }
    await withDirectory(async (directory) => {
      const { clink, fresh, store } = await editOneListing(
        directory,
        {},
        async () => {
          for (const path of await projectionFiles(directory)) {
            await writeFile(path, 'tampered');
          }
        }
      );
      expect(clink.calls.length > fresh.length).toBe(true);
      expect((await store.listOffers()).length).toBe(40);
    });
  });
});
