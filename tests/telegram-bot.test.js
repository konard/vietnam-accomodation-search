import { describe, expect, it } from 'test-anywhere';

import {
  createTelegramBot,
  formatSearchResults,
  registerTelegramHandlers,
} from '../src/index.js';

function fakeBot() {
  const commands = new Map();
  const listeners = new Map();
  return {
    command(name, handler) {
      commands.set(name, handler);
    },
    commands,
    listeners,
    on(name, handler) {
      listeners.set(name, handler);
    },
  };
}

describe('Telegram bot commands', () => {
  it('registers search, source update, and availability commands', () => {
    const bot = fakeBot();
    registerTelegramHandlers(bot, {
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: { search: async () => [] },
    });

    expect(bot.commands.has('search')).toBe(true);
    expect(bot.commands.has('update_sources')).toBe(true);
    expect(bot.commands.has('check_availability')).toBe(true);
  });

  it('sends an availability inquiry only after an explicit command', async () => {
    const bot = fakeBot();
    const checks = [];
    const replies = [];
    registerTelegramHandlers(bot, {
      availabilityService: {
        check: async (offerId, options) => {
          checks.push({ offerId, options });
          return { offerId, recipient: '@owner' };
        },
      },
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: { search: async () => [] },
    });

    expect(checks).toEqual([]);
    await bot.commands.get('check_availability')({
      match: 'offer-1 @owner',
      reply: async (text) => replies.push(text),
    });

    expect(checks).toEqual([
      { offerId: 'offer-1', options: { recipient: '@owner' } },
    ]);
    expect(replies[0]).toContain('Availability inquiry sent');
  });

  it('answers /search --cheapest 10 with ordered offers', async () => {
    const bot = fakeBot();
    const replies = [];
    const searchCalls = [];
    registerTelegramHandlers(bot, {
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: {
        search: async (options) => {
          searchCalls.push(options);
          return [
            {
              title: 'Studio',
              priceVnd: 7000000,
              price: { period: 'month' },
              url: 'https://example.com/studio',
              photos: [],
            },
          ];
        },
      },
    });

    await bot.commands.get('search')({
      match: '--cheapest 10 Da Nang',
      reply: async (text) => replies.push(text),
    });

    expect(searchCalls).toEqual([
      { cheapest: true, limit: 10, query: 'Da Nang' },
    ]);
    expect(replies[0]).toContain('7,000,000 VND/month');
    expect(replies[0]).toContain('https://example.com/studio');
  });

  it('keeps a sent result successful when the final cursor checkpoint fails', async () => {
    const bot = fakeBot();
    const replies = [];
    const events = [];
    let persisted = 0;
    registerTelegramHandlers(bot, {
      presetService: {
        markDelivered: async () => {
          throw new Error(
            'clink export verification failed (1 links missing, 0 unexpected links)'
          );
        },
        prepareDelivery: async () => {},
        resolveSearch: async (_userId, options) => options,
      },
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: {
        search: async () => [
          {
            id: 'offer-1',
            photos: [],
            price: { period: 'month' },
            priceVnd: 1_000_000,
            title: 'Prepared room',
          },
        ],
      },
      traceRecorder: {
        persist: async () => {
          persisted += 1;
        },
        record: (event) => events.push(event),
      },
    });

    await bot.commands.get('search')({
      from: { id: 123 },
      match: 'Nha Trang',
      reply: async (text) => replies.push(text),
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('Prepared room');
    expect(replies[0]).not.toContain('clink export verification failed');
    expect(replies[0]).not.toContain('Usage: /search');
    expect(events.at(-1).stage).toBe('delivery-cursor');
    expect(events.at(-1).status).toBe('degraded');
    expect(persisted).toBe(1);
  });

  it('contains search, preparation, result, and media boundary failures', async () => {
    const offer = {
      id: 'offer-1',
      photos: ['https://img.example/room.jpg'],
      priceVnd: 1_000_000,
      title: 'Prepared room',
    };

    const searchBot = fakeBot();
    const searchReplies = [];
    registerTelegramHandlers(searchBot, {
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: {
        search: async () => {
          throw new Error('private search detail');
        },
      },
    });
    await searchBot.commands.get('search')({
      match: 'Nha Trang',
      reply: async (text) => searchReplies.push(text),
    });
    expect(searchReplies).toEqual([
      'Search could not be completed. Please try again later.',
    ]);

    const prepareBot = fakeBot();
    const prepareReplies = [];
    const logged = [];
    registerTelegramHandlers(prepareBot, {
      logger: { error: (message) => logged.push(message) },
      presetService: {
        prepareDelivery: async () => {
          throw new Error('private mirror detail');
        },
        resolveSearch: async (_userId, options) => options,
      },
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: { search: async () => [offer] },
      traceRecorder: {
        persist: async () => {
          throw new Error('private trace detail');
        },
        record: () => {},
      },
    });
    await prepareBot.commands.get('search')({
      from: { id: 123 },
      match: 'Nha Trang',
      reply: async (text) => prepareReplies.push(text),
    });
    expect(prepareReplies).toEqual([
      'Search could not be completed. Please try again later.',
    ]);
    expect(logged).toEqual(['telegram search trace persistence failed']);

    const resultBot = fakeBot();
    const resultReplies = [];
    registerTelegramHandlers(resultBot, {
      presetService: {
        prepareDelivery: async () => {},
        resolveSearch: async (_userId, options) => options,
      },
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: { search: async () => [offer] },
    });
    await resultBot.commands.get('search')({
      from: { id: 123 },
      match: 'Nha Trang',
      reply: async (text) => {
        if (!resultReplies.length) {
          resultReplies.push('transport failed');
          throw new Error('private transport detail');
        }
        resultReplies.push(text);
      },
    });
    expect(resultReplies.at(-1)).toBe(
      'Search could not be completed. Please try again later.'
    );

    const mediaBot = fakeBot();
    const mediaEvents = [];
    registerTelegramHandlers(mediaBot, {
      presetService: {
        markDelivered: async () => {},
        prepareDelivery: async () => {},
        resolveSearch: async (_userId, options) => options,
      },
      registry: { update: async () => ({ web: [], telegram: [] }) },
      service: { search: async () => [offer] },
      traceRecorder: {
        persist: async () => {},
        record: (event) => mediaEvents.push(event),
      },
    });
    await mediaBot.commands.get('search')({
      from: { id: 123 },
      match: 'Nha Trang',
      reply: async () => {},
      replyWithMediaGroup: async () => {
        throw new Error('private media detail');
      },
    });
    expect(mediaEvents.at(-1).stage).toBe('delivery-media');
    expect(mediaEvents.at(-1).status).toBe('degraded');
  });

  it('formats an empty result without claiming a price', () => {
    expect(formatSearchResults([])).toContain('No current offers');
  });
});

describe('Telegram bot edge behavior', () => {
  it('sends at most ten photos and reports malformed searches', async () => {
    const bot = fakeBot();
    const mediaGroups = [];
    const replies = [];
    registerTelegramHandlers(bot, {
      registry: { update: async () => ({ telegram: [], web: [] }) },
      service: {
        search: async () => [
          {
            photos: Array.from(
              { length: 12 },
              (_, index) => `https://img.example/${index}.jpg`
            ),
            priceVnd: 1,
            title: 'Room',
          },
        ],
      },
    });
    const context = {
      match: 'Nha Trang',
      reply: async (value) => replies.push(value),
      replyWithMediaGroup: async (value) => mediaGroups.push(value),
    };

    await bot.commands.get('search')(context);
    expect(mediaGroups[0].length).toBe(10);
    expect(mediaGroups[0][0].type).toBe('photo');
    context.match = '--cheapest 99';
    await bot.commands.get('search')(context);
    expect(replies.at(-1)).toContain('Usage: /search');
  });

  it('reports unavailable availability checks and source update failures', async () => {
    const bot = fakeBot();
    const replies = [];
    registerTelegramHandlers(bot, {
      registry: {
        update: async () => {
          throw new Error('discovery offline');
        },
      },
      service: { search: async () => [] },
    });
    const context = {
      match: '',
      reply: async (value) => replies.push(value),
    };

    await bot.commands.get('check_availability')(context);
    await bot.commands.get('update_sources')(context);
    expect(replies[0]).toContain('not configured');
    expect(replies[1]).toContain('discovery offline');
  });

  it('requires an offer ID for configured availability checks', async () => {
    const bot = fakeBot();
    const replies = [];
    registerTelegramHandlers(bot, {
      availabilityService: { check: async () => {} },
      registry: { update: async () => ({ telegram: [], web: [] }) },
      service: { search: async () => [] },
    });

    await bot.commands.get('check_availability')({
      match: '',
      reply: async (value) => replies.push(value),
    });
    expect(replies[0]).toContain('offer ID is required');
  });

  it('reports successful source updates', async () => {
    const bot = fakeBot();
    const replies = [];
    const updates = [];
    registerTelegramHandlers(bot, {
      registry: {
        update: async (options) => {
          updates.push(options);
          return { telegram: [{}, {}], web: [{}] };
        },
      },
      service: { search: async () => [] },
    });

    await bot.commands.get('update_sources')({
      reply: async (value) => replies.push(value),
    });
    expect(replies[0]).toContain('Updated 1 web and 2 Telegram');
    expect(updates).toEqual([
      { focusCount: 40, telegramCount: 20, webCount: 20 },
    ]);
  });

  it('ingests priced messages with rates and ignores incomplete updates', async () => {
    const bot = fakeBot();
    const deleted = [];
    const saved = [];
    let rates = 0;
    registerTelegramHandlers(bot, {
      rateProvider: {
        getRates: async () => {
          rates += 1;
          return { USD: 25_000, VND: 1 };
        },
      },
      registry: { update: async () => ({ telegram: [], web: [] }) },
      service: { search: async () => [] },
      store: {
        deleteOffersByMessages: async (...arguments_) =>
          deleted.push(arguments_),
        saveOffers: async (offers) => saved.push(offers),
      },
    });
    const ingest = bot.listeners.get('message:text');

    await ingest({});
    await ingest({
      message: {
        chat: { username: 'rental_owner' },
        date: '2026-09-21T00:00:00Z',
        messageId: 8,
        text: 'Room without a price',
      },
    });
    await ingest({
      message: {
        chat: { username: 'rental_owner' },
        date: '2026-09-21T00:00:00Z',
        messageId: 9,
        text: 'Room 10 USD/night',
      },
    });
    await bot.listeners.get('edited_message:text')({
      editedMessage: {
        chat: { username: 'rental_owner' },
        date: '2026-09-21T00:00:00Z',
        edit_date: '2026-09-21T01:00:00Z',
        message_id: 10,
        text: 'Room 12 USD/night',
      },
    });
    await bot.listeners.get('edited_channel_post:text')({
      editedChannelPost: {
        chat: { username: 'rental_channel' },
        date: '2026-09-21T00:00:00Z',
        edit_date: '2026-09-21T02:00:00Z',
        message_id: 11,
        text: 'Room 14 USD/night',
      },
    });

    expect(rates).toBe(4);
    expect(saved.length).toBe(3);
    expect(saved[0][0].priceVnd).toBe(250_000);
    expect(deleted).toEqual([
      ['telegram:rental_owner', [10]],
      ['telegram:rental_channel', [11]],
    ]);
  });

  it('requires a token before loading the Telegram bot runtime', async () => {
    let error;
    try {
      await createTelegramBot('', {});
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('TELEGRAM_BOT_TOKEN');
  });

  it('wires subscription delivery through the concrete bot API', async () => {
    // The Deno CI leg intentionally grants read-only permissions. grammY's
    // Node adapter inspects process.env during module initialization, so the
    // concrete adapter is exercised by Node and Bun instead.
    if (typeof Deno !== 'undefined') {
      return;
    }
    const records = [];
    const bot = await createTelegramBot(
      '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
      {
        presetService: {},
        registry: {},
        service: {},
        store: {
          loadRecords: async () => records,
          saveRecords: async (_kind, values) =>
            records.splice(0, records.length, ...values),
        },
      }
    );
    const sent = [];
    bot.api.sendMessage = async (...arguments_) => sent.push(arguments_);

    await bot.subscriptionScheduler.deliver('42', [
      { id: 'offer', priceVnd: 1, title: 'Room' },
    ]);

    expect(sent[0][0]).toBe('42');
    expect(records.length).toBe(1);
  });
});
