import { describe, expect, it } from 'test-anywhere';

import { formatSearchResults, registerTelegramHandlers } from '../src/index.js';

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
