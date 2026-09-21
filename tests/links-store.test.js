import { describe, expect, it } from 'test-anywhere';

import {
  deserializeOffers,
  deserializeSources,
  serializeOffers,
  serializeSources,
} from '../src/index.js';

describe('Links Notation persistence', () => {
  it('round-trips normalized offers and the complete raw record', () => {
    const offers = [
      {
        id: 'offer-1',
        sourceId: 'telegram:rent',
        title: "Owner's sea-view studio",
        kind: 'room',
        location: 'Đà Nẵng',
        price: { amount: 400, currency: 'USD', period: 'month' },
        priceVnd: 10200000,
        url: 'https://t.me/rent/1',
        photos: ['https://img.example/a.jpg'],
        postedAt: '2026-09-20T12:00:00.000Z',
        collectedAt: '2026-09-21T00:00:00.000Z',
        raw: { text: 'raw\nmultilingual dữ liệu', views: 123 },
      },
    ];

    const notation = serializeOffers(offers);
    const restored = deserializeOffers(notation);

    expect(notation.startsWith('(offer')).toBe(true);
    expect(restored).toEqual(offers);
  });

  it('round-trips ranked source evidence', () => {
    const sources = [
      {
        id: 'telegram:rent',
        name: 'Vietnam rent',
        type: 'telegram',
        url: 'https://t.me/vietnam_rent',
        popularity: {
          metric: 'members',
          value: 12000,
          evidenceUrl: 'https://t.me/vietnam_rent',
          observedAt: '2026-09-21T00:00:00.000Z',
        },
      },
    ];

    expect(deserializeSources(serializeSources(sources))).toEqual(sources);
  });
});
