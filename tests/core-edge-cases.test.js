import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  ExchangeRateProvider,
  LinksStore,
  MediaCache,
  TelegramAvailabilityService,
  canonicalizeOfferUrl,
  convertToVnd,
  deserializeOffers,
  parseListingText,
  parseLabeledFields,
  parsePrice,
  parseSearchCommand,
  parseTelegramOffer,
  serializeOffers,
} from '../src/index.js';

async function caught(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('pricing edge cases', () => {
  it('parses every supported billing period and conversion fallback', () => {
    expect(parsePrice('£700 per week').period).toBe('week');
    expect(parsePrice('€1.200 per year')).toEqual({
      amount: 1200,
      currency: 'EUR',
      period: 'year',
    });
    expect(parsePrice('2 billion VND/month').amount).toBe(2_000_000_000);
    expect(convertToVnd(null)).toBe(null);
    expect(convertToVnd({ amount: 5, currency: 'CAD' })).toBe(null);
  });

  it('reads a rent stated in roubles', () => {
    expect(parsePrice('38 616 ₽\n/мес')).toEqual({
      amount: 38_616,
      currency: 'RUB',
      period: 'month',
    });
    expect(parsePrice('45 000 руб. в месяц').currency).toBe('RUB');
    expect(parsePrice('40 000 рублей/мес').amount).toBe(40_000);
    expect(parsePrice('RUB 30000 per month').currency).toBe('RUB');
    expect(convertToVnd(parsePrice('30 000 ₽/мес'), { RUB: 300 })).toBe(
      9_000_000
    );
  });

  it('loads, validates, and caches exchange rates', async () => {
    let requests = 0;
    const provider = new ExchangeRateProvider({
      fetchImpl: async () => {
        requests += 1;
        return {
          json: async () => ({
            rates: { EUR: 0, GBP: undefined, USD: 0.00004 },
          }),
          ok: true,
        };
      },
    });

    expect(Math.round((await provider.getRates()).USD)).toBe(25_000);
    expect(Math.round((await provider.getRates()).USD)).toBe(25_000);
    expect(requests).toBe(1);
  });

  it('keeps the last rates when the provider rejects or returns an error', async () => {
    const unavailable = new ExchangeRateProvider({
      fetchImpl: async () => ({ ok: false }),
    });
    const rejected = new ExchangeRateProvider({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    expect(await unavailable.getRates()).toEqual({ VND: 1 });
    expect(await rejected.getRates()).toEqual({ VND: 1 });
  });
});

describe('parser validation edges', () => {
  it('preserves explicit negative facts and rejects invalid dates and coordinates', () => {
    const parsed = parseListingText(
      'Room\nunfurnished; no pets; utilities not included\n' +
        'available 31/02/2026\nGPS: 99, 999'
    );

    expect(parsed.attributes.furnished).toBe(false);
    expect(parsed.attributes.petsAllowed).toBe(false);
    expect(parsed.attributes.utilitiesIncluded).toBe(false);
    expect(parsed.attributes.availableFrom).toBe(undefined);
    expect(parsed.attributes.latitude).toBe(undefined);
  });

  it('reads a property id only from a coded token after its label', () => {
    const id = (text) => parseListingText(text).attributes.propertyId;

    expect(id('ID: A2293 квартира')).toBe('A2293');
    expect(id('Căn hộ mã căn A12, 8 triệu/tháng')).toBe('A12');
    expect(id('Код объекта 515, студия')).toBe('515');
    expect(id('🆔 Код квартиры: LĐH-57302 (LX)')).toBe('LĐH-57302');
    expect(id('Код квартиры: GHTN-TT')).toBe('GHTN-TT');
    expect(id('КОД КВАРТИРЫ: проверим')).toBe(undefined);
    expect(id('Idea house near the beach')).toBe(undefined);
    expect(id('Mã căn đẹp, view biển')).toBe(undefined);
  });

  it('reads a count from the label on its own line only', () => {
    const facts = (text) => parseListingText(text).attributes;

    const card = facts('ID A902\nbathrooms: 1\nbedrooms: 2');
    expect([card.bathrooms, card.bedrooms]).toEqual([1, 2]);
    expect(facts('3-Bedroom House for Rent').bedrooms).toBe(3);
    const stay = facts('beds: 2\n3\nguests: 4');
    expect([stay.beds, stay.guests]).toEqual([2, 4]);
    expect(facts('Floor 5\n2 bathrooms').bathrooms).toBe(2);
  });

  it('takes no area or deposit fact for a labelled location', () => {
    const place = (text) => parseListingText(text).location;

    expect(place('location: Area m²: 60\n$360/mo')).toBe(undefined);
    expect(place('location: Deposit: $393\nLocation: North')).toBe('North');
    expect(place('Location: Hà Quang 2')).toBe('Hà Quang 2');
  });

  it('rejects empty recent Telegram posts and non-web URLs', () => {
    expect(
      parseTelegramOffer(
        { date: '2026-09-21T00:00:00Z', text: '   \n' },
        { now: new Date('2026-09-21T00:00:00Z') }
      )
    ).toBe(null);
    expect(canonicalizeOfferUrl('mailto:owner@example.com')).toBe(undefined);
    expect(canonicalizeOfferUrl()).toBe(undefined);
    expect(parseLabeledFields()).toEqual({});
    expect(
      parseListingText('Book: https://market.example/room/7').officialUrl
    ).toBe(undefined);
    expect(
      parseListingText('Official: https://t.me/rental_owner').officialUrl
    ).toBe(undefined);
  });

  it('rejects malformed and unsafe search filters', () => {
    expect(() => parseSearchCommand('/search --filter missing')).toThrow();
    expect(() =>
      parseSearchCommand('/search --filter __proto__.polluted=true')
    ).toThrow();
    expect(() => parseSearchCommand('/search --filter kind=')).toThrow();
  });
});

describe('Links Notation store edges', () => {
  it('persists sources and enforces a zero-byte offer budget', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'store-edges-'));
    try {
      const store = new LinksStore({ directory, maxBytes: 0 });
      await store.saveSources([{ id: 'one', type: 'web' }]);
      expect(await store.loadSources()).toEqual([{ id: 'one', type: 'web' }]);
      await store.saveOffers([
        {
          collectedAt: '2020-09-21T00:00:00Z',
          id: 'one',
          priceVnd: 1,
          sourceId: 'web',
          title: 'Room',
        },
      ]);
      expect(await store.listOffers()).toEqual([]);
      expect(await readFile(store.offersPath, 'utf8')).toBe('');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('propagates unexpected read errors and accepts sparse records', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'store-read-error-'));
    try {
      const store = new LinksStore({ directory });
      store.offersPath = directory;
      const error = await caught(() => store.listOffers());
      expect(error.code).toBe('EISDIR');
      const notation = serializeOffers([{ title: 'Sparse record' }]);
      expect(deserializeOffers(notation)).toEqual([{ title: 'Sparse record' }]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('stores unrelated offers from newest to oldest', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'store-order-'));
    try {
      const store = new LinksStore({ directory });
      await store.saveOffers([
        {
          collectedAt: '2026-09-20T00:00:00Z',
          id: 'old',
          sourceId: 'one',
          title: 'Old room',
        },
        {
          collectedAt: '2026-09-21T00:00:00Z',
          id: 'new',
          sourceId: 'two',
          title: 'New room',
        },
      ]);

      expect((await store.listOffers()).map((offer) => offer.id)).toEqual([
        'new',
        'old',
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe('media cache edges', () => {
  it('handles missing directories and individual download failures', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = join(tmpdir(), `missing-media-${Date.now()}`);
    const cache = new MediaCache({
      directory,
      fetchImpl: async (url) =>
        url.includes('bad')
          ? { ok: false, status: 503 }
          : new globalThis.Response(new Uint8Array([1, 2])),
    });
    const offers = [
      { photos: ['https://bad.example/a.jpg', 'https://ok.example'] },
    ];

    expect(await cache.enforceBudget()).toEqual({ removed: [], usage: 0 });
    await cache.cacheOffers(offers);
    expect(offers[0].cachedPhotos.length).toBe(1);
    expect(offers[0].cachedPhotos[0].path.endsWith('.img')).toBe(true);
    await rm(directory, { force: true, recursive: true });
  });

  it('propagates filesystem errors other than a missing directory', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'media-file-'));
    const file = join(directory, 'not-a-directory');
    try {
      await writeFile(file, 'data');
      const error = await caught(() =>
        new MediaCache({ directory: file }).enforceBudget()
      );
      expect(error.code).toBe('ENOTDIR');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe('availability validation edges', () => {
  it('reports missing offers and invalid recipients before creating a client', async () => {
    const missing = new TelegramAvailabilityService({
      apiHash: 'hash',
      apiId: 1,
      session: 'session',
    });
    expect((await caught(() => missing.check('absent'))).message).toContain(
      'Offer not found'
    );

    const invalid = new TelegramAvailabilityService({
      apiHash: 'hash',
      apiId: 1,
      session: 'session',
      store: { listOffers: async () => [{ id: 'one', title: 'Room' }] },
    });
    expect((await caught(() => invalid.check('one'))).message).toContain(
      'valid Telegram owner'
    );
  });

  it('uses an explicit inquiry and normalizes Telegram profile URLs', async () => {
    const messages = [];
    const service = new TelegramAvailabilityService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => {},
        sendText: async (...args) => messages.push(args),
        start: async () => {},
      }),
      session: 'session',
      store: { listOffers: async () => [{ id: 'one' }] },
    });

    const result = await service.check('one', {
      message: 'Custom inquiry',
      recipient: 'https://www.t.me/valid_owner/path',
    });
    expect(messages).toEqual([['@valid_owner', 'Custom inquiry']]);
    expect(result.messageId).toBe(undefined);
  });
});
