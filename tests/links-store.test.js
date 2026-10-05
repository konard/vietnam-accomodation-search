import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  LinksStore,
  deserializeOffers,
  deserializeSources,
  serializeOffers,
  serializeSources,
} from '../src/index.js';

describe('Links Notation persistence', () => {
  it('round-trips normalized offers and the complete raw record', () => {
    const offers = [
      {
        id: 'offer-1',
        sourceId: 'telegram:rent',
        title: "Owner's sea-view studio",
        kind: 'room',
        location: 'Đà Nẵng',
        price: { amount: 400, currency: 'USD', period: 'month' },
        priceVnd: 10200000,
        url: 'https://t.me/rent/1',
        photos: ['https://img.example/a.jpg'],
        postedAt: '2026-09-20T12:00:00.000Z',
        collectedAt: '2026-09-21T00:00:00.000Z',
        raw: { text: 'raw\nmultilingual dữ liệu', views: 123 },
      },
    ];

    const notation = serializeOffers(offers);
    const restored = deserializeOffers(notation);

    expect(notation.startsWith('(offer')).toBe(true);
    expect(restored).toEqual(offers);
  });

  it('round-trips ranked source evidence', () => {
    const sources = [
      {
        id: 'telegram:rent',
        name: 'Vietnam rent',
        type: 'telegram',
        url: 'https://t.me/vietnam_rent',
        popularity: {
          metric: 'members',
          value: 12000,
          evidenceUrl: 'https://t.me/vietnam_rent',
          observedAt: '2026-09-21T00:00:00.000Z',
        },
      },
    ];

    expect(deserializeSources(serializeSources(sources))).toEqual(sources);
  });

  it('reads back what it wrote exactly as a fresh store parses it', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'store-read-back-'));
    const awkward = {
      collectedAt: '2026-09-21T00:00:00.000Z',
      empty: { list: [], map: {} },
      missing: undefined,
      nested: [[1, -0, 2.5e-7], [{ z: 1, a: null }], NaN],
      text: ` 'quoted" \\ % trailing:\n\tline `,
      zeta: true,
    };
    const offer = (id, title) => ({ ...awkward, id, sourceId: 'web', title });
    const snapshot = async (store) =>
      JSON.stringify([
        await store.listOffers(),
        await store.loadRecords('presets'),
      ]);
    try {
      const store = new LinksStore({ directory });
      await store.saveOffers([offer('a', 'One')]);
      await store.saveOffers([offer('b', 'Two'), offer('a', 'One again')]);
      await store.saveRecords('presets', [
        { ...awkward, id: 'p' },
        { ...awkward, id: 'p', zeta: false },
      ]);
      expect(await snapshot(store)).toBe(
        await snapshot(new LinksStore({ directory }))
      );
      await store.appendRecords('presets', [{ ...awkward, id: 'q' }]);
      await store.appendRecords('presets', [{ id: 7 }]);
      expect(await snapshot(store)).toBe(
        await snapshot(new LinksStore({ directory }))
      );
      await store.saveRecords('presets', [{ kind: 'no id' }, { id: '0' }]);
      expect(await snapshot(store)).toBe(
        await snapshot(new LinksStore({ directory }))
      );
      const [first] = await store.listOffers();
      first.title = 'changed by a caller';
      const [preset] = await store.loadRecords('presets');
      preset.kind = 'changed by a caller';
      expect(await snapshot(store)).toBe(
        await snapshot(new LinksStore({ directory }))
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
