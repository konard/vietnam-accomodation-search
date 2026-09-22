import { describe, expect, it } from 'test-anywhere';

import { BrowserCollector, buildSearchUrl } from '../src/index.js';

describe('browser-driven collection', () => {
  it('builds source search URLs from the user query', () => {
    expect(
      buildSearchUrl(
        {
          searchUrl: 'https://booking.example/search?destination={query}',
        },
        'Da Nang beach'
      )
    ).toBe('https://booking.example/search?destination=Da%20Nang%20beach');
  });

  it('uses Browser Commander navigation and preserves raw page data', async () => {
    const events = [];
    let launchOptions;
    const browser = { close: async () => events.push('browser.close') };
    const commander = {
      destroy: async () => events.push('commander.destroy'),
      evaluate: async () => [
        {
          attributes: { propertyId: 'hotel-42' },
          title: 'Beach room',
          text: 'Beach room - 500,000 VND/night',
          url: 'https://booking.example/room/1',
          photos: ['https://booking.example/room.jpg'],
        },
      ],
      goto: async ({ url }) => events.push(`goto:${url}`),
    };
    const collector = new BrowserCollector({
      browserRuntime: {
        launchBrowser: async (options) => {
          launchOptions = options;
          return { browser, page: {} };
        },
        makeBrowserCommander: () => commander,
      },
      browserLaunchOptions: { args: ['--no-sandbox'] },
      now: () => new Date('2026-09-21T00:00:00Z'),
      rates: { VND: 1 },
    });

    const offers = await collector.collect(
      [
        {
          id: 'booking',
          name: 'Booking',
          type: 'web',
          searchUrl: 'https://booking.example/search?q={query}',
        },
      ],
      'Da Nang'
    );

    expect(events[0]).toBe('goto:https://booking.example/search?q=Da%20Nang');
    expect(launchOptions.args).toEqual(['--no-sandbox']);
    expect(offers.length).toBe(1);
    expect(offers[0].raw.text).toContain('500,000 VND');
    expect(offers[0].identifiers).toEqual({ booking: 'hotel-42' });
    expect(offers[0].officialUrl).toBe(undefined);
    expect(events.slice(-2)).toEqual(['commander.destroy', 'browser.close']);
  });

  it('isolates one failed source and continues collecting others', async () => {
    let currentUrl = '';
    const collector = new BrowserCollector({
      browserRuntime: {
        launchBrowser: async () => ({
          browser: { close: async () => {} },
          page: {},
        }),
        makeBrowserCommander: () => ({
          destroy: async () => {},
          goto: async ({ url }) => {
            currentUrl = url;
            if (url.includes('broken')) {
              throw new Error('site unavailable');
            }
          },
          evaluate: async () => [
            {
              title: 'Working result',
              text: 'Working result 1,000,000 VND/night',
              url: currentUrl,
            },
          ],
        }),
      },
      rates: { VND: 1 },
    });

    const offers = await collector.collect([
      {
        id: 'broken',
        type: 'web',
        searchUrl: 'https://broken.example/?q={query}',
      },
      {
        id: 'working',
        type: 'web',
        searchUrl: 'https://working.example/?q={query}',
      },
    ]);

    expect(offers.length).toBe(1);
    expect(offers[0].sourceId).toBe('working');
  });

  it('checks explicitly discovered accommodation websites for direct prices', async () => {
    let currentUrl = '';
    const collector = new BrowserCollector({
      browserRuntime: {
        launchBrowser: async () => ({
          browser: { close: async () => {} },
          page: {},
        }),
        makeBrowserCommander: () => ({
          destroy: async () => {},
          goto: async ({ url }) => {
            currentUrl = url;
          },
          evaluate: async (operation) =>
            operation.name === 'extractOfficialListing'
              ? {
                  text: 'Direct price 450,000 VND/night',
                  title: 'Ocean Home direct',
                }
              : [
                  {
                    officialUrl: 'https://ocean-home.example/stay',
                    text: 'Marketplace listing without a public price',
                    title: 'Ocean Home',
                    url: 'https://market.example/ocean-home',
                  },
                ],
        }),
      },
      now: () => new Date('2026-09-21T00:00:00Z'),
    });

    const offers = await collector.collect([
      {
        id: 'market',
        searchUrl: 'https://market.example/search?q={query}',
        type: 'web',
      },
    ]);

    expect(currentUrl).toBe('https://ocean-home.example/stay');
    expect(offers.length).toBe(2);
    expect(offers[0].priceVnd).toBe(null);
    expect(offers[1].sourceId).toBe('official:ocean-home.example');
    expect(offers[1].sourceType).toBe('official-web');
    expect(offers[1].priceVnd).toBe(450_000);
  });
});
