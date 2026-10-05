import { describe, expect, it } from 'test-anywhere';

import {
  TELEGRAM_LABELS,
  classifyTelegramPost,
} from '../src/telegram-pipeline.js';

const label = (text, targetLocation = 'nha-trang') =>
  classifyTelegramPost(text, { targetLocation }).label;

describe('rental classification of live listing shapes', () => {
  it('keeps a rental whose footer advertises currency exchange', () => {
    expect(
      label(
        'СДАЁТСЯ КВАРТИРА С ДВУМЯ СПАЛЬНЯМИ\nг. Нячанг\n✅ 905$ в месяц\n💱 Обмен валюты по лучшему курсу'
      )
    ).toBe('offer');
  });

  it('still rejects a post that only advertises a service', () => {
    expect(label('💱 Обмен валюты без комиссии\nКурс 300 VND')).toBe('service');
    expect(
      label('SIM card delivery\nNha Trang\nPhone numbers 100 000 VND')
    ).toBe('service');
  });

  it('reads a serviced apartment as housing', () => {
    expect(
      label('Cho thuê căn hộ dịch vụ gần Trần Phú.\nGiá 5,5 triệu/tháng')
    ).toBe('offer');
    expect(label('Dịch vụ dọn nhà giá rẻ, 300.000 VND')).toBe('service');
  });

  it('recognises studios, houses, bedrooms, and million shorthand', () => {
    expect(label('🏠 Студия T23\n💰 11 000 000 VND/месяц')).toBe('offer');
    expect(label('ВИНТАЖНЫЙ ДОМ\n🛏 4 спальни\n💰 35 000 000 VND/месяц')).toBe(
      'offer'
    );
    expect(label('🩶🏠 2BR — Phước Long\n💰 18 500 000 VND/месяц')).toBe(
      'offer'
    );
    expect(label('NgaTrang. 2BHK\n9млн месяц, Депозит 100%')).toBe('offer');
    expect(label('Домашняя выпечка, 5 000 VND')).toBe('uncertain');
  });

  it('reads Chinese rentals with dollar and dong prices', () => {
    for (const text of [
      '7郡富美興社區The View 高級四房出租\n租金 : 每月 1500美元',
      '北江 DIAMOND HILL三房出租\n租金每月1500萬越盾',
      '九郡 大都市Vinhomes Grand Park两房公寓出租\n租金: 400美金',
    ]) {
      expect(label(text, null)).toBe('offer');
    }
  });

  it('accepts a priceless holiday villa taken by booking', () => {
    expect(
      label('Вилла с 9 спальнями\nВместимость: 22 гостя\nБронирование: [PHONE]')
    ).toBe('offer');
  });

  it('rejects commercial premises', () => {
    for (const text of [
      'CHO THUÊ MẶT BẰNG KINH DOANH GÓC CUA ĐƯỜNG YERSIN, 200 triệu/tháng',
      'CHO THUÊ MBKD ĐẮC ĐỊA, 8.000 USD/ tháng',
      'Коммерческое помещение на Юге Нячанга\nЦена: 10 млн VND / месяц',
      'Новый дом\n• Только для легального бизнеса\nЦена: 15 млн VND / месяц',
      'Сдается в аренду новый отель 22 номера на о. Фукуок. Цена 100 млн донг в месяц',
      'КОМПЛЕКС БУНГАЛО С СОБСТВЕННЫМ ПЛЯЖЕМ В АРЕНДУ\n140 000 000 VND в месяц',
      '胡志明市平正區Mizuki Park 店面出租',
      '胡志明市富潤郡辦公室出租',
    ]) {
      expect(classifyTelegramPost(text, { targetLocation: null })).toEqual({
        eligible: false,
        label: 'commercial',
        reason: 'commercial-premises',
      });
    }
    expect(TELEGRAM_LABELS.has('commercial')).toBe(true);
  });

  it('keeps a house that also suits a business', () => {
    expect(
      label(
        'CHO THUÊ NHÀ LÔ GÓC 2 MẶT TIỀN KHU PHƯỚC LONG GIÁ 13 TRIỆU/THÁNG\nNhà ở, kinh doanh'
      )
    ).toBe('offer');
  });

  it('reads a buyer-facing penthouse and a business transfer as sales', () => {
    expect(
      label(
        'Пентхаус с бассейном\nбудущий владелец может создать интерьер\nСтоимость — около 1 230 000 USD',
        null
      )
    ).toBe('sale');
    expect(
      label('CHO THUÊ NHÀ NGUYÊN CĂN HOẶC SANG NHƯỢNG SPA, 35 triệu/tháng')
    ).toBe('sale');
    expect(label('Продаётся меблированная студия. Цена: 84 000 USD')).toBe(
      'sale'
    );
    expect(
      label('Glory Heights\n• Studio: 6萬美金起\n• 兩房: 9.7萬美金起', null)
    ).toBe('sale');
  });
});
