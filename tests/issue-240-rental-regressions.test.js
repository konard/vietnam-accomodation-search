import { describe, it, expect } from 'test-anywhere';
import { parsePrice } from '../src/pricing.js';
import { normalizeOffer, deduplicateOffers } from '../src/offers.js';
import { classifyTelegramPost } from '../src/telegram-pipeline.js';
import { compareOfferValue } from '../src/value-pricing.js';

const offer = (text, extra = {}) => normalizeOffer({ text, ...extra });
describe('repository-wide rental regressions (#229–#238)', () => {
  it('retains suspicious literal prices for review without inventing scales', () => {
    for (const text of [
      '🔥 2BR в Oceanus | 2 мин до моря | 15 млн\nСдаётся квартира в Нячанге\n💰 15 VND / мес\n💵 Депозит - 1 месяц',
      'Studio for rent. Price: 4.2 VND/month',
    ]) {
      expect(offer(text).attributes.reviewRequired).toBe(true);
      expect(offer(text).priceVnd < 100).toBe(true);
    }
    expect(
      offer('Studio for rent. 4.2 million VND/month').attributes.reviewRequired
    ).not.toBe(true);
  });
  it('keeps management, combo and utility section estimates out of rent ranges', () => {
    for (const fees of [
      'Менеджмент 500.000 VND, интернет 250.000 VND, оплата электричества и воды по счетчикам.',
      'Combo fee: 500,000 VND/month',
      'Коммунальные платежи:\nЭлектричество по счетчику\n500,000 VND/month',
    ]) {
      expect(parsePrice(`16 млн VND/месяц\n${fees}`)).toEqual({
        amount: 16000000,
        currency: 'VND',
        period: 'month',
      });
    }
    expect(
      parsePrice(
        'Rent 12 months: 5 million VND/month\nRent 6 months: 6 million VND/month'
      ).range
    ).toEqual({ min: 5000000, max: 6000000 });
  });
  it('excludes market guides, negated examples, cleaning advice and service footers', () => {
    for (const text of [
      'Сколько стоит аренда в Нячанге? Октябрь 2026.\nХватит сказок про студии за 4 млн.\nСевер / Центр — 6,5 - 9.5 млн',
      'Cleaning advice: how to clean your apartment. Rental prices 4 million VND/month.',
      'Visa border service: 50 USD.\nApartments for rent in Nha Trang',
    ]) {
      expect(classifyTelegramPost(text).eligible).toBe(false);
      expect(offer(text).attributes.reviewRequired).toBe(true);
    }
    expect(
      classifyTelegramPost(
        'Studio for rent in Nha Trang. 5 million VND/month. Contact owner.'
      ).eligible
    ).toBe(true);
  });
  it('excludes a split monetary token without joining separate counts', () => {
    expect(
      parsePrice('Studio for rent in Nha Trang.\n💸 1\n3,500,000 VND/month')
    ).toBe(null);
    expect(
      offer('Studio for rent.\n💸 1\n3,500,000 VND/month').attributes
        .reviewRequired
    ).toBe(true);
    expect(parsePrice('Floor 1\n3,500,000 VND/month').amount).toBe(3500000);
    expect(parsePrice('Bedrooms: 1\n3,500,000 VND/month').amount).toBe(3500000);
  });
  it('retains bed alternatives without supplying a definite denominator', () => {
    const alternative = offer(
      'Cho thuê studio Nha Trang. Studio 1 hoặc 2 giường. Giá 5 triệu/tháng.'
    );
    expect(alternative.attributes.bedsRange).toEqual({ min: 1, max: 2 });
    expect(compareOfferValue(alternative).pricePerBedVnd).toBe(undefined);
    expect(
      compareOfferValue(offer('Studio for rent. 2 beds. 5 million VND/month'))
        .pricePerBedVnd
    ).toBe(2500000);
    expect(
      offer('2 bedrooms. Apartment for rent. 5 million VND/month').attributes
        .beds
    ).toBe(undefined);
  });
  it('preserves absent and shared amenities independently of positive ones', () => {
    for (const text of [
      'không có máy giặt',
      'no washing machine',
      'без стиральной машины',
    ]) {
      const attributes = offer(
        `Studio for rent. 5 million VND/month. ${text}`
      ).attributes;
      expect(attributes.amenities.includes('washing-machine')).toBe(false);
      expect(attributes.absentAmenities.includes('washing-machine')).toBe(true);
    }
    expect(
      offer(
        'Studio for rent. Có máy giặt. 5 triệu/tháng'
      ).attributes.amenities.includes('washing-machine')
    ).toBe(true);
    expect(
      offer(
        'Studio for rent. Shared washing machine. 5 million VND/month'
      ).attributes.sharedAmenities.includes('washing-machine')
    ).toBe(true);
    expect(
      offer('Studio for rent. 5 million VND/month').attributes.absentAmenities
    ).toEqual([]);
  });
  it('uses only selected rent quotes for billing scope', () => {
    expect(
      offer(
        'Apartment for rent in Nha Trang. Price: 3.5 million VND/month.\n• Water:120,000VND/person\n• Management:200,000VND/person'
      ).priceBasis
    ).toBe('property');
    expect(
      offer(
        'Apartment for rent. Price: 3.5 million VND/month Water:120,000VND/person Management:200,000VND/person'
      ).priceBasis
    ).toBe('property');
    for (const basis of ['person', 'bed', 'room']) {
      expect(
        offer(`Room for rent. 3 million VND/month per ${basis}`).priceBasis
      ).toBe(basis);
    }
    expect(
      parsePrice('• Water:120,000VND/person\n• Management:200,000VND/person')
    ).toBe(null);
  });
  it('keeps distinct units separate when an agency contact is the only evidence', () => {
    const unit = (id, amount, description) =>
      offer(
        `Studio for rent in Nha Trang. ${description} Price: ${amount} million VND/month.`,
        {
          title: 'QA-HOME',
          sourceId: 'telegram:qa_agency',
          sourceType: 'telegram',
          url: `https://t.me/qa_agency/${id}`,
          contacts: { phone: ['+84000000000'] },
        }
      );
    expect(
      deduplicateOffers([
        unit(1, 3.5, 'Shared kitchen.'),
        unit(2, 4.2, 'No kitchen.'),
      ]).length
    ).toBe(2);
    expect(
      deduplicateOffers([
        unit(1, 3.5, 'Shared kitchen.'),
        unit(1, 4.2, 'Shared kitchen.'),
      ]).length
    ).toBe(1);
  });
  it('keeps the selected quote, URL, title, raw evidence and counts together', () => {
    const unit = (source, amount, day, bedrooms) =>
      offer(`Apartment for rent. ${amount} million VND/month`, {
        id: source,
        sourceId: source,
        url: `https://example.com/${source}`,
        title: source,
        raw: { text: source },
        postedAt: `2026-10-${day}T00:00:00Z`,
        attributes: { bedrooms },
        identifiers: { property: 'qa-property' },
      });
    const lower = unit('lower', 5, 10, 1),
      newer = unit('newer', 18, 11, 3);
    const [merged] = deduplicateOffers([lower, newer]);
    expect(merged.priceVnd).toBe(5000000);
    expect(merged.url).toBe(lower.url);
    expect(merged.title).toBe(lower.title);
    expect(merged.raw).toEqual(lower.raw);
    expect(merged.attributes.bedrooms).toBe(1);
    expect(merged.variants.length).toBe(2);
    const [edited] = deduplicateOffers([lower, unit('lower', 19, 12, 2)]);
    expect(edited.priceVnd).toBe(19000000);
    expect(edited.attributes.bedrooms).toBe(2);
  });
});
