import { describe, expect, it } from 'test-anywhere';

import {
  SearchPresetService,
  TelegramSubscriptionService,
  parseSearchCommand,
  parseSearchOverrides,
} from '../src/index.js';

function memoryStateStore() {
  let state = { users: {} };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  return {
    loadSearchState: async () => clone(state),
    saveSearchState: async (next) => {
      state = clone(next);
    },
  };
}

describe('advanced search options', () => {
  it('parses independent bounds, types, and VND price dimensions', () => {
    expect(
      parseSearchCommand(
        '/search --type apartment,house --min-rooms 1 --max-rooms 3 ' +
          '--max-price-per-room 8000000 --min-price-per-bed 2000000 ' +
          '--min-total-price 5000000 --max-total-price 18000000 Da Nang'
      )
    ).toEqual({
      cheapest: false,
      limit: 10,
      maxPricePerRoomVnd: 8000000,
      maxRooms: 3,
      maxTotalPriceVnd: 18000000,
      minPricePerBedVnd: 2000000,
      minRooms: 1,
      minTotalPriceVnd: 5000000,
      query: 'Da Nang',
      types: ['apartment', 'house'],
    });
  });

  it('returns only explicitly supplied one-time overrides', () => {
    expect(parseSearchOverrides('/search --newest Hanoi')).toEqual({
      cheapest: false,
      query: 'Hanoi',
    });
  });

  it('rejects inverted ranges', () => {
    expect(() =>
      parseSearchCommand('/search --min-rooms 4 --max-rooms 2')
    ).toThrow();
  });
});

describe('persisted search presets and subscriptions', () => {
  it('saves, activates, resolves, and protects named presets', async () => {
    const presets = new SearchPresetService({ store: memoryStateStore() });

    await presets.save(42, 'beach', {
      filters: { furnished: true },
      maxTotalPriceVnd: 15_000_000,
      query: 'Nha Trang',
    });
    await presets.use(42, 'beach');

    expect(
      await presets.resolve(42, { filters: { petsAllowed: true } })
    ).toEqual({
      filters: { furnished: true, petsAllowed: true },
      maxTotalPriceVnd: 15_000_000,
      query: 'Nha Trang',
    });
    expect((await presets.list(42))[0].active).toBe(true);
    await presets.subscribe(42, 'beach');
    let error;
    try {
      await presets.remove(42, 'beach');
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('subscription');
  });

  it('delivers only offers not previously shown to the user', async () => {
    const presets = new SearchPresetService({ store: memoryStateStore() });
    const deliveries = [];
    const subscriptions = new TelegramSubscriptionService({
      delivery: async (userId, offers) => deliveries.push({ offers, userId }),
      presets,
      search: {
        search: async () => [{ id: 'offer-1' }, { id: 'offer-2' }],
      },
    });
    await presets.subscribe(42);

    expect((await subscriptions.runFor(42, 'default')).length).toBe(2);
    expect((await subscriptions.runFor(42, 'default')).length).toBe(0);
    expect(deliveries.length).toBe(1);
  });
});
