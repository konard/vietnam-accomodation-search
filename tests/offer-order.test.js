import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';

import { LinksStore } from '../src/links-store.js';

const isDeno = typeof globalThis.Deno !== 'undefined';
const input = Array.from({ length: 24 }, (_, index) => ({
  collectedAt: new Date(2026, 8, 30, 0, index).toISOString(),
  id: `offer-${index}`,
  sourceId: 'order-test',
  text: 'Synthetic room '.repeat(20),
}));

describe('offer collection order contract', () => {
  for (const maxOfferShardBytes of [5_000, 1_000_000]) {
    it(`preserves save, query, update, merge and restart order with ${maxOfferShardBytes} byte shards`, async () => {
      if (isDeno) {
        return;
      }
      const directory = await mkdtemp(join(tmpdir(), 'offer-order-'));
      try {
        const store = new LinksStore({ directory, maxOfferShardBytes });
        await store.saveRecords('offers', input);
        expect(await store.loadRecords('offers')).toEqual(input);
        expect(
          await store.queryRecords('offers', {
            path: 'sourceId',
            value: 'order-test',
          })
        ).toEqual(input);
        const reversed = [...input].reverse();
        await store.updateRecords('offers', () => reversed);
        expect(await store.listOffers()).toEqual(reversed);
        const restarted = new LinksStore({ directory, maxOfferShardBytes });
        expect(await restarted.listOffers()).toEqual(reversed);
        await restarted.saveOffers([{ id: 'appended', sourceId: 'other' }]);
        expect((await restarted.listOffers()).map(({ id }) => id)).toEqual([
          ...reversed.map(({ id }) => id),
          'appended',
        ]);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    });
  }

  it('reuses identical canonical chunks when only public order changes and rejects corrupt order metadata', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-order-index-'));
    try {
      const store = new LinksStore({ directory, maxOfferShardBytes: 2_000 });
      const path = join(directory, 'offers.index.json');
      await store.saveRecords('offers', input);
      const first = JSON.parse(await readFile(path, 'utf8'));
      await store.saveRecords('offers', [...input].reverse());
      const second = JSON.parse(await readFile(path, 'utf8'));
      expect(second.shards).toEqual(first.shards);
      expect(second.order).toEqual(input.map(({ id }) => id).reverse());
      for (const order of [
        [],
        {},
        [42, ...second.order.slice(1)],
        [...second.order.slice(1), second.order[1]],
        [...second.order.slice(1), 'missing'],
      ]) {
        await writeFile(path, JSON.stringify({ ...second, order }));
        let failed = false;
        try {
          await store.listOffers();
        } catch {
          failed = true;
        }
        expect(failed).toBe(true);
      }
      const legacy = { ...second };
      delete legacy.order;
      await writeFile(path, JSON.stringify(legacy));
      // Older indexes did not retain insertion order. Preserve their historical
      // time/ID read order until the next write supplies explicit order.
      expect(await store.listOffers()).toEqual([...input].reverse());
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
