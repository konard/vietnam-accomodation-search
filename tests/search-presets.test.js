import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  LinksStore,
  SearchPresetService,
  TelegramSubscriptionService,
  parseSearchCommand,
  parseSearchOverrides,
} from '../src/index.js';

function memoryStateStore(initial = { users: {} }) {
  let state = initial;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  return {
    loadSearchState: async () => clone(state),
    saveSearchState: async (next) => {
      state = clone(next);
    },
  };
}

async function capturedFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
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

  it('validates missing, conflicting, and malformed command options', () => {
    expect(() => parseSearchCommand('/search --limit')).toThrow();
    expect(() => parseSearchCommand('/search --type ***')).toThrow();
    expect(() => parseSearchCommand('/search --cheapest --newest')).toThrow();
    expect(parseSearchCommand('/search --limit 2 Hue')).toEqual({
      cheapest: false,
      limit: 2,
      query: 'Hue',
    });
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

  it('validates identifiers and every protected preset transition', async () => {
    const presets = new SearchPresetService({ store: memoryStateStore() });

    expect(
      (await capturedFailure(() => presets.list('user'))).message
    ).toContain('numeric');
    expect(
      (await capturedFailure(() => presets.save(42, 'bad name'))).message
    ).toContain('Preset names');
    expect(
      (await capturedFailure(() => presets.resolve(42, {}, 'missing'))).message
    ).toContain('not found');
    expect(
      (await capturedFailure(() => presets.use(42, 'missing'))).message
    ).toContain('not found');
    expect(
      (await capturedFailure(() => presets.remove(42, 'default'))).message
    ).toContain('default');
    expect(
      (await capturedFailure(() => presets.remove(42, 'missing'))).message
    ).toContain('not found');
    expect(
      (await capturedFailure(() => presets.subscribe(42, 'missing'))).message
    ).toContain('not found');

    await presets.save(42, 'temporary', { query: 'Hue' });
    await presets.use(42, 'temporary');
    expect(await presets.remove(42, 'temporary')).toBe('temporary');
    expect((await presets.list(42))[0].active).toBe(true);
    expect(await presets.unsubscribe(42)).toBe(undefined);
    await presets.markShown(42, [{}, { id: '' }]);
  });

  it('repairs incomplete persisted user state and lists active subscriptions', async () => {
    const store = memoryStateStore({ users: { 7: {} } });
    const presets = new SearchPresetService({
      now: () => new Date('2026-09-22T00:00:00.000Z'),
      store,
    });

    expect(await presets.resolve(7)).toEqual({});
    await presets.subscribe(7);
    expect(await presets.activeSubscriptions()).toEqual([
      { id: '7', preset: 'default' },
    ]);
    expect(await presets.unsubscribe(7)).toEqual({
      preset: 'default',
      startedAt: '2026-09-22T00:00:00.000Z',
    });
  });

  it('persists compatibility search state through text and binary mirrors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'search-state-'));
    const calls = [];
    const mirror = {
      ensure: async ({ kind }) => calls.push(`ensure:${kind}`),
      stage: async ({ kind }) => ({
        activate: async () => calls.push(`activate:${kind}`),
      }),
    };
    try {
      const store = new LinksStore({ directory, mirror });
      const state = { users: { 42: { activePreset: 'default' } } };
      await store.saveSearchState(state);
      expect(await store.loadSearchState()).toEqual({
        id: 'telegram',
        ...state,
      });
      expect(calls).toEqual(['activate:search-state', 'ensure:search-state']);

      const plain = new LinksStore({ directory: join(directory, 'plain') });
      expect(await plain.loadSearchState()).toEqual({ users: {} });
      await plain.saveSearchState({ users: {} });
      expect(await plain.loadSearchState()).toEqual({
        id: 'telegram',
        users: {},
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('isolates subscription failures and owns one timer lifecycle', async () => {
    const failures = [];
    const subscriptions = new TelegramSubscriptionService({
      intervalMs: 60_000,
      logger: { error: (message) => failures.push(message) },
      presets: {
        activeSubscriptions: async () => [{ id: '7', preset: 'default' }],
        resolve: async () => {
          throw new Error('offline');
        },
      },
      search: { search: async () => [] },
    });

    subscriptions.running = true;
    expect(await subscriptions.runOnce()).toBe(undefined);
    subscriptions.running = false;
    await subscriptions.runOnce();
    expect(failures[0]).toContain('offline');
    subscriptions.start();
    const timer = subscriptions.timer;
    subscriptions.start();
    expect(subscriptions.timer).toBe(timer);
    subscriptions.stop();
    subscriptions.stop();
    expect(subscriptions.timer).toBe(undefined);
  });
});
