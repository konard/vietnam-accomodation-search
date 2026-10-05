import { describe, expect, it } from 'test-anywhere';

import {
  deduplicateOffers,
  normalizeOffer,
  parseListingText,
  parseSearchCommand,
  SearchService,
} from '../src/index.js';

const availability = (text) => {
  const { availability: state, availableNow } =
    parseListingText(text).attributes;
  return { availability: state, availableNow };
};

// Anonymised excerpts of live Nha Trang rental posts.
describe('sold-out markers', () => {
  it('marks an edited post as unavailable over its "free now" line', () => {
    expect(
      availability(
        '❌Sold out‼️\n\nСВОБОДНА СЕЙЧАС!\nМожно посмотреть и заселиться сегодня'
      )
    ).toEqual({ availability: 'unavailable', availableNow: false });
    expect(availability('❌Sold out ❗️❗️❗️\nALAB\n\n🏙️ АРЕНДА')).toEqual({
      availability: 'unavailable',
      availableNow: false,
    });
  });

  it('recognises rented and occupied markers in Russian', () => {
    for (const text of [
      'СДАНА ✅\nКвартира 2 спальни, 12 млн VND',
      'Квартира уже сдана, спасибо',
      'Студия занята до 1 декабря',
      'Неактуально. Квартира 1BR',
    ]) {
      expect(availability(text).availability).toBe('unavailable');
    }
  });

  it('recognises rented and occupied markers in English and Vietnamese', () => {
    for (const text of [
      'RENTED OUT - Studio near the beach 8M VND',
      'Already rented, thank you',
      'No longer available. 2BR apartment',
      'ĐÃ CHO THUÊ - Căn hộ 2PN giá 9tr/tháng',
      'Hết phòng! Phòng trọ giá 3 triệu',
      'Căn hộ đã có người thuê',
    ]) {
      expect(availability(text).availability).toBe('unavailable');
    }
  });

  it('leaves open listings and look-alike wording available', () => {
    expect(availability('СВОБОДНА СЕЙЧАС! Сдаётся квартира 55 м²')).toEqual({
      availability: 'available',
      availableNow: true,
    });
    for (const text of [
      'Сдаётся квартира, дом сдан в эксплуатацию в 2020',
      'Квартира не занята, можно заселиться',
      'Apartment can be rented for 6 months',
      'Cho thuê căn hộ 2PN giá 9tr/tháng',
    ]) {
      expect(availability(text)).toEqual({
        availability: undefined,
        availableNow: undefined,
      });
    }
  });

  it('follows the newest copy when a post is edited after renting', async () => {
    const posted = { sourceId: 'telegram:sample', url: 'https://t.me/s/1' };
    const open = await normalizeOffer(
      { ...posted, text: 'СВОБОДНА СЕЙЧАС! 12 млн VND' },
      { now: new Date('2026-09-01T00:00:00Z') }
    );
    const sold = await normalizeOffer(
      { ...posted, text: '❌Sold out‼️\nСВОБОДНА СЕЙЧАС! 12 млн VND' },
      { now: new Date('2026-09-02T00:00:00Z') }
    );
    expect(deduplicateOffers([open, sold])[0].attributes.availability).toBe(
      'unavailable'
    );
    const relisted = await normalizeOffer(
      { ...posted, text: 'Квартира 12 млн VND' },
      { now: new Date('2026-09-03T00:00:00Z') }
    );
    const merged = deduplicateOffers([open, sold, relisted])[0].attributes;
    expect(merged.availability).toBe(undefined);
    expect(merged.availableNow).toBe(undefined);
  });
});

describe('search hides unavailable offers', () => {
  const offers = [
    {
      attributes: { availability: 'unavailable', availableNow: false },
      collectedAt: '2026-09-21T00:00:00.000Z',
      id: 'sold',
      priceVnd: 1_000_000,
      sourceId: 'telegram:a',
    },
    {
      attributes: { availableNow: false },
      collectedAt: '2026-09-21T00:00:00.000Z',
      id: 'rented-card',
      priceVnd: 2_000_000,
      sourceId: 'web-a',
    },
    {
      collectedAt: '2026-09-21T00:00:00.000Z',
      id: 'open',
      priceVnd: 3_000_000,
      sourceId: 'telegram:a',
    },
  ];
  const service = () =>
    new SearchService({
      collector: { collect: async () => [] },
      now: () => new Date('2026-09-21T00:00:00Z'),
      registry: { list: async () => [] },
      store: { listOffers: async () => offers, saveOffers: async () => {} },
    });

  it('returns only available offers by default', async () => {
    const found = await service().search({ cheapest: true, refresh: false });
    expect(found.map(({ id }) => id)).toEqual(['open']);
  });

  it('returns unavailable offers when asked for them', async () => {
    const found = await service().search({
      cheapest: true,
      includeUnavailable: true,
      refresh: false,
    });
    expect(found.map(({ id }) => id)).toEqual(['sold', 'rented-card', 'open']);
  });
});

describe('search command availability flag', () => {
  it('parses --include-unavailable out of the query', () => {
    expect(
      parseSearchCommand('/search --include-unavailable --cheapest 5 Nha Trang')
    ).toEqual({
      cheapest: true,
      includeUnavailable: true,
      limit: 5,
      query: 'Nha Trang',
    });
  });
});
