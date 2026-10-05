import { describe, expect, it } from 'test-anywhere';

import { parseListingText } from '../src/listing-parser.js';

const bedrooms = (text) => parseListingText(text).attributes.bedrooms;

describe('bedroom count', () => {
  it('reads the stated count when an agency footer lists studios', () => {
    expect(
      bedrooms(
        '🌿 Квартира с 2 спальнями в Oceanus\n• 2 Спальни / 2 Санузла\n👉 КВАРТИРЫ И СТУДИИ'
      )
    ).toBe(2);
    expect(
      bedrooms(
        '🌿 Квартира на Юге Нячанга\nЦена: 11 млн VND\n👉 КВАРТИРЫ И СТУДИИ'
      )
    ).toBe(undefined);
  });

  it('reads a studio as zero bedrooms', () => {
    expect(bedrooms('🌿 Студия на Севере Нячанга\n• Студия')).toBe(0);
    expect(bedrooms('СДАЁТСЯ НОВАЯ STUDIO-КВАРТИРА 30 м²')).toBe(0);
    expect(bedrooms('Cho thuê căn hộ studio ngay trung tâm')).toBe(0);
    expect(bedrooms('НОВАЯ КВАРТИРА-СТУДИЯ С БАЛКОНОМ')).toBe(0);
    expect(
      bedrooms('Căn hộ studio\nbedrooms: 1\nbathrooms: 1\ntype: Căn hộ studio')
    ).toBe(0);
  });

  it('reads BR, BHK, and PN shorthand', () => {
    expect(bedrooms('🩶🏠 2BR — Đường 22 Phước Long')).toBe(2);
    expect(bedrooms('Nha Trang 2 BHK\n9.5 млн')).toBe(2);
    expect(bedrooms('Cho thuê căn hộ 2PN Mường Thanh')).toBe(2);
    expect(bedrooms('Căn hộ | 80 m² | 3 PN | 1 WC')).toBe(3);
    expect(bedrooms('Thuê theo tháng, căn 2pn giá từ 8tr/ tháng')).toBe(2);
  });

  it('reads N-room apartments as N bedrooms', () => {
    expect(bedrooms('СДАЁТСЯ 1-КОМНАТНАЯ КВАРТИРА 50 м²')).toBe(1);
    expect(bedrooms('🏡 АРЕНДА 2-КОМНАТНОЙ КВАРТИРЫ HÀ QUANG 2')).toBe(2);
    expect(bedrooms('Сдается отличная однокомнатная квартира')).toBe(1);
    expect(bedrooms('Сдаётся двухкомнатная квартира')).toBe(2);
    expect(
      bedrooms('АРЕНДА 1-КОМНАТНОЙ КВАРТИРЫ (3 КРОВАТИ)\n• 2 спальни')
    ).toBe(2);
  });

  it('reads Chinese room counts', () => {
    expect(bedrooms('7郡富美興社區The View 高級四房出租')).toBe(4);
    expect(bedrooms('北江 DIAMOND HILL三房出租')).toBe(3);
    expect(bedrooms('Empire City 公寓兩房出租')).toBe(2);
    expect(bedrooms('Vista Verde公寓两房出租')).toBe(2);
    expect(bedrooms('Sky Park Residence一房')).toBe(1);
  });
});
