import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinksStore } from '../src/links-store.js';

describe('bounded canonical offer access', () => {
  it('streams projections and top-k, rejects corrupt shards and retains the previous commit after cancellation', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-stream-'));
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 8192 });
      async function* records() {
        for (let i = 0; i < 40; i++) {
          yield {
            id: `offer-${i}`,
            sourceId: 'synthetic',
            title: `Rental ${i}`,
            priceVnd: 40 - i,
            collectedAt: '2026-01-01T00:00:00Z',
            raw: { text: 'synthetic raw evidence' },
          };
        }
      }
      await store.replaceOffersFromStream(records());
      const eager = await store.listOffers();
      const projected = [];
      for await (const id of store.iterOffers({
        project: (offer) => offer.id,
      })) {
        projected.push(id);
      }
      assert.deepEqual(
        [...projected].sort(),
        eager.map((offer) => offer.id).sort()
      );
      assert.deepEqual(
        (await store.topOffers({ limit: 3 })).map((offer) => offer.priceVnd),
        [1, 2, 3]
      );
      const indexPath = join(directory, 'offers.index.json');
      const before = await readFile(indexPath, 'utf8');
      const controller = new AbortController();
      async function* cancelled() {
        yield { id: 'new' };
        controller.abort();
        yield { id: 'another' };
      }
      await assert.rejects(
        store.replaceOffersFromStream(cancelled(), {
          signal: controller.signal,
        }),
        { name: 'AbortError' }
      );
      assert.equal(await readFile(indexPath, 'utf8'), before);
      const index = JSON.parse(before);
      const path = join(
        directory,
        'offers.chunks',
        index.shards[0].sha256,
        'offers.lino'
      );
      await writeFile(path, 'corrupted');
      await assert.rejects(store.topOffers({ limit: 3 }), /checksum/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
