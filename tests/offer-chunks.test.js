import { createHash } from 'node:crypto';
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

import {
  compareFingerprints,
  stateFingerprint,
} from '../experiments/deploy-cutover-drill-lib.mjs';
import { snapshotState } from '../scripts/deploy-state.mjs';
import {
  partitionOfferEntries,
  writeOfferCollection,
} from '../src/offer-chunks.js';
import {
  LinksStore,
  serializeOfferBounded,
  serializeOffers,
} from '../src/links-store.js';

const isDeno = typeof globalThis.Deno !== 'undefined';

function syntheticOffers(count) {
  return Array.from({ length: count }, (_, index) => ({
    collectedAt: '2026-09-29T00:00:00.000Z',
    id: `offer-${index}`,
    postedAt: '2026-09-28T00:00:00.000Z',
    raw: {
      lines: Array.from({ length: 12 }, (_, line) => ({
        text: `Room ${index} line ${line} in Vietnamese English Russian`,
      })),
    },
    sourceId: `source-${index % 40}`,
    title: `Room ${index}`,
  }));
}

async function failureOf(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

describe('bounded offer persistence', () => {
  it('formats one offer exactly and rejects an oversized field before joining links', () => {
    const [offer] = syntheticOffers(1);
    expect(serializeOfferBounded(offer, 32_000)).toBe(serializeOffers([offer]));
    expect(() =>
      serializeOfferBounded(
        offer,
        Buffer.byteLength(serializeOffers([offer])) - 1
      )
    ).toThrow();
    const oversized = { ...offer, raw: { text: 'x'.repeat(40_000) } };
    expect(() => serializeOfferBounded(oversized, 32_000)).toThrow();
  });

  it('rejects entries that cannot fit in a shard, even at the hash depth limit', () => {
    const entries = [{ bytes: 2, offer: { id: 'one' } }];
    expect(() => partitionOfferEntries(entries, 1)).toThrow();
    expect(() =>
      partitionOfferEntries([...entries, ...entries], 1, '', 64)
    ).toThrow();
  });

  it('partitions a production-shaped merge before formatting one large document', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-chunks-'));
    try {
      await writeFile(
        join(directory, '.state-schema.json'),
        '{"schemaVersion":2}\n'
      );
      const store = new LinksStore({
        directory,
        maxBytes: 50_000_000,
        maxOfferShardBytes: 32_000,
      });
      const offers = syntheticOffers(80);
      await store.saveOffers(offers);
      const index = JSON.parse(
        await readFile(join(directory, 'offers.index.json'), 'utf8')
      );
      expect(
        JSON.parse(
          await readFile(join(directory, '.state-schema.json'), 'utf8')
        ).schemaVersion
      ).toBe(4);
      expect(index.version).toBe(1);
      expect(index.count).toBe(offers.length);
      expect(index.shards.length > 1).toBe(true);
      expect(index.shards.every((shard) => shard.bytes <= 32_000)).toBe(true);
      expect((await store.listOffers()).map(({ id }) => id)).toEqual(
        offers.map(({ id }) => id).sort()
      );
      expect((await readdir(join(directory, 'offers.chunks'))).length).toBe(
        index.shards.length
      );
      expect(store.pathFor('offers')).toBe(store.offersPath);
      const ensured = [];
      const mirrored = new LinksStore({
        directory,
        mirror: {
          ensure: async ({ directory: shardDirectory }) =>
            ensured.push(shardDirectory),
        },
      });
      expect((await mirrored.listOffers()).length).toBe(offers.length);
      expect(ensured.length).toBe(index.shards.length);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps the prior snapshot when a chunk projection fails', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-stage-failure-'));
    try {
      const original = new LinksStore({ directory });
      await original.saveOffers(syntheticOffers(1));
      const before = await readFile(original.offersPath, 'utf8');
      const failing = new LinksStore({
        directory,
        maxOfferShardBytes: 32_000,
        mirror: {
          stage: async () => {
            throw new Error('synthetic projection failure');
          },
        },
      });
      let failure;
      try {
        await failing.saveOffers(syntheticOffers(80));
      } catch (error) {
        failure = error;
      }
      expect(failure?.message).toBe('synthetic projection failure');
      expect(await readFile(original.offersPath, 'utf8')).toBe(before);
      expect((await original.listOffers()).length).toBe(1);
      let indexExists = true;
      try {
        await readFile(join(directory, 'offers.index.json'));
      } catch (error) {
        indexExists = error.code !== 'ENOENT';
      }
      expect(indexExists).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects altered shards and duplicate index entries', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-index-integrity-'));
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await store.saveOffers(syntheticOffers(30));
      const path = join(directory, 'offers.index.json');
      const index = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, '{');
      expect((await failureOf(() => store.listOffers())).name).toBe(
        'SyntaxError'
      );
      await writeFile(
        path,
        `${JSON.stringify({ ...index, shards: [...index.shards, index.shards[0]] })}\n`
      );
      expect((await failureOf(() => store.listOffers())).message).toBe(
        'Invalid canonical offer index.'
      );
      await writeFile(path, `${JSON.stringify(index)}\n`);
      const shardPath = join(
        directory,
        'offers.chunks',
        index.shards[0].sha256,
        'offers.lino'
      );
      const originalShard = await readFile(shardPath, 'utf8');
      await writeFile(shardPath, 'tampered');
      expect((await failureOf(() => store.listOffers())).message).toBe(
        'Canonical offer shard does not match its index.'
      );
      await writeFile(shardPath, originalShard);
      const wrongCount = globalThis.structuredClone(index);
      wrongCount.shards[0].count += 1;
      await writeFile(path, `${JSON.stringify(wrongCount)}\n`);
      expect((await failureOf(() => store.listOffers())).message).toBe(
        'Canonical offer shard count does not match its index.'
      );
      await writeFile(path, `${JSON.stringify({ ...index, count: 31 })}\n`);
      expect((await failureOf(() => store.listOffers())).message).toBe(
        'Invalid canonical offer index.'
      );
      const legacyWrongCount = { ...index, count: 31 };
      delete legacyWrongCount.order;
      await writeFile(path, JSON.stringify(legacyWrongCount));
      expect((await failureOf(() => store.listOffers())).message).toBe(
        'Canonical offer totals do not match the index.'
      );
      const duplicates = [
        { id: 'duplicate', title: 'First room' },
        { id: 'duplicate', title: 'Second room' },
      ].map((offer) => {
        const notation = serializeOffers([offer]);
        return {
          notation,
          sha256: createHash('sha256').update(notation).digest('hex'),
        };
      });
      for (const { notation, sha256 } of duplicates) {
        const chunk = join(directory, 'offers.chunks', sha256);
        await mkdir(chunk);
        await writeFile(join(chunk, 'offers.lino'), notation);
      }
      await writeFile(
        path,
        `${JSON.stringify({
          bytes: duplicates.reduce(
            (sum, { notation }) => sum + Buffer.byteLength(notation),
            0
          ),
          count: 2,
          shards: duplicates.map(({ notation, sha256 }) => ({
            bytes: Buffer.byteLength(notation),
            count: 1,
            sha256,
          })),
          version: 1,
        })}\n`
      );
      expect((await failureOf(() => store.listOffers())).message).toBe(
        'Canonical offer index contains duplicate offer IDs.'
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('fails closed when required recent offers exceed the budget', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-budget-'));
    try {
      const store = new LinksStore({ directory, maxBytes: 1 });
      expect(
        (await failureOf(() => store.saveOffers(syntheticOffers(1)))).message
      ).toBe(
        'Offer storage budget cannot retain the two-month listing window.'
      );
      expect(await store.listOffers()).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('protects offers with a recent collection time or an unknown age', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-budget-age-'));
    try {
      const store = new LinksStore({ directory, maxBytes: 1 });
      for (const offer of [
        {
          collectedAt: new Date().toISOString(),
          id: 'recent-collection',
          title: 'Recent room',
        },
        { id: 'unknown-age', title: 'Undated room' },
      ]) {
        expect(
          (await failureOf(() => store.saveRecords('offers', [offer]))).code
        ).toBe('offer-budget-exhausted');
      }
      expect(await store.listOffers()).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects duplicate write IDs and malformed schema markers', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-invalid-write-'));
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      const offer = syntheticOffers(1)[0];
      expect(
        (await failureOf(() => store.saveRecords('offers', [offer, offer])))
          .message
      ).toBe('Canonical offer collection contains duplicate offer IDs.');
      await writeFile(
        join(directory, '.state-schema.json'),
        '{"schemaVersion":0}\n'
      );
      expect(
        (await failureOf(() => store.saveOffers(syntheticOffers(30)))).message
      ).toBe('Data schema marker has an invalid version.');
      expect(await store.listOffers()).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps the committed index if stale-chunk cleanup fails', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-prune-failure-'));
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await store.saveOffers(syntheticOffers(30));
      let attempted = 0;
      await writeOfferCollection({
        directory,
        maxBytes: 50_000_000,
        maxShardBytes: 32_000,
        offers: syntheticOffers(1),
        offersPath: store.offersPath,
        removeStaleChunk: async () => {
          attempted += 1;
          throw new Error('synthetic cleanup failure');
        },
      });
      expect(attempted).toBe(1);
      expect((await store.listOffers()).length).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('commits an empty index after deleting every indexed offer', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-empty-index-'));
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      const oldOffers = syntheticOffers(30).map((offer) => ({
        ...offer,
        collectedAt: '2020-01-01T00:00:00.000Z',
        postedAt: '2020-01-01T00:00:00.000Z',
      }));
      await store.saveOffers(oldOffers);
      const index = JSON.parse(
        await readFile(join(directory, 'offers.index.json'), 'utf8')
      );
      expect(index.count).toBe(30);
      const constrained = new LinksStore({
        directory,
        maxBytes: 0,
        maxOfferShardBytes: 32_000,
      });
      await constrained.saveOffers([]);
      expect(await constrained.listOffers()).toEqual([]);
      expect(
        JSON.parse(await readFile(join(directory, 'offers.index.json'), 'utf8'))
          .shards
      ).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('fingerprints active indexed offers and snapshots canonical chunks without binary caches', async () => {
    if (isDeno) {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'offer-snapshot-'));
    const directory = join(root, 'data');
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await store.saveOffers(syntheticOffers(30));
      const index = JSON.parse(
        await readFile(join(directory, 'offers.index.json'), 'utf8')
      );
      const chunk = join(directory, 'offers.chunks', index.shards[0].sha256);
      await mkdir(join(chunk, '.binary'));
      await writeFile(join(chunk, '.binary', 'cache'), 'rebuildable');
      const before = await stateFingerprint(directory);
      expect(before.collections.offers.records).toBe(30);
      expect(before.binaryFiles).toBe(1);
      const manifest = await snapshotState(directory, join(root, 'snapshot'));
      expect(
        manifest.files.some(({ path }) => path === 'offers.index.json')
      ).toBe(true);
      expect(
        manifest.files.some(({ path }) => path.endsWith('offers.lino'))
      ).toBe(true);
      expect(manifest.files.some(({ path }) => path.includes('.binary'))).toBe(
        false
      );
      await store.saveOffers(syntheticOffers(31));
      expect(
        compareFingerprints(before, await stateFingerprint(directory))
          .changedCollections
      ).toEqual(['offers']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps generic record APIs on the active offer index', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-generic-api-'));
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 32_000 });
      await store.saveOffers(syntheticOffers(30));
      expect((await store.loadRecords('offers')).length).toBe(30);
      expect(
        (await store.queryRecords('offers', { path: 'id', value: 'offer-5' }))
          .length
      ).toBe(1);
      await store.updateRecords('offers', (offers) =>
        offers.filter(({ id }) => id !== 'offer-5')
      );
      expect(
        await store.queryRecords('offers', { path: 'id', value: 'offer-5' })
      ).toEqual([]);
      await store.saveRecords('offers', syntheticOffers(2));
      expect((await store.listOffers()).length).toBe(2);
      expect((await store.loadRecords('offers')).length).toBe(2);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
