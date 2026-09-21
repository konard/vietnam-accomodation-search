import { describe, expect, it } from 'test-anywhere';

import { SearchService } from '../src/index.js';

function memoryStore(initial = []) {
  const offers = [...initial];
  return {
    offers,
    async listOffers() {
      return [...offers];
    },
    async saveOffers(incoming) {
      offers.push(...incoming);
    },
  };
}

describe('accommodation search service', () => {
  it('pre-caches every configured source on the first search', async () => {
    const store = memoryStore();
    const calls = [];
    const sources = [
      { id: 'web-a', type: 'web' },
      { id: 'telegram-a', type: 'telegram' },
    ];
    const service = new SearchService({
      collector: {
        collect: async (requestedSources, query) => {
          calls.push({ requestedSources, query });
          return [
            {
              id: 'expensive',
              sourceId: 'web-a',
              title: 'Hotel',
              priceVnd: 2000000,
              collectedAt: '2026-09-21T00:00:00.000Z',
            },
            {
              id: 'cheap',
              sourceId: 'telegram-a',
              title: 'Room',
              priceVnd: 500000,
              collectedAt: '2026-09-21T00:00:00.000Z',
            },
          ];
        },
      },
      now: () => new Date('2026-09-21T00:00:00Z'),
      registry: { list: async () => sources },
      store,
    });

    const results = await service.search({
      cheapest: true,
      limit: 1,
      query: 'Da Nang',
    });

    expect(calls.length).toBe(1);
    expect(calls[0].requestedSources).toEqual(sources);
    expect(results.map((offer) => offer.id)).toEqual(['cheap']);
  });

  it('uses a fresh cache without running a second collection', async () => {
    const store = memoryStore([
      {
        id: 'cached',
        title: 'Cached room',
        priceVnd: 700000,
        collectedAt: '2026-09-21T00:00:00.000Z',
      },
    ]);
    let collections = 0;
    const service = new SearchService({
      collector: {
        collect: async () => {
          collections += 1;
          return [];
        },
      },
      now: () => new Date('2026-09-21T01:00:00Z'),
      registry: { list: async () => [] },
      store,
    });

    const results = await service.search({ cheapest: true, limit: 10 });

    expect(collections).toBe(0);
    expect(results.length).toBe(1);
  });

  it('deduplicates offers and orders converted VND prices', async () => {
    const store = memoryStore([
      { id: 'same', title: 'old', priceVnd: 900000 },
      { id: 'same', title: 'new', priceVnd: 800000 },
      { id: 'other', title: 'other', priceVnd: 500000 },
      { id: 'unknown', title: 'unknown', priceVnd: null },
    ]);
    const service = new SearchService({
      collector: { collect: async () => [] },
      registry: { list: async () => [] },
      store,
    });

    const results = await service.search({
      cheapest: true,
      limit: 10,
      refresh: false,
    });

    expect(results.map((offer) => offer.id)).toEqual(['other', 'same']);
    expect(results[1].title).toBe('new');
  });

  it('refreshes web results when the requested location changes', async () => {
    const store = memoryStore([
      {
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'da-nang',
        priceVnd: 500000,
        searchQuery: 'Da Nang',
        sourceId: 'web-a',
        title: 'Da Nang room',
      },
    ]);
    let collections = 0;
    const service = new SearchService({
      collector: {
        collect: async () => {
          collections += 1;
          return [
            {
              collectedAt: '2026-09-21T01:00:00.000Z',
              id: 'nha-trang',
              priceVnd: 600000,
              searchQuery: 'Nha Trang',
              sourceId: 'web-a',
              title: 'Nha Trang room',
            },
          ];
        },
      },
      now: () => new Date('2026-09-21T01:00:00Z'),
      registry: { list: async () => [{ id: 'web-a', type: 'web' }] },
      store,
    });

    const results = await service.search({
      cheapest: true,
      limit: 10,
      query: 'Nha Trang',
    });

    expect(collections).toBe(1);
    expect(results.map((offer) => offer.id)).toEqual(['nha-trang']);
  });
});
