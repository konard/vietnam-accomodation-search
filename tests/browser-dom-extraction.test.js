import { describe, expect, it } from 'test-anywhere';

import {
  BrowserCollector,
  BrowserSourceDiscoverer,
  DEFAULT_TELEGRAM_SOURCES,
  DEFAULT_WEB_SOURCES,
} from '../src/index.js';
import { extractPageListings } from '../src/browser-collector.js';
import { browserAdapterFor } from '../src/browser-adapters.js';
import {
  assessSourceCoverage,
  summarizeStructuredCards,
} from '../experiments/browser-real-estate-audit-lib.mjs';

function browserRuntime(commander) {
  return {
    launchBrowser: async () => ({
      browser: { close: async () => {} },
      page: {},
    }),
    makeBrowserCommander: () => commander,
  };
}

describe('in-page listing extraction', () => {
  it('keeps only Nha Trang cards from a countrywide rental page', () => {
    const previous = globalThis.document;
    const adapter = browserAdapterFor('https://vietnam-real.estate/ru/rent/');
    const card = (city) => ({
      getAttribute: (name) => (name === 'data-object' ? city : null),
      innerText: `Квартира в ${city}`,
      querySelector: (selector) =>
        selector === adapter.selectors.fields.location
          ? { textContent: `Квартира в ${city}` }
          : null,
      querySelectorAll: (selector) =>
        selector === adapter.selectors.fields.location
          ? [{ textContent: `Квартира в ${city}` }]
          : [],
    });
    globalThis.document = {
      querySelectorAll: () => [card('Нячанг'), card('Hoi An')],
    };
    try {
      const cards = extractPageListings('web', adapter.selectors);
      expect(cards.length).toBe(1);
      expect(cards[0].attributes.propertyId).toBe('Нячанг');
    } finally {
      globalThis.document = previous;
    }
  });

  it('accounts for an ICEKEM rental card without a stated availability', () => {
    const previous = globalThis.document;
    const adapter = browserAdapterFor('https://icekem.com/ru/s/rent-nhatrang');
    const nodes = new Map([
      [adapter.selectors.link, [{ href: 'https://icekem.com/ru/pr/id123' }]],
      [adapter.selectors.title, [{ textContent: '2 комн. квартира' }]],
      [
        adapter.selectors.fields.bedrooms,
        [{ textContent: '2 комн. квартира' }],
      ],
      [adapter.selectors.fields.contact, [{ textContent: 'Написать' }]],
      [adapter.selectors.fields.location, [{ textContent: 'Нячанг' }]],
      [
        adapter.selectors.fields.metadata,
        [
          { textContent: 'Квартира' },
          { textContent: 'Новая квартира' },
          { textContent: '2 комн. квартира | 72 м² | 3 месяца' },
        ],
      ],
      [adapter.selectors.fields.price, [{ textContent: '$1,031/мес.' }]],
      [
        adapter.selectors.media,
        [{ currentSrc: 'https://icekem.com/photo.jpg' }],
      ],
    ]);
    const card = {
      getAttribute: (name) => (name === 'pr-id' ? '123' : null),
      innerText:
        'Квартира\nНовая квартира\n$1,031/мес.\n2 комн. квартира | 72 м² | 3 месяца\nНячанг\nНаписать\n·',
      querySelector: (selector) => nodes.get(selector)?.[0] || null,
      querySelectorAll: (selector) => nodes.get(selector) || [],
    };
    globalThis.document = { querySelectorAll: () => [card] };
    try {
      const cards = extractPageListings('web', adapter.selectors);
      expect(cards[0].semantic.availability).toBe('not stated on source card');
      expect(cards[0].attributes.availableNow).toBe(undefined);
      expect(cards[0].attributes.propertyId).toBe('123');
      expect(summarizeStructuredCards(cards).incompleteCards).toBe(0);
      expect(
        assessSourceCoverage({
          cards,
          finalUrl: 'https://icekem.com/ru/s/rent-nhatrang',
          pageText: 'Аренда жилья в Нячанге',
          requestedUrl: 'https://icekem.com/ru/s/rent-nhatrang',
        }).missing
      ).toEqual([]);
    } finally {
      globalThis.document = previous;
    }
  });

  it('extracts source-labeled semantic fields from bare values', () => {
    const previous = globalThis.document;
    const elements = new Map([
      ['a.details', { href: 'https://rent.example/listing/A902' }],
      ['h5', { textContent: 'Two bedroom apartment. ID A902' }],
      ['.price', { textContent: '$420/mo' }],
      ['.bed', { textContent: '2' }],
      ['.bath', { textContent: '1' }],
      ['.location', { textContent: 'North Nha Trang' }],
      ['.availability', { textContent: 'For Rent' }],
      ['.contact', { textContent: 'Contact +84 123 456 789' }],
    ]);
    const card = {
      getAttribute: (name) => (name === 'data-listing-id' ? 'A902' : null),
      innerText: '$420/mo\n2\n1\nNorth Nha Trang\nFor Rent',
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: (selector) =>
        selector === 'img[src]'
          ? [{ currentSrc: 'https://rent.example/a902.jpg', src: '' }]
          : [],
    };
    globalThis.document = { querySelectorAll: () => [card] };

    try {
      const rows = extractPageListings('web', {
        cards: '.card',
        fields: {
          availability: '.availability',
          bathrooms: '.bath',
          bedrooms: '.bed',
          contact: '.contact',
          location: '.location',
          price: '.price',
        },
        identityAttributes: ['data-listing-id'],
        link: 'a.details',
        media: 'img[src]',
        title: 'h5',
      });

      expect(rows[0].attributes).toEqual({
        availableNow: true,
        bathrooms: 1,
        bedrooms: 2,
        propertyId: 'A902',
      });
      expect(rows[0].semantic).toEqual({
        availability: 'For Rent',
        bathrooms: '1',
        bedrooms: '2',
        contact: 'Contact +84 123 456 789',
        location: 'North Nha Trang',
        price: '$420/mo',
      });
      expect(rows[0].photos).toEqual(['https://rent.example/a902.jpg']);
      expect(rows[0].url).toBe('https://rent.example/listing/A902');
      expect(
        rows[0].segments.every(({ category }) => category !== 'unknown')
      ).toBe(true);
    } finally {
      globalThis.document = previous;
    }
  });

  it('accounts for DOM fallbacks and text-derived unavailable identities', () => {
    const previous = globalThis.document;
    const elements = new Map([
      ['a.details', { href: 'https://rent.example/listing' }],
      ['h5', { textContent: 'Unavailable apartment' }],
      ['.availability', { textContent: 'Sold' }],
    ]);
    const ariaElement = {
      getAttribute: (name) => (name === 'aria-label' ? 'Rooftop pool' : null),
    };
    const card = {
      getAttribute: () => null,
      innerText: 'property-A902\nSold\nRooftop pool',
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: (selector) =>
        selector === '.amenity' ? [ariaElement] : [],
    };
    globalThis.document = { querySelectorAll: () => [card] };

    try {
      const [row] = extractPageListings('web', {
        cards: '.card',
        fields: {
          amenity: '.amenity',
          availability: '.availability',
          omitted: '',
        },
        link: 'a.details',
        title: 'h5',
      });

      expect(row.attributes).toEqual({
        availableNow: false,
        propertyId: 'A902',
      });
      expect(row.semantic).toEqual({
        amenity: 'Rooftop pool',
        availability: 'Sold',
      });
    } finally {
      globalThis.document = previous;
    }
  });

  it('extracts property IDs, titles, and image fallbacks from website DOM cards', async () => {
    const previous = globalThis.document;
    const anchor = { href: 'https://stay.example/rooms/unit-42' };
    const card = {
      getAttribute: () => null,
      innerText: 'Villa 900,000 VND/night',
      querySelector: (selector) =>
        selector === 'a[href]' ? anchor : { textContent: '  Beach villa  ' },
      querySelectorAll: () => [
        { currentSrc: '', src: 'https://img.example/fallback.jpg' },
        { currentSrc: '', src: '' },
      ],
    };
    globalThis.document = {
      querySelectorAll: () => [card],
    };
    try {
      const commander = {
        destroy: async () => {},
        evaluate: async (operation, type) => operation(type),
        goto: async () => {},
      };
      const collector = new BrowserCollector({
        browserRuntime: browserRuntime(commander),
        rateProvider: { getRates: async () => ({ VND: 1 }) },
      });
      const offers = await collector.collect([
        {
          id: 'stay',
          searchUrl: 'https://stay.example/search?q={query}',
          type: 'web',
        },
      ]);

      expect(offers[0].attributes.propertyId).toBe('unit-42');
      expect(offers[0].identifiers).toEqual({ stay: 'unit-42' });
      expect(offers[0].photos).toEqual(['https://img.example/fallback.jpg']);
      expect(offers[0].title).toBe('Beach villa');
    } finally {
      globalThis.document = previous;
    }
  });

  it('extracts recent Telegram messages and their CSS background photos', async () => {
    const previous = globalThis.document;
    const message = {
      querySelector: (selector) => {
        if (selector === '.tgme_widget_message_date') {
          return { href: 'https://t.me/rentals/42' };
        }
        if (selector === 'time') {
          return { dateTime: '2026-07-21T00:00:00Z' };
        }
        return { innerText: 'Sea room 500,000 VND/night' };
      },
      querySelectorAll: () => [
        { style: { backgroundImage: 'url("https://img.example/room.jpg")' } },
        { style: { backgroundImage: 'none' } },
      ],
    };
    globalThis.document = { querySelectorAll: () => [message] };
    try {
      const commander = {
        destroy: async () => {},
        evaluate: async (operation, type) => operation(type),
        goto: async () => {},
      };
      const collector = new BrowserCollector({
        browserRuntime: browserRuntime(commander),
        now: () => new Date('2026-09-21T00:00:00Z'),
      });
      const offers = await collector.collect([
        {
          id: 'telegram:rentals',
          name: 'Rentals',
          searchUrl: 'https://t.me/s/rentals',
          type: 'telegram',
          url: 'https://t.me/rentals',
        },
      ]);

      expect(offers[0].url).toBe('https://t.me/rentals/42');
      expect(offers[0].photos).toEqual(['https://img.example/room.jpg']);
    } finally {
      globalThis.document = previous;
    }
  });

  it('stops Telegram pagination for empty pages and rows without message IDs', async () => {
    const collector = new BrowserCollector({
      now: () => new Date('2026-09-21T00:00:00Z'),
    });
    const source = {
      searchUrl: 'https://t.me/s/rentals?query={query}',
    };
    const empty = await collector.collectTelegramRows(
      { evaluate: async () => [], goto: async () => {} },
      source,
      ''
    );
    const undated = await collector.collectTelegramRows(
      {
        evaluate: async () => [{ date: 'invalid', text: 'No permalink' }],
        goto: async () => {},
      },
      source,
      ''
    );

    expect(empty).toEqual([]);
    expect(undated.length).toBe(1);
  });
});

describe('official website extraction', () => {
  it('extracts prices and photos from a discovered official website DOM', async () => {
    const previous = globalThis.document;
    globalThis.document = {
      body: { innerText: 'Official room price 400,000 VND/night' },
      querySelector: (selector) =>
        selector.startsWith('meta')
          ? { content: 'https://official.example/cover.jpg' }
          : null,
      querySelectorAll: () => [
        { currentSrc: '', src: 'https://official.example/room.jpg' },
      ],
      title: 'Official Ocean Home',
    };
    try {
      const collector = new BrowserCollector({
        now: () => new Date('2026-09-21T00:00:00Z'),
      });
      const offers = await collector.collectOfficialOffers(
        {
          evaluate: async (operation) => operation(),
          goto: async () => {},
        },
        [
          {
            officialUrl: 'https://official.example/stay',
            title: 'Ocean Home',
            url: 'https://market.example/ocean-home',
          },
        ],
        'Nha Trang',
        { VND: 1 }
      );

      expect(offers[0].title).toBe('Official Ocean Home');
      expect(offers[0].photos).toEqual([
        'https://official.example/cover.jpg',
        'https://official.example/room.jpg',
      ]);
      expect(offers[0].priceVnd).toBe(400_000);
    } finally {
      globalThis.document = previous;
    }
  });

  it('isolates inaccessible official websites', async () => {
    const debug = [];
    const collector = new BrowserCollector({
      logger: { debug: (...values) => debug.push(values) },
    });
    const offers = await collector.collectOfficialOffers(
      {
        evaluate: async () => ({}),
        goto: async () => {
          throw new Error('official site unavailable');
        },
      },
      [
        {
          officialUrl: 'https://official.example/stay',
          url: 'https://market.example/ocean-home',
        },
      ],
      '',
      { VND: 1 }
    );

    expect(offers).toEqual([]);
    expect(debug[0][0]).toContain('Official price check failed');
  });

  it('never follows private-network URLs found in listing text', async () => {
    let navigations = 0;
    const collector = new BrowserCollector();
    const offers = await collector.collectOfficialOffers(
      {
        evaluate: async () => ({}),
        goto: async () => {
          navigations += 1;
        },
      },
      [
        {
          officialUrl: 'http://user:password@public.example/secret',
          url: 'https://market.test/credentials',
        },
        {
          officialUrl: 'http://0.0.0.0/admin',
          url: 'https://market.test/zero',
        },
        {
          officialUrl: 'http://10.0.0.1/admin',
          url: 'https://market.test/ten',
        },
        { officialUrl: 'http://127.0.0.1/admin', url: 'https://market.test/a' },
        {
          officialUrl: 'http://169.254.169.254/latest/meta-data',
          url: 'https://market.test/b',
        },
        { officialUrl: 'http://172.16.0.1', url: 'https://market.test/172' },
        { officialUrl: 'http://192.168.0.1', url: 'https://market.test/192' },
        { officialUrl: 'http://224.0.0.1', url: 'https://market.test/multi' },
        { officialUrl: 'http://[::1]', url: 'https://market.test/ipv6-loop' },
        { officialUrl: 'http://[::]', url: 'https://market.test/ipv6-any' },
        {
          officialUrl: 'http://[::ffff:127.0.0.1]',
          url: 'https://market.test/ipv6-mapped',
        },
        { officialUrl: 'http://[fc00::1]', url: 'https://market.test/ipv6-fc' },
        { officialUrl: 'http://[fd00::1]', url: 'https://market.test/ipv6-fd' },
        { officialUrl: 'http://[fe90::1]', url: 'https://market.test/ipv6-fe' },
        {
          officialUrl: 'http://[ff02::1]',
          url: 'https://market.test/ipv6-multi',
        },
        { officialUrl: 'https://localhost', url: 'https://market.test/local' },
        {
          officialUrl: 'https://hotel.localhost',
          url: 'https://market.test/sub-local',
        },
        { officialUrl: 'https://hotel.local', url: 'https://market.test/c' },
        { officialUrl: 'not a URL', url: 'https://market.test/d' },
      ],
      '',
      { VND: 1 }
    );

    expect(navigations).toBe(0);
    expect(offers).toEqual([]);
  });
});

describe('in-page source discovery extraction', () => {
  it('reads search links from the DOM and ignores non-web protocols', async () => {
    const previous = globalThis.document;
    globalThis.document = {
      querySelectorAll: () => [
        { href: 'ftp://files.example' },
        { href: 'https://www.booking.com/result' },
      ],
    };
    try {
      const commander = {
        destroy: async () => {},
        evaluate: async (operation) => operation(),
        goto: async () => {},
      };
      const discoverer = new BrowserSourceDiscoverer({
        browserRuntime: browserRuntime(commander),
      });
      const ranked = await discoverer.discover('web', {
        candidates: DEFAULT_WEB_SOURCES.slice(0, 2),
      });

      expect(ranked[0].id).toBe('booking');
      expect(ranked[0].popularity.value).toBe(1);
    } finally {
      globalThis.document = previous;
    }
  });

  it('uses fallback audiences and logs inaccessible Telegram previews', async () => {
    const previous = globalThis.document;
    const debug = [];
    globalThis.document = {
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    try {
      const commander = {
        destroy: async () => {},
        evaluate: async (operation) => operation(),
        goto: async ({ url }) => {
          if (
            url
              .toLocaleLowerCase('en')
              .includes(DEFAULT_TELEGRAM_SOURCES[1].id.slice(9))
          ) {
            throw new Error('preview unavailable');
          }
        },
      };
      const discoverer = new BrowserSourceDiscoverer({
        browserRuntime: browserRuntime(commander),
        logger: { debug: (...values) => debug.push(values) },
      });
      const ranked = await discoverer.discover('telegram', {
        candidates: DEFAULT_TELEGRAM_SOURCES.slice(0, 2),
        focus: 'nha-trang',
      });

      expect(ranked[0].popularity.value).toBe(
        DEFAULT_TELEGRAM_SOURCES[0].popularity.value
      );
      expect(ranked[0].focus).toBe('nha-trang');
      expect(debug.length).toBe(1);
    } finally {
      globalThis.document = previous;
    }
  });
});
