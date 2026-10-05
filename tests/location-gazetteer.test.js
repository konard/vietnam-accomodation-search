import { describe, expect, it } from 'test-anywhere';

import { parseListingText, parseTelegramOffer } from '../src/index.js';

const located = (text, options) => {
  const { location, locationProvenance } = parseListingText(text, options);
  return { location, method: locationProvenance.method };
};

// Anonymised excerpts of live Nha Trang rental posts.
describe('Nha Trang place names without a location label', () => {
  it('names the complex a post is in', () => {
    expect(
      located(
        '(12 этаж) Строение OC2B Muong Thanh Vien Trieu\n60м². 2 Спальни\nСтоимость аренды 9млн/VND'
      )
    ).toEqual({
      location: 'Mường Thanh Viễn Triều, Nha Trang',
      method: 'gazetteer',
    });
    expect(
      located('🔥Аренда квартиры в Нячанге | Oceanus | 2 спальни | 22 мл VND')
    ).toEqual({ location: 'Oceanus, Nha Trang', method: 'gazetteer' });
    expect(located('Căn hộ ACC Vườn Xoài, giá 6tr/tháng, Nha Trang')).toEqual({
      location: 'Vườn Xoài, Nha Trang',
      method: 'gazetteer',
    });
  });

  it('names the Mường Thanh tower and Napoleon a listing card is in', () => {
    expect(
      located('Apartment for rent with sea view in Muong Thanh Khanh Hoa')
        .location
    ).toBe('Mường Thanh Khánh Hòa, Nha Trang');
    expect(
      located('Apartment for rent with sea view in Napoleon ID A896', {
        locationHint: 'Nha Trang, Vietnam',
      }).location
    ).toBe('Napoleon Castle, Nha Trang');
    expect(located('Napoleon apartment in Hanoi').location).toBe('Hanoi');
  });

  it('prefers a complex over the street and ward around it', () => {
    expect(
      located('Квартира Hà Quang 1, Phước Hải, Нячанг. 8 млн VND').location
    ).toBe('Hà Quang, Nha Trang');
    expect(
      located('Квартира 60 m2, 15 этаж, Mường Thanh 60 Trần Phú, Нячанг')
        .location
    ).toBe('Trần Phú, Nha Trang');
  });

  it('reads streets and wards with or without diacritics', () => {
    expect(located('Studio on Hung Vuong, Nha Trang 7M VND').location).toBe(
      'Hùng Vương, Nha Trang'
    );
    expect(
      located('Phòng trọ Vĩnh Trường giá 3 triệu', {
        locationHint: 'Nha Trang, Vietnam',
      }).location
    ).toBe('Vĩnh Trường, Nha Trang');
  });

  it('reads Russian names for parts of the city', () => {
    expect(located('🌿 Дом с 3 спальнями на Севере Нячанга').location).toBe(
      'North Nha Trang'
    );
    expect(located('СТУДИЯ 25 м² — СЕВЕРНАЯ ЧАСТЬ НЯЧАНГА').location).toBe(
      'North Nha Trang'
    );
    expect(located('Сдается квартира в самом центре Нячанга!').location).toBe(
      'Central Nha Trang'
    );
  });

  it('reads numbered Chinese district names as Ho Chi Minh City', () => {
    expect(located('九郡 大都市Vinhomes Grand Park两房公寓出租').location).toBe(
      'Ho Chi Minh City'
    );
    expect(located('北江 DIAMOND HILL三房出租').location).toBe(undefined);
  });

  it('reads a bare "(Центр)" in a Nha Trang post as the city centre', () => {
    expect(
      located('📍  Квартира (Центр) \n\n3 гостя, 1 спальня', {
        locationHint: 'Nha Trang, Vietnam',
      }).location
    ).toBe('Central Nha Trang');
    expect(located('📍  Квартира (Центр) \n\n3 гостя').location).toBe(
      undefined
    );
  });

  it('keeps common street names out of posts about other cities', () => {
    expect(located('Готовый объект на улице Tran Hung Dao, Фукуок')).toEqual({
      location: 'Phu Quoc',
      method: 'gazetteer',
    });
    expect(
      located('Căn hộ đường Trần Phú, Đà Nẵng', {
        locationHint: 'Nha Trang, Vietnam',
      }).location
    ).toBe('Da Nang');
    expect(located('Квартира на Tran Phu, 10 млн').location).toBe(undefined);
  });

  it('does not read place names out of ordinary words', () => {
    for (const text of [
      'Панорамный вид на море, Нячанг',
      'Квартира в новом доме, Нячанг',
      'Studio with my gift card, Nha Trang',
    ]) {
      expect(located(text).location).toBe('Nha Trang');
    }
  });

  it('falls back to the one city a post names', () => {
    expect(located('Nha Trang 2 BHK 9.5 млн + Депозит 100%')).toEqual({
      location: 'Nha Trang',
      method: 'gazetteer',
    });
    expect(located('Сдается отель на о. Фукуок, Вьетнам').location).toBe(
      'Phu Quoc'
    );
    expect(located('河內市中心兩房出租 租金 1000 美金').location).toBe('Hanoi');
    expect(located('Сдается квартира, 10 млн VND')).toEqual({
      location: undefined,
      method: 'not-mentioned',
    });
  });

  it('names no city when a post lists several', () => {
    const flights = 'Рейсы в Хошимин и в Нячанг из Москвы';
    expect(located(flights).location).toBe(undefined);
    expect(located(`${flights}. Квартира на Tran Phu`).location).toBe(
      undefined
    );
    expect(
      located(`${flights}. Квартира на Tran Phu`, {
        locationHint: 'Nha Trang, Vietnam',
      }).location
    ).toBe('Trần Phú, Nha Trang');
  });
});

describe('location labels', () => {
  it('reads the bullets under an empty location label', () => {
    expect(
      located(
        '🌿 Квартира с 2 спальнями в Oceanus\n📍 Локация:\n• Север Нячанга\n• ЖК Oceanus, корпус OC1A\n• ≈ 2 минуты пешком до моря'
      )
    ).toEqual({
      location: 'Север Нячанга, ЖК Oceanus, корпус OC1A',
      method: 'labeled-text',
    });
    expect(
      located('📍 Локация:\n• Юг Нячанга\n💰 8 млн VND\n• Бассейн').location
    ).toBe('Юг Нячанга');
  });

  it('reads a pinned line as the location', () => {
    expect(
      located(
        '🩶🏠 Квартира — Phước Long\n📍 Южный Нячанг | 4 этаж\n7 500 000 VND'
      )
    ).toEqual({ location: 'Южный Нячанг', method: 'labeled-text' });
    expect(located('Vị trí: 12 Biệt Thự, Lộc Thọ').location).toBe(
      '12 Biệt Thự, Lộc Thọ'
    );
  });

  it('ends a pinned line at the next emoji and skips pinned headings', () => {
    expect(
      located(
        '📍 РАСПОЛОЖЕНИЕ И УДОБСТВА:\n• Рядом супермаркеты\n📍 Центр – Лок Тхо 🌊 500 м от пляжа'
      ).location
    ).toBe('Центр – Лок Тхо');
    expect(located('📍 Улица T23, Ан Бинь Тан\n📐 Студия').location).toBe(
      'Улица T23, Ан Бинь Тан'
    );
    expect(located('📍 Природа и удобное расположение').location).toBe(
      undefined
    );
  });

  it('uses the source location as the hint for Telegram posts', async () => {
    const offer = await parseTelegramOffer(
      {
        date: new Date('2026-09-20T00:00:00Z'),
        inheritedLocation: 'Nha Trang, Vietnam',
        sourceId: 'telegram:sample',
        text: 'Phòng trọ Phước Long giá 3 triệu/tháng',
      },
      { now: new Date('2026-09-21T00:00:00Z') }
    );
    expect(offer.location).toBe('Phước Long, Nha Trang');
    expect(offer.locationProvenance).toEqual({
      method: 'gazetteer',
      source: 'message-text',
    });
  });
});
