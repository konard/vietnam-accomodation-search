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

describe('merged accommodation search service', () => {
  it('searches merged Telegram variants and normalized array fields', async () => {
    const store = memoryStore([
      {
        attributes: {
          amenities: ['pool', 'sea-view'],
          labeledFields: { neighborhood: ['Vĩnh Hải'] },
        },
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'matching',
        priceVnd: 600_000,
        sourceType: 'telegram',
        title: 'Rental',
        variants: [{ raw: { caption: 'Căn hộ Nha Trang gần biển' } }],
      },
      {
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'different',
        priceVnd: 500_000,
        raw: { text: 'Da Nang room' },
        sourceType: 'telegram',
        title: 'Other rental',
      },
    ]);
    const service = new SearchService({
      collector: { collect: async () => [] },
      now: () => new Date('2026-09-21T00:30:00Z'),
      registry: { list: async () => [] },
      store,
    });

    const results = await service.search({
      filters: { amenities: 'SEA', neighborhood: 'vinh hai' },
      query: 'nha trang',
      refresh: false,
    });
    expect(results.map((offer) => offer.id)).toEqual(['matching']);
  });

  it('recognizes all source aliases in a merged cached offer', async () => {
    let collections = 0;
    const store = memoryStore([
      {
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'merged',
        priceVnd: 500_000,
        sourceIds: ['web-a', 'telegram-a'],
        title: 'Merged room',
      },
    ]);
    const service = new SearchService({
      collector: {
        collect: async () => {
          collections += 1;
          return [];
        },
      },
      now: () => new Date('2026-09-21T01:00:00Z'),
      registry: {
        list: async () => [{ id: 'web-a' }, { id: 'telegram-a' }],
      },
      store,
    });

    expect((await service.search()).length).toBe(1);
    expect(collections).toBe(0);
  });

  it('saves cache metadata again after media eviction', async () => {
    let saves = 0;
    const store = {
      listOffers: async () => [],
      saveOffers: async () => {
        saves += 1;
      },
    };
    const service = new SearchService({
      collector: { collect: async () => [] },
      mediaCache: {
        cacheOffers: async (offers) => offers,
        enforceBudget: async () => ({ removed: ['old-photo'] }),
      },
      registry: { list: async () => [] },
      store,
    });

    await service.search();
    expect(saves).toBe(2);
  });
});
