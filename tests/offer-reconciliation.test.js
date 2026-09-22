import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  LinksStore,
  canonicalizeOfferUrl,
  deduplicateOffers,
  formatSearchResults,
  offerIdentityKeys,
} from '../src/index.js';

function webOffer(overrides = {}) {
  return {
    collectedAt: '2026-09-20T00:00:00.000Z',
    id: 'booking:first',
    location: 'Vĩnh Hải, Nha Trang',
    officialUrl:
      'https://www.booking.com/hotel/vn/ocean-home.html?aid=123&utm_source=test',
    photos: ['https://img.example/one.jpg'],
    price: { amount: 10_000_000, currency: 'VND', period: 'month' },
    priceVnd: 10_000_000,
    raw: { text: 'original website record' },
    sourceId: 'booking',
    sourceType: 'web',
    title: 'Ocean Home',
    url: 'https://www.booking.com/hotel/vn/ocean-home.html?aid=123',
    ...overrides,
  };
}

function officialOffer(overrides = {}) {
  return webOffer({
    officialUrl: 'https://ocean-home.example/rooms/studio',
    sourceId: 'official:ocean-home.example',
    sourceType: 'official-web',
    url: 'https://ocean-home.example/rooms/studio',
    ...overrides,
  });
}

describe('cross-source accommodation reconciliation', () => {
  it('canonicalizes tracking variants without discarding stable identifiers', () => {
    expect(
      canonicalizeOfferUrl(
        'HTTPS://WWW.Booking.com/hotel/vn/ocean-home.html/?hotel_id=42&utm_source=x#rooms'
      )
    ).toBe('https://booking.com/hotel/vn/ocean-home.html?hotel_id=42');
    expect(canonicalizeOfferUrl('not a url')).toBe(undefined);
  });

  it('uses official URLs, external IDs, and conservative fingerprints', () => {
    const keys = offerIdentityKeys(
      webOffer({
        attributes: { areaM2: 70, bedrooms: 2, propertyId: 'A-42' },
        contacts: { phone: ['+84 123 456 789'], telegram: [] },
        identifiers: { booking: '42' },
        officialUrl: 'https://ocean-home.example/rooms/studio',
      })
    );

    expect(keys).toContain(
      'url:https://booking.com/hotel/vn/ocean-home.html?aid=123'
    );
    expect(keys).toContain('url:https://ocean-home.example/rooms/studio');
    expect(keys).toContain('external:booking:42');
    expect(keys).toContain('source-property:booking:a-42');
    expect(keys.some((key) => key.startsWith('fingerprint:'))).toBe(true);
  });

  it('merges transitive matches and preserves every source and raw variant', () => {
    const first = webOffer();
    const bridge = webOffer({
      collectedAt: '2026-09-20T01:00:00.000Z',
      contacts: { phone: ['+84123456789'], telegram: [] },
      id: 'telegram:bridge',
      officialUrl: undefined,
      price: { amount: 9_000_000, currency: 'VND', period: 'month' },
      priceVnd: 9_000_000,
      raw: { text: 'telegram repost' },
      sourceId: 'telegram:nha-trang',
      sourceType: 'telegram',
      url: 'https://t.me/nha_trang/7',
    });
    first.contacts = { phone: ['+84 123 456 789'], telegram: [] };
    const last = webOffer({
      collectedAt: '2026-09-21T00:00:00.000Z',
      id: 'agoda:last',
      officialUrl: 'https://agoda.example/property/777',
      price: { amount: 8_500_000, currency: 'VND', period: 'month' },
      priceVnd: 8_500_000,
      raw: { text: 'second website record' },
      sourceId: 'agoda',
      url: 'https://agoda.example/property/777',
    });
    last.contacts = { phone: ['+84123456789'], telegram: [] };

    const merged = deduplicateOffers([first, bridge, last]);

    expect(merged.length).toBe(1);
    expect(merged[0].sourceIds).toEqual([
      'agoda',
      'booking',
      'telegram:nha-trang',
    ]);
    expect(merged[0].variants.length).toBe(3);
    expect(merged[0].variants.map((variant) => variant.raw.text)).toEqual([
      'original website record',
      'telegram repost',
      'second website record',
    ]);
    expect(merged[0].photos).toEqual(['https://img.example/one.jpg']);
  });

  it('reconciles one Telegram post across preview, Bot API, and MTProto provenance', () => {
    const common = {
      identityKeys: ['telegram-post:nha-trang:77'],
      sourceId: 'telegram:nha-trang',
      sourceType: 'telegram',
    };
    const merged = deduplicateOffers([
      webOffer({
        ...common,
        collectedAt: '2026-09-22T01:00:00.000Z',
        id: 'preview-77',
        provenance: { messageId: 77, transport: 'public-preview' },
      }),
      webOffer({
        ...common,
        collectedAt: '2026-09-22T01:01:00.000Z',
        id: 'bot-77',
        provenance: { messageId: 77, transport: 'bot-api' },
      }),
      webOffer({
        ...common,
        collectedAt: '2026-09-22T01:02:00.000Z',
        id: 'mtproto-77',
        provenance: {
          groupedId: 'album-9',
          messageId: 77,
          topicId: 4,
          transport: 'mtproto',
        },
      }),
    ]);

    expect(merged.length).toBe(1);
    expect(
      merged[0].variants.map(({ provenance }) => provenance.transport)
    ).toEqual(['public-preview', 'bot-api', 'mtproto']);
    expect(merged[0].variants.at(-1).provenance).toEqual({
      groupedId: 'album-9',
      messageId: 77,
      topicId: 4,
      transport: 'mtproto',
    });
  });

  it('does not merge weakly similar listings with conflicting contacts', () => {
    const offers = deduplicateOffers([
      webOffer({
        contacts: { phone: ['+84111111111'], telegram: [] },
        id: 'one',
        officialUrl: undefined,
        url: undefined,
      }),
      webOffer({
        contacts: { phone: ['+84222222222'], telegram: [] },
        id: 'two',
        officialUrl: undefined,
        url: undefined,
      }),
    ]);

    expect(offers.length).toBe(2);
  });

  it('does not merge different units handled by the same agent', () => {
    const shared = {
      contacts: { phone: ['+84111111111'], telegram: [] },
      officialUrl: undefined,
      url: undefined,
    };
    const offers = deduplicateOffers([
      webOffer({ ...shared, id: 'one', title: 'Ocean Home studio' }),
      webOffer({ ...shared, id: 'two', title: 'Ocean Home penthouse' }),
    ]);

    expect(offers.length).toBe(2);
  });

  it('retains an official URL when a newer marketplace-only update arrives', () => {
    const first = deduplicateOffers([
      webOffer({
        officialUrl: 'https://ocean-home.example/rooms/studio',
      }),
    ])[0];
    const merged = deduplicateOffers([
      first,
      webOffer({
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'booking:new',
        officialUrl: undefined,
      }),
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0].officialUrl).toBe(
      'https://ocean-home.example/rooms/studio'
    );
  });
});

describe('price history reconciliation', () => {
  it('detects official-site price drops, increases, and unchanged checks', () => {
    const history = deduplicateOffers([
      webOffer({
        officialUrl: 'https://ocean-home.example/rooms/studio',
        sourceId: 'official:ocean-home.example',
        sourceType: 'official-web',
        url: 'https://ocean-home.example/rooms/studio',
      }),
      webOffer({
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'booking:second',
        officialUrl: 'https://ocean-home.example/rooms/studio',
        price: { amount: 8_000_000, currency: 'VND', period: 'month' },
        priceVnd: 8_000_000,
        sourceId: 'official:ocean-home.example',
        sourceType: 'official-web',
        url: 'https://ocean-home.example/rooms/studio',
      }),
      webOffer({
        collectedAt: '2026-09-21T01:00:00.000Z',
        id: 'booking:unchanged',
        officialUrl: 'https://ocean-home.example/rooms/studio',
        price: { amount: 8_000_000, currency: 'VND', period: 'month' },
        priceVnd: 8_000_000,
        sourceId: 'official:ocean-home.example',
        sourceType: 'official-web',
        url: 'https://ocean-home.example/rooms/studio',
      }),
      webOffer({
        collectedAt: '2026-09-21T02:00:00.000Z',
        id: 'booking:fourth',
        officialUrl: 'https://ocean-home.example/rooms/studio',
        price: { amount: 9_000_000, currency: 'VND', period: 'month' },
        priceVnd: 9_000_000,
        sourceId: 'official:ocean-home.example',
        sourceType: 'official-web',
        url: 'https://ocean-home.example/rooms/studio',
      }),
    ])[0];

    expect(history.priceHistory.length).toBe(4);
    expect(history.priceChanges.map((change) => change.direction)).toEqual([
      'down',
      'up',
    ]);
    expect(history.priceChanges[0].currentPriceVnd).toBe(8_000_000);
    expect(history.priceChanges[0].deltaVnd).toBe(-2_000_000);
    expect(history.priceChanges[0].previousPriceVnd).toBe(10_000_000);
    expect(history.priceChanges[0].sourceId).toBe(
      'official:ocean-home.example'
    );
    expect(history.priceChange.direction).toBe('up');
    expect(history.priceChange.deltaVnd).toBe(1_000_000);
  });

  it('does not report social repost prices as official-site changes', () => {
    const result = deduplicateOffers([
      webOffer({
        id: 'telegram:old',
        sourceId: 'telegram:rent',
        sourceType: 'telegram',
      }),
      webOffer({
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'telegram:new',
        priceVnd: 8_000_000,
        sourceId: 'telegram:rent',
        sourceType: 'telegram',
      }),
    ])[0];

    expect(result.priceChanges).toEqual([]);
    expect(result.priceChange).toBe(undefined);
  });

  it('does not label marketplace price movements as official-site changes', () => {
    const result = deduplicateOffers([
      webOffer(),
      webOffer({
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'booking:new',
        priceVnd: 8_000_000,
      }),
    ])[0];

    expect(result.priceHistory.length).toBe(2);
    expect(result.priceChanges).toEqual([]);
  });
});

describe('persisted accommodation reconciliation', () => {
  it('persists merged history across independent store writes', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-reconciliation-'));
    const store = new LinksStore({ directory });

    await store.saveOffers([officialOffer()]);
    await store.saveOffers([
      officialOffer({
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'booking:later',
        priceVnd: 8_000_000,
      }),
    ]);

    const restored = await store.listOffers();
    expect(restored.length).toBe(1);
    expect(restored[0].priceHistory.length).toBe(2);
    expect(restored[0].priceChange.direction).toBe('down');
    expect(
      (await readFile(store.offersPath, 'utf8')).startsWith('(offer')
    ).toBe(true);
  });

  it('retains previously learned aliases on later writes', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'offer-aliases-'));
    const store = new LinksStore({ directory });
    const booking = webOffer({
      contacts: { phone: ['+84123456789'], telegram: [] },
    });
    const telegram = webOffer({
      contacts: { phone: ['+84123456789'], telegram: [] },
      id: 'telegram:alias',
      officialUrl: undefined,
      sourceId: 'telegram:rent',
      sourceType: 'telegram',
      url: 'https://t.me/rent/10',
    });

    await store.saveOffers([booking, telegram]);
    await store.saveOffers([
      webOffer({
        contacts: undefined,
        id: 'booking:later',
      }),
    ]);

    const restored = await store.listOffers();
    expect(restored.length).toBe(1);
    expect(restored[0].sourceIds).toEqual(['booking', 'telegram:rent']);
    expect(restored[0].variants.length).toBe(3);
  });

  it('shows detected price movement in bot and CLI output', () => {
    const offer = deduplicateOffers([
      officialOffer(),
      officialOffer({
        collectedAt: '2026-09-21T00:00:00.000Z',
        id: 'booking:new',
        priceVnd: 8_000_000,
      }),
    ])[0];

    expect(formatSearchResults([offer])).toContain(
      'Price down 2,000,000 VND on official:ocean-home.example'
    );
  });
});
