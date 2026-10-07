/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings: true}] -- Dates are the input and expected output of availability parsing. */
import { describe, expect, it } from 'test-anywhere';
import {
  classifyTelegramPost,
  normalizeOffer,
  parseListingText,
  parsePrice,
  parseTelegramOffer,
  reconcileTelegramMaterials,
  SearchService,
} from '../src/index.js';
import {
  expectedDetails,
  missingExpectedDetails,
} from '../experiments/telegram-accommodation-audit-lib.mjs';

const now = new Date('2026-10-07T00:00:00Z');
const parse = (text) =>
  parseTelegramOffer(
    { text, date: now, sourceId: 'telegram:fixture', messageId: 1 },
    { now }
  );
const shared = `Квартира с 1 спальней в Нячанге.
О квартире:
1 Спальня
40 м²
Балкон
Условия аренды:
Цена: 13 млн VND / месяц (первый этаж)
При аренде квартиры на 2–3 этаже: 13.5 млн VND / месяц
Депозит: 1 месяц.`;

describe('reviewed rental field regressions (#123, #124, #131–#134)', () => {
  for (const [text, bedrooms, months] of [
    ['5 отдельные спальни. Аренда от 1 года.', 5, 12],
    ['5 separate bedrooms. Minimum lease of 1 year.', 5, 12],
    ['5 phòng ngủ riêng. Hợp đồng tối thiểu 2 năm.', 5, 24],
  ]) {
    it(`binds explicit counts and years: ${text}`, () => {
      const offer = parse(
        `For rent: house in Nha Trang.\n${text}\n1415 USD/month.`
      );
      expect(offer.attributes.bedrooms).toBe(bedrooms);
      expect(offer.attributes.minimumStayMonths).toBe(months);
      expect(normalizeOffer({ text }).attributes.minimumStayMonths).toBe(
        months
      );
    });
  }
  it('does not borrow IDs, area, another line, or service duration', () => {
    for (const text of [
      'ID A905\nотдельные спальни',
      '50 m² отдельные спальни',
      '5\nотдельные спальни',
      'bedrooms\n5 bathrooms',
      'спальни:\n50 m²',
      'Bedrooms: 50 m²',
      'Bedrooms: 123456789',
      '1 floor, separate bedrooms',
      'Service 1 year. Minimum lease unknown',
    ]) {
      const attrs = parseListingText(text).attributes;
      expect(attrs.bedrooms).toBe(undefined);
      expect(attrs.minimumStayMonths).toBe(undefined);
    }
  });
  it('keeps shared layout for per-floor prices in either order', () => {
    expect(parse(shared).attributes.bedrooms).toBe(1);
    expect(parse(shared.replace('13 млн', '14 млн')).attributes.bedrooms).toBe(
      1
    );
    expect(parse(shared).price.amount).toBe(13_000_000);
    const reversed =
      'For rent: 1BR apartment in Nha Trang.\n17th floor: 15M VND/month\n3rd floor: 12M VND/month';
    expect(parse(reversed).attributes.bedrooms).toBe(1);
    expect(parse(reversed).attributes.floor).toBe(3);
  });
  it('keeps layout unknown for a cheaper independent property or partial floor', () => {
    for (const text of [
      'New apartments in Nha Trang.\nMountain view apartment: 12 million VND/month.\nSea-view Studio: 15 million VND/month.',
      'Дом с 2 спальнями в Нячанге: 25 млн VND/месяц.\nТолько первый этаж, открытое пространство: 18 млн VND/месяц.',
    ]) {
      expect(parse(text).attributes.bedrooms).toBe(undefined);
    }
  });
  for (const dash of ['-', '–', '—', '‑', '‐']) {
    it(`preserves complete explicit property code with ${dash}`, () => {
      const text = `Квартира. Код объекта: AB414${dash}75414.\nContact: +84912345678`;
      expect(parseListingText(text).attributes.propertyId).toBe(
        `AB414${dash}75414`
      );
    });
  }
  it('uses styled rent and terms without changing original contacts or text', () => {
    const text =
      'For rent: 𝟏 bedroom apartment in Nha Trang.\n𝟏𝟖𝐦𝐢𝐥𝐥𝐢𝐨𝐧 𝐕𝐍𝐃/𝐦𝐨𝐧𝐭𝐡\nManagement: 500000 VND/month\nMinimum lease: 𝟏 year\nContact: @Styled_agent';
    const offer = parse(text);
    expect(offer.price.amount).toBe(18_000_000);
    expect(offer.attributes.minimumStayMonths).toBe(12);
    expect(offer.raw.text).toBe(text);
    expect(offer.contacts.telegram).toEqual(['Styled_agent']);
    expect(
      parsePrice(
        '𝟔 months: 𝟏𝟒M VND/month\n𝟑 months: 𝟏𝟓M VND/month\nInternet: 200000 VND/month'
      ).range
    ).toEqual({ min: 14_000_000, max: 15_000_000 });
  });
  for (const [expression, floor] of [
    ['1st floor', 1],
    ['2nd floor', 2],
    ['3rd floor', 3],
    ['17th floor', 17],
    ['floor: 20', 20],
    ['этаж: 6', 6],
    ['tầng 15', 15],
  ]) {
    it(`binds floor ${expression} to its same-line number`, () => {
      expect(
        parseListingText(
          `Unit 1702 is on ${expression}\n3 bedrooms 2 bathrooms`
        ).attributes.floor
      ).toBe(floor);
    });
  }
  it('keeps unstated floors unknown', () => {
    for (const text of [
      'High floor\n3 bedrooms',
      'Высокий этаж. 50m²',
      'floor\n17',
      'floor 50m²',
      'Лифт (этажи 1–3)',
      'floor 1‑3',
      '1–3 floor',
    ]) {
      expect(parseListingText(text).attributes.floor).toBe(undefined);
      expect(expectedDetails(text).includes('floor')).toBe(false);
    }
  });
  for (const [expression, expected] of [
    ['Available on 9th October', '2026-10-09'],
    ['Available from Oct 9, 2026', '2026-10-09'],
    ['Available from 2026-10-09', '2026-10-09'],
    ['Available on 8th Nov', '2026-11-08'],
    ['Available on 2nd January', '2027-01-02'],
  ]) {
    it(`extracts availability ${expression}`, () =>
      expect(
        parse(`For rent: apartment, 9M VND/month. ${expression}`).attributes
          .availableFrom
      ).toBe(expected));
  }
  it('rejects invalid, unlabelled and contradictory availability dates', () => {
    for (const text of [
      'Contract 2026-10-09',
      'Contact on 9th October',
      'Available on 31st February',
      'Available from November 2026 through January 2026',
      'Available from 9-12 October',
      'Available from 9‑12 October',
      'Available from October 9-12',
      'Available on October 200',
      'Available on 10 Marching',
      'Available from 2026-10-09, or 2026-10-12',
      'Available from October 9, alternatively October 12',
    ]) {
      expect(
        parseListingText(text, { referenceDate: now }).attributes.availableFrom
      ).toBe(undefined);
    }
  });
});

describe('reviewed classification and OCR regressions (#125, #135, #136)', () => {
  it('keeps offering prose and actual Nha Trang location', async () => {
    for (const text of [
      'Сдаётся вилла с 6 спальнями в Нячанге.\nПодходит для семей, ищущих тихое место.\n70 млн VND/месяц.',
      'Сдаётся дом с 2 спальнями на Севере Нячанга.\nЛокация: Север Нячанга.\nВид на Далат.\n30 млн VND/месяц.',
      'For rent: studio in Nha Trang, 8M VND/month.\nTen minutes by motorbike from center.',
    ]) {
      expect(classifyTelegramPost(text).eligible).toBe(true);
      expect(
        (
          await reconcileTelegramMaterials([{ id: 1, text }], {
            extract: (m) => parse(m.text),
          })
        ).accepted.length
      ).toBe(1);
    }
  });
  it('excludes true requests, other-city listings, vehicles and goods', () => {
    for (const text of [
      'Ищу квартиру в Нячанге.',
      'For rent: apartment in Da Nang.\nTrips to Nha Trang. 8M VND/month.',
      'Сдам байк в аренду 50сс. 2.5 млн VND/месяц.',
      'Продаю Honda SCR. Байк не сдавался в аренду. Цена 10 млн VND.',
      'Хочу взять мотоцикл в аренду в Нячанге.',
      'For rent: laptop 1M VND/month',
    ]) {
      expect(classifyTelegramPost(text).eligible).toBe(false);
    }
  });
  it('does not parse navigation durations or UI numbers as rent', async () => {
    for (const text of [
      'Sample Villa\n€ 19 phút - 9,3 km',
      'Villa\n€19 minutes - 9.3 km',
      'Apartment\n€19 min',
      'Villa\nReceipt total: €19',
    ]) {
      expect(parsePrice(text)).toBe(null);
      const result = await reconcileTelegramMaterials(
        [{ id: 1, photo: { id: 'map' } }],
        { ocr: async () => text, extract: (m) => parse(m.text) }
      );
      expect(result.accepted.length).toBe(0);
    }
  });
  it('keeps OCR posters reviewable until fields are confirmed', async () => {
    const result = await reconcileTelegramMaterials(
      [{ id: 1, photo: { id: 'poster' } }],
      {
        ocr: async () => 'For rent: studio in Nha Trang. 13 million VND/month.',
        extract: (m) => parse(m.text),
      }
    );
    expect(result.accepted[0].price.amount).toBe(13_000_000);
    expect(
      result.reviewQueue.some(
        ({ reason }) => reason === 'ocr-fields-unverified'
      )
    ).toBe(true);
    expect(result.complete).toBe(false);
  });
  it('uses typed deposits and boolean policies in audit expectations', () => {
    const text =
      'For rent: apartment 8M VND/month.\nDeposit: 20 million VND\n👉 АРЕНДА С ЖИВОТНЫМИ\nElectricity: 4000 VND/kWh';
    expect(missingExpectedDetails(parse(text), text)).toEqual([]);
    expect(expectedDetails('floor: 17')).toContain('floor');
  });
  it('audits the selected property without borrowing an unselected floor', () => {
    const text =
      'For rent in Nha Trang.\nStudio on 17th floor: 15M VND/month\n2BR apartment: 12M VND/month';
    expect(missingExpectedDetails(parse(text), text)).toEqual([]);
    expect(
      missingExpectedDetails({ ...parse(shared), attributes: {} }, shared)
    ).toContain('bedrooms');
    expect(expectedDetails('Rent: 13M VND/month')).toContain('price');
  });
  it('exposes explicit bedrooms and stays to search filters', async () => {
    const offer = parse(
      'For rent: house in Nha Trang. 5 separate bedrooms. Minimum lease of 1 year. 20M VND/month.'
    );
    const search = new SearchService({
      now: () => now,
      registry: { list: async () => [] },
      store: { listOffers: async () => [offer] },
      traceRecorder: { record() {}, async persist() {} },
    });
    expect((await search.search({ refresh: false, bedrooms: 5 })).length).toBe(
      1
    );
  });
});

it('preserves styled money evidence in original UTF-16 coordinates', async () => {
  const { rentalPriceOptions } = await import('../src/pricing.js');
  const text = 'Apartment\nRent: 𝟏𝟖𝐦𝐢𝐥𝐥𝐢𝐨𝐧 𝐕𝐍𝐃/month.';
  const [option] = rentalPriceOptions(text);
  expect(text.slice(option.sourceSpan.start, option.sourceSpan.end)).toBe(
    '𝟏𝟖𝐦𝐢𝐥𝐥𝐢𝐨𝐧 𝐕𝐍𝐃'
  );
});

it('preserves compatibility digits in explicit property identity', () => {
  const code = '𝟏𝟑–A';
  expect(
    parseListingText(`ID: ${code}\nFor rent: studio 13M VND/month`).attributes
      .propertyId
  ).toBe(code);
});
