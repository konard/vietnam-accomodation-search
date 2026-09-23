import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  LinksStore,
  PresetService,
  SearchService,
  SubscriptionScheduler,
  deliverSubscriptionOffers,
  parseSearchCommand,
  registerTelegramHandlers,
} from '../src/index.js';

async function capturedFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

function searchService(offers) {
  return new SearchService({
    collector: { collect: async () => [] },
    registry: { list: async () => [] },
    store: { listOffers: async () => offers },
  });
}

describe('named accommodation filters', () => {
  it('parses every typed range independently in any order', () => {
    expect(
      parseSearchCommand(
        '/search --max-per-bed-vnd 5000000 --types studio,hotel --min-rooms 1 --max-rooms 3 --min-total-vnd 6000000 --max-total-vnd 15000000 --min-per-room-vnd 3000000 --max-per-room-vnd 8000000 --min-per-bed-vnd 2000000 Nha Trang'
      )
    ).toEqual({
      cheapest: false,
      limit: 10,
      maxPerBedVnd: 5_000_000,
      maxPerRoomVnd: 8_000_000,
      maxRooms: 3,
      maxTotalVnd: 15_000_000,
      minPerBedVnd: 2_000_000,
      minPerRoomVnd: 3_000_000,
      minRooms: 1,
      minTotalVnd: 6_000_000,
      query: 'Nha Trang',
      types: ['studio', 'hotel'],
    });
  });

  it('distinguishes rooms, bedrooms, and beds and rejects missing counts', async () => {
    const offers = [
      {
        attributes: { bedrooms: 1, beds: 2, rooms: 2 },
        id: 'suite',
        priceVnd: 10_000_000,
        kind: 'hotel',
      },
      {
        attributes: { bedrooms: 1 },
        id: 'studio',
        priceVnd: 8_000_000,
        kind: 'studio',
      },
      {
        attributes: { bedrooms: 2, beds: 1, rooms: 1 },
        id: 'odd-layout',
        priceVnd: 6_000_000,
        kind: 'apartment',
      },
    ];
    const result = await searchService(offers).search({
      maxPerBedVnd: 5_000_000,
      maxPerRoomVnd: 5_000_000,
      minRooms: 2,
      refresh: false,
      types: ['hotel', 'studio'],
    });
    expect(result.map(({ id }) => id)).toEqual(['suite']);
  });

  it('validates ranges without conflating a studio with a room count', () => {
    expect(() => parseSearchCommand('/search --min-rooms -1')).toThrow();
    expect(() =>
      parseSearchCommand('/search --min-total-vnd 10 --max-total-vnd 5')
    ).toThrow();
    expect(parseSearchCommand('/search --types studio').types).toEqual([
      'studio',
    ]);
    expect(
      parseSearchCommand('/search --max-total-vnd 9000000', {
        defaults: false,
      })
    ).toEqual({ maxTotalVnd: 9_000_000 });
  });
});

describe('persisted presets and subscriptions', () => {
  it('delivers bounded subscription text and no more than ten photos per offer', async () => {
    const messages = [];
    const albums = [];
    await deliverSubscriptionOffers(
      {
        sendMediaGroup: async (chatId, media) => albums.push([chatId, media]),
        sendMessage: async (chatId, text) => messages.push([chatId, text]),
      },
      '42',
      [
        {
          id: 'long',
          photos: Array.from({ length: 12 }, (_, index) => `photo-${index}`),
          price: { period: 'month' },
          priceVnd: 5_000_000,
          title: 'x'.repeat(5000),
          url: 'https://example.test/long',
        },
      ]
    );
    expect(messages.length).toBe(2);
    expect(messages.every(([, text]) => text.length <= 4096)).toBe(true);
    expect(albums[0][0]).toBe('42');
    expect(albums[0][1].length).toBe(10);
  });

  it('resumes a partially delivered offer without repeating confirmed text', async () => {
    const records = new Map();
    const store = {
      loadRecords: async (kind) => records.get(kind) || [],
      saveRecords: async (kind, values) => records.set(kind, values),
    };
    let messages = 0;
    let mediaAttempts = 0;
    const api = {
      sendMediaGroup: async () => {
        mediaAttempts += 1;
        if (mediaAttempts === 1) {
          throw new Error('media interrupted');
        }
      },
      sendMessage: async () => {
        messages += 1;
      },
    };
    const offer = {
      id: 'resume-me',
      photos: ['https://example.test/photo.jpg'],
      price: { period: 'month' },
      priceVnd: 5_000_000,
      title: 'Room',
    };
    let error;
    try {
      await deliverSubscriptionOffers(api, '42', [offer], { store });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('media interrupted');
    await deliverSubscriptionOffers(api, '42', [offer], { store });
    expect(messages).toBe(1);
    expect(mediaAttempts).toBe(2);
  });

  it('persists subscription progress with an atomic store transaction', async () => {
    const records = [];
    let transactions = 0;
    const store = {
      loadRecords: async () => records,
      updateRecords: async (_kind, update) => {
        transactions += 1;
        records.splice(0, records.length, ...(await update([...records])));
      },
    };
    await deliverSubscriptionOffers(
      { sendMessage: async () => {} },
      '42',
      [{ id: 'atomic', priceVnd: 1, title: 'Room' }],
      { store }
    );
    expect(transactions).toBe(1);
    expect(records.length).toBe(1);
  });

  it('survives restart and protects active or subscribed presets', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'presets-'));
    try {
      const first = new PresetService({
        store: new LinksStore({ binaryMirror: false, directory }),
      });
      await first.save('100', 'beach', {
        maxTotalVnd: 12_000_000,
        query: 'Nha Trang',
      });
      await first.use('100', 'beach');

      const restarted = new PresetService({
        store: new LinksStore({ binaryMirror: false, directory }),
      });
      expect((await restarted.activeOptions('100')).query).toBe('Nha Trang');
      let error;
      try {
        await restarted.delete('100', 'beach');
      } catch (caught) {
        error = caught;
      }
      expect(error.message).toContain('active');
      await restarted.subscribe('100', 'beach');
      await restarted.use('100', 'default');
      try {
        await restarted.delete('100', 'beach');
      } catch (caught) {
        error = caught;
      }
      expect(error.message).toContain('subscribed');
      await restarted.unsubscribe('100');
      await restarted.delete('100', 'beach');
      expect((await restarted.list('100')).map(({ name }) => name)).toEqual([
        'default',
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('merges one-shot search overrides without mutating the active preset', async () => {
    const records = new Map();
    const store = {
      loadRecords: async (kind) => records.get(kind) || [],
      saveRecords: async (kind, value) => records.set(kind, value),
    };
    const presets = new PresetService({ store });
    await presets.save('7', 'monthly', {
      maxTotalVnd: 10_000_000,
      query: 'Da Nang',
    });
    await presets.save('7', 'bãi-biển', { query: 'Nha Trang' });
    await presets.save('7', 'у-моря', { query: 'Нячанг' });
    await presets.use('7', 'monthly');
    expect(await presets.resolveSearch('7', { query: 'Nha Trang' })).toEqual({
      maxTotalVnd: 10_000_000,
      query: 'Nha Trang',
    });
    expect((await presets.activeOptions('7')).query).toBe('Da Nang');
    await presets.save('7', 'filtered', {
      filters: { bedrooms: 2 },
      minRooms: 1,
    });
    await presets.use('7', 'filtered');
    await presets.save('7', 'more-filtered', {
      filters: { petsAllowed: true },
    });
    expect((await presets.show('7', 'more-filtered')).options).toEqual({
      filters: { bedrooms: 2, petsAllowed: true },
      maxTotalVnd: 10_000_000,
      minRooms: 1,
      query: 'Da Nang',
    });
    expect(
      (await capturedFailure(() => presets.save('7', 'default'))).message
    ).toContain('cannot be overwritten');
    expect((await presets.list('7')).map(({ name }) => name)).toEqual([
      'default',
      'bãi-biển',
      'filtered',
      'monthly',
      'more-filtered',
      'у-моря',
    ]);
  });

  it('groups identical feeds and marks aliases only after confirmed delivery', async () => {
    const records = new Map();
    const store = {
      loadRecords: async (kind) => records.get(kind) || [],
      saveRecords: async (kind, value) => records.set(kind, value),
    };
    const presets = new PresetService({ store });
    await presets.save('1', 'same', { query: 'Nha Trang' });
    await presets.save('2', 'same', { query: 'Nha Trang' });
    await presets.subscribe('1', 'same');
    await presets.subscribe('2', 'same');
    let searches = 0;
    const deliveries = [];
    const scheduler = new SubscriptionScheduler({
      deliver: async (userId, offers) => {
        deliveries.push([userId, offers.map(({ id }) => id)]);
        if (userId === '2' && deliveries.length === 2) {
          throw new Error('Telegram unavailable after send attempt');
        }
      },
      now: () => new Date('2026-09-22T10:00:00Z'),
      presets,
      search: async () => {
        searches += 1;
        return [
          {
            collectedAt: '2026-09-22T09:00:00Z',
            id: 'room-1',
            identityKeys: ['url:https://example/1'],
          },
        ];
      },
    });

    await scheduler.tick();
    expect(searches).toBe(1);
    expect(deliveries.length).toBe(2);
    expect((await presets.unseen('1', [{ id: 'room-1' }])).length).toBe(0);
    expect((await presets.unseen('2', [{ id: 'room-1' }])).length).toBe(1);
    await scheduler.tick();
    expect(searches).toBe(2);
    expect(deliveries.at(-1)).toEqual(['2', ['room-1']]);
  });

  it('upserts a delivery cursor when the same offer is delivered again', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'delivery-cursor-'));
    let now = new Date('2026-09-23T00:00:00.000Z');
    const store = new LinksStore({ binaryMirror: false, directory });
    const presets = new PresetService({ now: () => now, store });
    const offer = {
      id: 'same-offer',
      identityKeys: ['url:https://example.test/same-offer'],
      url: 'https://example.test/same-offer',
      variants: [{ id: 'same-offer', url: 'https://example.test/same-offer' }],
    };
    try {
      await presets.markDelivered('123', [offer]);
      now = new Date('2026-09-23T00:01:00.000Z');
      await presets.markDelivered('123', [offer]);

      expect(await store.loadRecords('shown-offers')).toEqual([
        {
          aliases: [
            'https://example.test/same-offer',
            'same-offer',
            'url:https://example.test/same-offer',
          ],
          deliveredAt: '2026-09-23T00:01:00.000Z',
          id: '123:https://example.test/same-offer',
          userId: '123',
        },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('suppresses restart duplicates from a prepared delivery cursor', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'prepared-delivery-'));
    const offer = { id: 'prepared-offer', url: 'https://example.test/room' };
    try {
      const first = new PresetService({
        store: new LinksStore({ binaryMirror: false, directory }),
      });
      await first.prepareDelivery('123', [offer]);

      const restarted = new PresetService({
        store: new LinksStore({ binaryMirror: false, directory }),
      });
      expect(await restarted.unseen('123', [offer])).toEqual([]);
      const [cursor] = await new LinksStore({
        binaryMirror: false,
        directory,
      }).loadRecords('shown-offers');
      expect(cursor.deliveryState).toBe('prepared');
      expect(cursor.deliveredAt).toBe(undefined);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('delivers only offers with a verifiable fresh collection time', async () => {
    const delivered = [];
    const scheduler = new SubscriptionScheduler({
      deliver: async (_userId, offers) => delivered.push(...offers),
      maxAgeMs: 60 * 60 * 1000,
      now: () => new Date('2026-09-22T10:00:00Z'),
      presets: {
        listSubscriptions: async () => [{ options: {}, userId: '1' }],
        markDelivered: async () => {},
        markSuccessfulRun: async () => {},
        unseen: async (_userId, offers) => offers,
      },
      search: async () => [
        { collectedAt: '2026-09-22T09:30:00Z', id: 'fresh' },
        { collectedAt: '2026-09-22T08:59:59Z', id: 'stale' },
        { id: 'unknown-age' },
      ],
    });

    await scheduler.tick();
    expect(delivered.map(({ id }) => id)).toEqual(['fresh']);
  });

  it('does not overlap scheduler ticks', async () => {
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const presets = {
      listSubscriptions: async () => [{ options: {}, userId: '1' }],
      markDelivered: async () => {},
      markSuccessfulRun: async () => {},
      unseen: async (_userId, offers) => offers,
    };
    let calls = 0;
    const scheduler = new SubscriptionScheduler({
      deliver: async () => {},
      presets,
      search: async () => {
        calls += 1;
        await blocked;
        return [];
      },
    });
    const first = scheduler.tick();
    const second = scheduler.tick();
    expect(first).toBe(second);
    release();
    await first;
    expect(calls).toBe(1);
  });

  it('exposes the complete preset and subscription command surface', async () => {
    const commands = new Map();
    const bot = {
      command: (name, handler) => commands.set(name, handler),
      on: () => {},
    };
    const calls = [];
    const presetService = {
      activeName: async () => 'beach',
      delete: async (...arguments_) => calls.push(['delete', ...arguments_]),
      list: async () => [{ name: 'beach', options: { query: 'Nha Trang' } }],
      resolveSearch: async (_userId, options) => ({
        maxTotalVnd: 10_000_000,
        ...options,
      }),
      save: async (...arguments_) => calls.push(['save', ...arguments_]),
      show: async () => ({ name: 'beach', options: { query: 'Nha Trang' } }),
      subscribe: async (...arguments_) =>
        calls.push(['subscribe', ...arguments_]),
      subscription: async () => ({ presetName: 'beach' }),
      unsubscribe: async (...arguments_) =>
        calls.push(['unsubscribe', ...arguments_]),
      use: async (...arguments_) => calls.push(['use', ...arguments_]),
    };
    const searches = [];
    registerTelegramHandlers(bot, {
      presetService,
      registry: { update: async () => ({ telegram: [], web: [] }) },
      service: {
        search: async (options) => {
          searches.push(options);
          return [];
        },
      },
    });
    const replies = [];
    const context = {
      from: { id: 42 },
      reply: async (text) => replies.push(text),
    };

    context.match = 'Nha Trang';
    await commands.get('search')(context);
    context.match = 'list';
    await commands.get('preset')(context);
    context.match = 'show beach';
    await commands.get('preset')(context);
    context.match = 'save beach --max-total-vnd 9000000 Nha Trang';
    await commands.get('preset')(context);
    context.match = 'use beach';
    await commands.get('preset')(context);
    context.match = 'delete beach';
    await commands.get('preset')(context);
    context.match = 'beach';
    await commands.get('subscribe')(context);
    await commands.get('subscription')(context);
    await commands.get('unsubscribe')(context);

    expect(searches[0].maxTotalVnd).toBe(10_000_000);
    expect(searches[0].cheapest).toBe(undefined);
    expect(searches[0].limit).toBe(undefined);
    expect(calls.map(([name]) => name)).toEqual([
      'save',
      'use',
      'delete',
      'subscribe',
      'unsubscribe',
    ]);
    expect(commands.has('preset')).toBe(true);
    expect(commands.has('subscribe')).toBe(true);
    expect(commands.has('unsubscribe')).toBe(true);
    expect(commands.has('subscription')).toBe(true);
    expect(replies.join('\n')).toContain('beach');
  });
});
