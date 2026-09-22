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
    registerTelegramHandlers(bot, {
      registry: {
        update: async () => ({ telegram: [{}, {}], web: [{}] }),
      },
      service: { search: async () => [] },
    });

    await bot.commands.get('update_sources')({
      reply: async (value) => replies.push(value),
    });
    expect(replies[0]).toContain('Updated 1 web and 2 Telegram');
  });

  it('ingests priced messages with rates and ignores incomplete updates', async () => {
    const bot = fakeBot();
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
      store: { saveOffers: async (offers) => saved.push(offers) },
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

    expect(rates).toBe(2);
    expect(saved.length).toBe(1);
    expect(saved[0][0].priceVnd).toBe(250_000);
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
});
