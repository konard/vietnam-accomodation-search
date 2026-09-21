import { describe, expect, it } from 'test-anywhere';

import {
  normalizeOffer,
  parsePrice,
  parseSearchCommand,
  parseTelegramOffer,
} from '../src/index.js';

describe('accommodation offer normalization', () => {
  it('parses Vietnamese, international, and colloquial prices', () => {
    expect(parsePrice('Price: 15.000.000 VND / month')).toEqual({
      amount: 15000000,
      currency: 'VND',
      period: 'month',
    });
    expect(parsePrice('$550/month')).toEqual({
      amount: 550,
      currency: 'USD',
      period: 'month',
    });
    expect(parsePrice('Giá thuê 12,5 triệu/tháng')).toEqual({
      amount: 12500000,
      currency: 'VND',
      period: 'month',
    });
  });

  it('prefers an explicitly quoted VND price and limits photos to ten', async () => {
    const offer = await normalizeOffer(
      {
        sourceId: 'telegram:danang-rent',
        title: 'Studio by My Khe beach',
        text: '500 USD/month (13.000.000 VND/month)',
        photos: Array.from(
          { length: 12 },
          (_, index) => `https://img.example/${index}.jpg`
        ),
      },
      { rates: { USD: 26000 } }
    );

    expect(offer.price).toEqual({
      amount: 13000000,
      currency: 'VND',
      period: 'month',
    });
    expect(offer.priceVnd).toBe(13000000);
    expect(offer.photos.length).toBe(10);
  });

  it('converts foreign prices to VND through an injected rate table', async () => {
    const offer = await normalizeOffer(
      {
        sourceId: 'booking',
        title: 'Riverside hotel',
        text: 'US$ 40 per night',
      },
      { rates: { USD: 25500 } }
    );

    expect(offer.priceVnd).toBe(1020000);
    expect(offer.price.period).toBe('night');
  });
});

describe('Telegram listing parsing', () => {
  it('normalizes a multilingual rental post', async () => {
    const offer = await parseTelegramOffer(
      {
        chat: { username: 'DaNangRentAFlat', title: 'Da Nang rentals' },
        date: 1789948800,
        messageId: 42,
        text: [
          'Квартира с 1 спальней / 1 bedroom apartment',
          'Address: My An, Da Nang',
          'Price for 1 month: 12 million VND/month',
          'Contact: @landlord',
        ].join('\n'),
        photos: ['https://img.example/flat.jpg'],
      },
      { now: new Date('2026-09-21T00:00:00Z') }
    );

    expect(offer.title).toBe('Квартира с 1 спальней / 1 bedroom apartment');
    expect(offer.location).toBe('My An, Da Nang');
    expect(offer.kind).toBe('apartment');
    expect(offer.priceVnd).toBe(12000000);
    expect(offer.url).toBe('https://t.me/DaNangRentAFlat/42');
  });

  it('rejects posts older than the two-month collection window', async () => {
    const offer = await parseTelegramOffer(
      {
        chat: { username: 'old_listings' },
        date: 1782000000,
        messageId: 1,
        text: 'Old room\nPrice: 3 million VND/month',
      },
      { now: new Date('2026-09-21T00:00:00Z') }
    );

    expect(offer).toBe(null);
  });
});

describe('/search command parsing', () => {
  it('defaults --cheapest to one result', () => {
    expect(parseSearchCommand('/search --cheapest Da Nang')).toEqual({
      cheapest: true,
      limit: 1,
      query: 'Da Nang',
    });
  });

  it('accepts an explicit result count', () => {
    expect(parseSearchCommand('/search --cheapest 10 Nha Trang')).toEqual({
      cheapest: true,
      limit: 10,
      query: 'Nha Trang',
    });
  });

  it('rejects invalid and excessive result counts', () => {
    expect(() => parseSearchCommand('/search --cheapest 0')).toThrow();
    expect(() => parseSearchCommand('/search --cheapest 51')).toThrow();
  });
});
