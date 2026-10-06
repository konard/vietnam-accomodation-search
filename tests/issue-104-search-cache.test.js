import { describe, expect, it } from 'test-anywhere';
import { SearchService } from '../src/index.js';
import { summarizeOutcomes } from '../src/source-pool.js';
import { DEFAULT_TELEGRAM_SOURCES } from '../src/sources.js';
import {
  collectionKey,
  matchingSources,
  refreshSources,
} from '../src/search-refresh.js';
import {
  createTelegramBot,
  formatSearchFailures,
} from '../src/telegram-bot.js';

const NOW = new Date('2026-10-05T00:00:00Z');
const noTrace = { persist: async () => {}, record: () => {} };

function storeFixture() {
  const records = new Map();
  return {
    offers: [],
    async listOffers() {
      return this.offers;
    },
    async saveOffers(offers) {
      this.offers.push(...offers);
    },
    loadRecords: async (kind) => records.get(kind) || [],
    saveRecords: async (kind, values) => records.set(kind, values),
  };
}

function serviceFor(store, collector, sources, now = () => NOW) {
  return new SearchService({
    collector,
    now,
    registry: { list: async () => sources },
    store,
    traceRecorder: noTrace,
  });
}

describe('collection freshness and fair search scheduling (#104)', () => {
  it('excludes every seeded other-city channel, disabled sources, and keeps national sources', () => {
    const sources = matchingSources(
      [
        ...DEFAULT_TELEGRAM_SOURCES,
        { id: 'national' },
        { id: 'disabled', enabled: false },
      ],
      'Nha Trang'
    );
    for (const handle of [
      'apartmentforrentdanang',
      'danangrentaflat',
      'danang_home',
      'phuquoc_realestate',
      'phuquoc_rental',
      'hanoi_apartments',
      'saigon_apartments',
      'muine_rent',
    ]) {
      expect(sources.some(({ id }) => id === `telegram:${handle}`)).toBe(false);
    }
    expect(sources.some(({ id }) => id === 'national')).toBe(true);
    expect(sources.some(({ id }) => id === 'disabled')).toBe(false);
  });

  it('prioritizes never-attempted sources ahead of recent focused failures', () => {
    const states = [
      {
        id: collectionKey('failed', 'Nha Trang'),
        attemptedAt: NOW.toISOString(),
        status: 'error',
      },
    ];
    expect(
      refreshSources({
        offers: [],
        sources: [{ id: 'failed', focus: 'nha-trang' }, { id: 'new' }],
        query: 'Nha Trang',
        states,
        now: NOW,
        maxAgeMs: 1,
      }).map(({ id }) => id)
    ).toEqual(['new', 'failed']);
  });
  it('caches empty collections across service restarts and refreshes only stale sources', async () => {
    const store = storeFixture();
    const calls = [];
    const collector = {
      collectWithReport: async (sources, _query, { onSourceComplete }) => {
        calls.push(sources.map(({ id }) => id));
        const outcomes = sources.map(({ id }) => ({
          sourceId: id,
          status: 'empty',
          offers: 0,
        }));
        for (const outcome of outcomes) {
          await onSourceComplete({ offers: [], outcome });
        }
        return { offers: [], outcomes, summary: summarizeOutcomes(outcomes) };
      },
    };
    const sources = [{ id: 'a' }, { id: 'b' }];
    await serviceFor(store, collector, sources).search({ query: 'Nha Trang' });
    await serviceFor(store, collector, sources).search({ query: 'Nha Trang' });
    expect(calls).toEqual([['a', 'b']]);
    await serviceFor(store, collector, [...sources, { id: 'c' }]).search({
      query: 'Nha Trang',
    });
    expect(calls).toEqual([['a', 'b'], ['c']]);
    await serviceFor(
      store,
      collector,
      sources,
      () => new Date(NOW.getTime() + 7 * 3600_000)
    ).search({ query: 'Nha Trang' });
    expect(calls.at(-1)).toEqual(['a', 'b']);
  });

  it('persists independent query freshness through atomic record updates', async () => {
    const store = storeFixture();
    store.updateRecords = async (kind, update) => {
      const records = update(await store.loadRecords(kind));
      await store.saveRecords(kind, records);
      return records;
    };
    const calls = [];
    const service = serviceFor(
      store,
      {
        collectWithReport: async (_sources, query, { onSourceComplete }) => {
          calls.push(query);
          await onSourceComplete({
            offers: [],
            outcome: { sourceId: 'a', status: 'empty' },
          });
          return { offers: [], outcomes: [] };
        },
      },
      [{ id: 'a' }]
    );
    await service.search({ query: 'Nha Trang studio' });
    await service.search({ query: 'Nha Trang apartment' });
    await service.search({ query: 'Nha Trang studio' });
    expect(calls).toEqual(['Nha Trang studio', 'Nha Trang apartment']);
    expect((await store.loadRecords('search-collections')).length).toBe(2);
  });

  it('propagates foreground collection failures and allows a subsequent retry', async () => {
    const service = serviceFor(
      storeFixture(),
      {
        collect: async () => {
          throw new Error('foreground failed');
        },
      },
      [{ id: 'a' }]
    );
    const error = await service.search().catch((caught) => caught);
    expect(error.message).toBe('foreground failed');
    await service.waitForRefresh();
    service.collector.collect = async () => [];
    expect(await service.search()).toEqual([]);
  });

  it('observes a background trace persistence failure after returning cached offers', async () => {
    const store = storeFixture();
    store.offers = [
      {
        id: 'cache',
        sourceId: 'a',
        priceVnd: 2,
        collectedAt: NOW.toISOString(),
      },
    ];
    let finish;
    const gate = new Promise((resolve) => {
      finish = resolve;
    });
    const events = [];
    const service = serviceFor(
      store,
      {
        collect: async () => {
          await gate;
          return [];
        },
      },
      [{ id: 'b' }]
    );
    let writes = 0;
    service.trace = {
      record: (event) => events.push(event),
      persist: async () => {
        if (++writes > 1) {
          throw new Error('trace failed');
        }
      },
    };
    try {
      expect((await service.search({ cacheFirst: true }))[0].id).toBe('cache');
    } finally {
      finish();
      await service.waitForRefresh();
    }
    expect(events.some(({ stage }) => stage === 'background-trace')).toBe(true);
  });

  it('covers pending matching sources on the second bounded run and skips other cities', async () => {
    const store = storeFixture();
    const calls = [];
    const sources = [
      { id: 'foreign', geographicFocus: 'da-nang' },
      ...['a', 'b', 'c', 'd'].map((id) => ({
        id,
        geographicFocus: 'nha-trang',
      })),
    ];
    const collector = {
      collectWithReport: async (selected, _query, { onSourceComplete }) => {
        calls.push(selected.map(({ id }) => id));
        const outcomes = selected.map(({ id }, index) => ({
          sourceId: id,
          status: index < 2 ? 'empty' : 'pending',
          offers: 0,
        }));
        for (const outcome of outcomes.slice(0, 2)) {
          await onSourceComplete({ offers: [], outcome });
        }
        return { offers: [], outcomes, summary: summarizeOutcomes(outcomes) };
      },
    };
    await serviceFor(store, collector, sources).search({
      query: 'Nha Trang apartment',
    });
    await serviceFor(store, collector, sources).search({
      query: 'Nha Trang apartment',
    });
    expect(calls).toEqual([
      ['a', 'b', 'c', 'd'],
      ['c', 'd'],
    ]);
  });

  it('returns cached results while one shared refresh runs and waits for cleanup', async () => {
    const store = storeFixture();
    store.offers = [
      {
        id: 'cached',
        sourceId: 'a',
        priceVnd: 2_000_000,
        collectedAt: NOW.toISOString(),
      },
    ];
    let finish;
    let calls = 0;
    const gate = new Promise((resolve) => {
      finish = resolve;
    });
    const collector = {
      collectWithReport: async () => {
        calls += 1;
        await gate;
        return { offers: [], outcomes: [], summary: summarizeOutcomes([]) };
      },
    };
    const service = serviceFor(store, collector, [{ id: 'a' }, { id: 'b' }]);
    try {
      const result = await service.searchWithReport({ cacheFirst: true });
      expect(result.offers[0].id).toBe('cached');
      expect(result.report.refreshingSources).toEqual(['b']);
      await service.searchWithReport({ cacheFirst: true });
      expect(calls).toBe(1);
    } finally {
      finish();
      await service.waitForRefresh?.();
    }
  });

  it('observes background failures and tells the bot which sources are refreshing', async () => {
    const store = storeFixture();
    store.offers = [
      {
        id: 'cached',
        sourceId: 'a',
        priceVnd: 2_000_000,
        collectedAt: NOW.toISOString(),
      },
    ];
    const events = [];
    const service = serviceFor(
      store,
      {
        collect: async () => {
          throw new Error('collection failed');
        },
      },
      [{ id: 'b' }]
    );
    service.trace = {
      persist: async () => {},
      record: (event) => events.push(event),
    };
    const { report } = await service.searchWithReport({ cacheFirst: true });
    expect(formatSearchFailures(report)).toBe(
      'Showing cached results. Refreshing: b.'
    );
    await service.waitForRefresh();
    expect(
      events.some(
        ({ stage, status }) =>
          stage === 'background-refresh' && status === 'failure'
      )
    ).toBe(true);
    if (typeof globalThis.Deno === 'undefined') {
      let waited = false;
      const bot = await createTelegramBot('123456:ABC', {
        service: {
          waitForRefresh: async () => {
            waited = true;
          },
        },
      });
      await bot.resources[0].destroy();
      expect(waited).toBe(true);
    }
  });
});
