import { describe, expect, it } from 'test-anywhere';

import {
  BrowserCollector,
  BrowserSourceDiscoverer,
  DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
  DEFAULT_TELEGRAM_SOURCES,
  DEFAULT_WEB_SOURCES,
  SearchService,
  SourceRegistry,
  parseSearchCommand,
  parseTelegramOffer,
} from '../src/index.js';

describe('Nha Trang source coverage', () => {
  it('adds twenty focused sources including the requested communities', () => {
    const ids = new Set(
      DEFAULT_NHA_TRANG_TELEGRAM_SOURCES.map((source) => source.id)
    );

    expect(DEFAULT_NHA_TRANG_TELEGRAM_SOURCES.length).toBe(20);
    expect(ids.has('telegram:arenda_vetnam')).toBe(true);
    expect(ids.has('telegram:arenda_nyachang_zhilye')).toBe(true);
    expect(ids.has('telegram:nachangap')).toBe(true);
    for (const source of DEFAULT_NHA_TRANG_TELEGRAM_SOURCES) {
      expect(source.focus).toBe('nha-trang');
      expect(source.popularity.evidenceUrl).toBe(source.url);
    }
  });

  it('keeps twenty sources in each configured cohort', async () => {
    const registry = new SourceRegistry({
      store: { loadSources: async () => [] },
    });

    const sources = await registry.list();

    expect(sources.filter((source) => source.type === 'web').length).toBe(20);
    expect(
      sources.filter((source) => source.type === 'telegram' && !source.focus)
        .length
    ).toBe(20);
    expect(
      sources.filter((source) => source.focus === 'nha-trang').length
    ).toBe(20);
  });

  it('uses multilingual Nha Trang searches to discover similar sources', async () => {
    let currentUrl = '';
    const navigated = [];
    const discoverer = new BrowserSourceDiscoverer({
      browserRuntime: {
        launchBrowser: async () => ({
          browser: { close: async () => {} },
          page: {},
        }),
        makeBrowserCommander: () => ({
          destroy: async () => {},
          evaluate: async (fn) => {
            if (fn.name === 'extractSearchLinks') {
              return currentUrl.includes('%D0%9D%D1%8F%D1%87%D0%B0%D0%BD%D0%B3')
                ? ['https://t.me/new_nyachang_rent']
                : ['https://t.me/new_nha_trang_rent'];
            }
            return '1.5K subscribers';
          },
          goto: async ({ url }) => {
            currentUrl = url;
            navigated.push(url);
          },
        }),
      },
      now: () => new Date('2026-09-21T00:00:00Z'),
    });

    const ranked = await discoverer.discover('telegram', {
      candidates: DEFAULT_NHA_TRANG_TELEGRAM_SOURCES.slice(0, 1),
      focus: 'nha-trang',
    });

    expect(
      navigated.filter((url) => url.includes('google.com/search')).length >= 3
    ).toBe(true);
    expect(ranked.some((source) => source.id.includes('new_nha_trang'))).toBe(
      true
    );
    expect(ranked.every((source) => source.focus === 'nha-trang')).toBe(true);
  });

  it('refreshes and saves all three ranked cohorts', async () => {
    const saved = [];
    const registry = new SourceRegistry({
      store: {
        loadSources: async () => [],
        saveSources: async (sources) => saved.push(sources),
      },
      discover: async (type, { candidates, focus }) =>
        candidates.map((source, index) => ({
          ...source,
          focus,
          popularity: { ...source.popularity, value: 10_000 - index },
          type,
        })),
    });

    const updated = await registry.update();

    expect(updated.web.length).toBe(20);
    expect(updated.telegram.length).toBe(40);
    expect(updated.telegram.filter((source) => source.focus).length).toBe(20);
    expect(saved[0].length).toBe(60);
  });

  it('keeps the existing seed cohorts independent', () => {
    const existing = new Set(
      [...DEFAULT_WEB_SOURCES, ...DEFAULT_TELEGRAM_SOURCES].map(
        (source) => source.id
      )
    );
    expect(
      DEFAULT_NHA_TRANG_TELEGRAM_SOURCES.every(
        (source) => !existing.has(source.id)
      )
    ).toBe(true);
  });
});

describe('complete recent Telegram parsing', () => {
  it('normalizes advanced occupancy, fees, coordinates, and contact fields', async () => {
    const offer = await parseTelegramOffer(
      {
        chat: { username: 'advanced_nha_trang' },
        date: '2026-09-20T10:00:00Z',
        messageId: 88,
        text: [
          'Studio Ocean View — mã NT-AB_88',
          'Location - Vĩnh Hải, Nha Trang',
          'Bedrooms: studio; Bathrooms: 1; Beds: 2; Guests: 3',
          'Rating: 4.8 (126 reviews)',
          'GPS: 12.2683, 109.2019',
          'Check-in: 14:00; Check-out: 11:30',
          'Wi-Fi, air conditioning, kitchen, washing machine, elevator, gym',
          'Utilities included. Agency fee: 50%.',
          'Price: 900 USD/month',
          'Contact: owner@example.com, https://t.me/ocean_owner',
          'Marketplace: https://booking.example/hotel/ocean',
          'Official: https://ocean-home.example/stay?utm_source=telegram',
        ].join('\n'),
      },
      {
        now: new Date('2026-09-21T00:00:00Z'),
        rates: { USD: 26_000 },
      }
    );

    for (const [key, value] of Object.entries({
      agencyFeePercent: 50,
      bathrooms: 1,
      bedrooms: 0,
      beds: 2,
      checkIn: '14:00',
      checkOut: '11:30',
      guests: 3,
      latitude: 12.2683,
      longitude: 109.2019,
      propertyId: 'NT-AB_88',
      rating: 4.8,
      reviewCount: 126,
      utilitiesIncluded: true,
    })) {
      expect(offer.attributes[key]).toBe(value);
    }
    expect(offer.attributes.amenities).toEqual([
      'air-conditioning',
      'elevator',
      'gym',
      'kitchen',
      'sea-view',
      'washing-machine',
      'wifi',
    ]);
    expect(offer.contacts.email).toEqual(['owner@example.com']);
    expect(offer.contacts.telegram).toEqual(['ocean_owner']);
    expect(offer.location).toBe('Vĩnh Hải, Nha Trang');
    expect(offer.officialUrl).toBe('https://ocean-home.example/stay');
  });
});

describe('complete recent Telegram parsing', () => {
  it('extracts searchable Russian listing details and contacts', async () => {
    const offer = await parseTelegramOffer(
      {
        chat: { username: 'Arenda_Nyachang_Zhilye' },
        date: '2026-09-20T10:00:00Z',
        messageId: 2293,
        text: [
          'КВАРТИРА С ДВУМЯ СПАЛЬНЯМИ (ID A2293)',
          'г. Нячанг, ЖК Океанус',
          'Район: Север',
          'Свободно: с 30/09/26',
          '2 спальни / 2 санузла / балкон',
          '10 этаж. 70 m². Полностью меблирована.',
          'Можно с животными.',
          'Цена: 690 USD в месяц.',
          'Депозит: 1 месяц',
          'Аренда от 3 месяцев',
          'Электричество: по счётчику',
          'Контакт: @NhaTrang_owner, WhatsApp +84 813 101 501',
        ].join('\n'),
      },
      {
        now: new Date('2026-09-21T00:00:00Z'),
        rates: { USD: 26_000 },
      }
    );

    expect(offer.priceVnd).toBe(17_940_000);
    expect(offer.attributes.propertyId).toBe('A2293');
    expect(offer.attributes.bedrooms).toBe(2);
    expect(offer.attributes.bathrooms).toBe(2);
    expect(offer.attributes.areaM2).toBe(70);
    expect(offer.attributes.floor).toBe(10);
    expect(offer.attributes.district).toBe('Север');
    expect(offer.attributes.availableFrom).toBe(['2026', '09', '30'].join('-'));
    expect(offer.attributes.minimumStayMonths).toBe(3);
    expect(offer.attributes.depositMonths).toBe(1);
    expect(offer.attributes.furnished).toBe(true);
    expect(offer.attributes.petsAllowed).toBe(true);
    expect(offer.attributes.amenities).toContain('balcony');
    expect(offer.attributes.labeledFields['электричество']).toEqual([
      'по счётчику',
    ]);
    expect(offer.contacts.telegram).toEqual(['NhaTrang_owner']);
    expect(offer.contacts.phone).toEqual(['+84813101501']);
  });

  it('extracts Vietnamese listing details while preserving unfamiliar labels', async () => {
    const offer = await parseTelegramOffer(
      {
        chat: { username: 'nha_trang_rent' },
        date: '2026-09-20T10:00:00Z',
        messageId: 10,
        text: [
          'Căn hộ 1 phòng ngủ gần biển',
          'Địa chỉ: Vĩnh Hải, Nha Trang',
          'Diện tích: 45 m²',
          'Tầng: 7',
          '1 phòng tắm, đầy đủ nội thất',
          'Cho phép thú cưng',
          'Hợp đồng tối thiểu 6 tháng',
          'Phí quản lý: 700.000 VND',
          'Giá: 12 triệu VND/tháng',
          'Liên hệ: @chu_nha',
        ].join('\n'),
      },
      { now: new Date('2026-09-21T00:00:00Z') }
    );

    expect(offer.location).toBe('Vĩnh Hải, Nha Trang');
    expect(offer.attributes.bedrooms).toBe(1);
    expect(offer.attributes.bathrooms).toBe(1);
    expect(offer.attributes.areaM2).toBe(45);
    expect(offer.attributes.floor).toBe(7);
    expect(offer.attributes.minimumStayMonths).toBe(6);
    expect(offer.attributes.furnished).toBe(true);
    expect(offer.attributes.petsAllowed).toBe(true);
    expect(offer.attributes.labeledFields['phí quản lý']).toEqual([
      '700.000 VND',
    ]);
  });

  it('parses adversarial whitespace in bounded time', () => {
    const startedAt = globalThis.performance.now();
    for (const prefix of ['этаж', 'mã']) {
      parseTelegramOffer(
        {
          chat: { username: 'adversarial_input' },
          date: '2026-09-20T00:00:00Z',
          messageId: 1,
          text: `${prefix}${' '.repeat(10_000)}!`,
        },
        { now: new Date('2026-09-21T00:00:00Z') }
      );
    }
    const durationMs = globalThis.performance.now() - startedAt;

    expect(durationMs < 150).toBe(true);
  });

  it('paginates public previews until reaching the two-month cutoff', async () => {
    const navigated = [];
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
            navigated.push(url);
          },
          evaluate: async () =>
            currentUrl.includes('before=101')
              ? [
                  {
                    date: '2026-07-01T00:00:00Z',
                    text: 'Old apartment\nPrice: 7 million VND/month',
                    url: 'https://t.me/example/80',
                  },
                ]
              : [
                  {
                    date: '2026-09-20T00:00:00Z',
                    text: 'Recent apartment\nPrice: 8 million VND/month',
                    url: 'https://t.me/example/102',
                  },
                  {
                    date: '2026-09-19T00:00:00Z',
                    text: 'Another apartment\nPrice: 9 million VND/month',
                    url: 'https://t.me/example/101',
                  },
                ],
        }),
      },
      now: () => new Date('2026-09-21T00:00:00Z'),
      rates: { VND: 1 },
    });

    const offers = await collector.collect([
      {
        id: 'telegram:example',
        name: 'Example',
        searchUrl: 'https://t.me/s/example',
        type: 'telegram',
        url: 'https://t.me/example',
      },
    ]);

    expect(navigated.length).toBe(2);
    expect(navigated[1]).toContain('before=101');
    expect(offers.length).toBe(2);
  });
});

describe('searchable normalized parameters', () => {
  it('parses repeated typed --filter options', () => {
    expect(
      parseSearchCommand(
        '/search --cheapest 10 --filter bedrooms=2 --filter petsAllowed=true Nha Trang'
      )
    ).toEqual({
      cheapest: true,
      filters: { bedrooms: 2, petsAllowed: true },
      limit: 10,
      query: 'Nha Trang',
    });
  });

  it('accepts a preserved labeled field as a filter path', () => {
    expect(
      parseSearchCommand(
        '/search --filter labeledFields.электричество=счётчику Нячанг'
      )
    ).toEqual({
      cheapest: false,
      filters: { 'labeledFields.электричество': 'счётчику' },
      limit: 10,
      query: 'Нячанг',
    });
  });

  it('filters against both top-level and normalized attribute fields', async () => {
    const offers = [
      {
        attributes: {
          bedrooms: 2,
          labeledFields: { электричество: ['по счётчику'] },
          petsAllowed: true,
        },
        collectedAt: '2026-09-21T00:00:00Z',
        id: 'match',
        location: 'Nha Trang',
        priceVnd: 10_000_000,
      },
      {
        attributes: { bedrooms: 1, petsAllowed: false },
        collectedAt: '2026-09-21T00:00:00Z',
        id: 'other',
        location: 'Nha Trang',
        priceVnd: 9_000_000,
      },
    ];
    const service = new SearchService({
      collector: { collect: async () => [] },
      registry: { list: async () => [] },
      store: { listOffers: async () => offers },
    });

    const results = await service.search({
      filters: {
        bedrooms: 2,
        'labeledFields.электричество': 'счётчику',
        location: 'nha trang',
        petsAllowed: true,
      },
      refresh: false,
    });

    expect(results.map((offer) => offer.id)).toEqual(['match']);
  });
});
