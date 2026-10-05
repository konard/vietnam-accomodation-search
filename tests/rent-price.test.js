import { describe, expect, it } from 'test-anywhere';

import { normalizeOffer, parsePrice } from '../src/index.js';

// Anonymised excerpts of live Nha Trang rental posts.
describe('rent price selection', () => {
  it('reads the rent, not the vehicle rental listed below it', () => {
    expect(
      parsePrice(
        [
          '✅ 905$ в месяц.',
          '✅ 25$ - Охрана и обслуживание здания',
          '✅ 11$ Интернет',
          '🏍 Аренда байка от 100к/сутки 1,5млн/месяц',
        ].join('\n')
      )
    ).toEqual({ amount: 905, currency: 'USD', period: 'month' });
  });

  it('ignores pet surcharges, utilities, and unit rates', () => {
    expect(
      parsePrice(
        [
          '🐶🐱 Разрешены небольшие домашние животные',
          '➖ Доплата за питомца: 1.000.000 VND / месяц',
          '💰 СТОИМОСТЬ АРЕНДЫ:',
          '• 14.000.000 VND / месяц',
          '• ⚡ Электричество: 4.500 VND / кВт⋅ч',
          '• 💧 Вода: 150.000 VND / человек / месяц',
          '📶 Wi-Fi — 100 000 VND',
        ].join('\n')
      )
    ).toEqual({ amount: 14_000_000, currency: 'VND', period: 'month' });
  });

  it('keeps fees under an additional-costs heading out of the rent', () => {
    expect(
      parsePrice(
        [
          '💵 Стоимость аренды: 21.000.000 VND/месяц',
          '➖ Депозит: 9.000.000 VND',
          '📎 Дополнительные расходы:',
          '• Плата за управление: 700.000 VND/месяц',
          '• 300.000 VND/месяц',
        ].join('\n')
      )
    ).toEqual({ amount: 21_000_000, currency: 'VND', period: 'month' });
  });

  it('ignores area, floor, building, and street numbers', () => {
    expect(parsePrice('Квартира 60 m2, 15 этаж, Mường Thanh 60 Trần Phú')).toBe(
      null
    );
    expect(parsePrice('Giá 2000USD/m2')).toBe(null);
    expect(parsePrice('📍 Район: Север, около 500 м до моря')).toBe(null);
  });

  it('gives the lowest option and the range for multi-option rents', () => {
    expect(
      parsePrice(
        [
          '💰 СТОИМОСТЬ АРЕНДЫ:',
          '• 3–5 месяцев: 23.000.000 VND / месяц',
          '• 6 месяцев: 22.000.000 VND / месяц',
          '• 6–12 месяцев: 19.000.000 VND / месяц',
        ].join('\n')
      )
    ).toEqual({
      amount: 19_000_000,
      currency: 'VND',
      period: 'month',
      range: { max: 23_000_000, min: 19_000_000 },
    });
    expect(parsePrice('Giá: 8-10 triệu/tháng')).toEqual({
      amount: 8_000_000,
      currency: 'VND',
      period: 'month',
      range: { max: 10_000_000, min: 8_000_000 },
    });
  });

  it('prefers the monthly rent over the nightly one', () => {
    expect(parsePrice('Сутки: 22 $\nМесяц: 375 $')).toEqual({
      amount: 375,
      currency: 'USD',
      period: 'month',
    });
    expect(parsePrice('✅ 78$ сутки\nот 3 суток')).toEqual({
      amount: 78,
      currency: 'USD',
      period: 'night',
    });
  });

  it('reads USD and EUR written as words or symbols', () => {
    expect(parsePrice('💵 СТОИМОСТЬ АРЕНДЫ:\n• 2.300 USD / месяц')).toEqual({
      amount: 2300,
      currency: 'USD',
      period: 'month',
    });
    expect(parsePrice('Цена 1500 долларов в месяц').currency).toBe('USD');
    expect(parsePrice('Rent 450 euro per month')).toEqual({
      amount: 450,
      currency: 'EUR',
      period: 'month',
    });
  });

  it('reads millions written with spaces or abbreviations', () => {
    expect(parsePrice('22 мл    VND месяц').amount).toBe(22_000_000);
    expect(
      parsePrice('-❤️Стоимость аренды: 15 миллионов VND в месяц.')
    ).toEqual({ amount: 15_000_000, currency: 'VND', period: 'month' });
    expect(
      parsePrice(
        'Стоимость аренды 9млн/VND≈27 000р/380$ месяц не включая обслуживание 500k/месяц , Интернет 280k/месяц'
      ).amount
    ).toBe(9_000_000);
    expect(
      parsePrice('Căn hộ giá 9tr/tháng, phí quản lý 500k, điện 3.500đ/số')
    ).toEqual({ amount: 9_000_000, currency: 'VND', period: 'month' });
  });

  it('reads a lone "m" as metres and a spaced "к" as a preposition', () => {
    expect(parsePrice('Квартира 60m, 5 к морю, 12 млн VND').amount).toBe(
      12_000_000
    );
    expect(parsePrice('Аренда 15M VND').amount).toBe(15_000_000);
  });

  it('treats an amount followed by "+ deposit" as the rent', () => {
    expect(parsePrice('Nha Trang 2 BHK\n9.5 млн + Депозит 100%').amount).toBe(
      9_500_000
    );
  });

  it('skips budget ceilings and sale prices', () => {
    expect(
      parsePrice('Цена: 22 млн VND / месяц\n👉 АРЕНДА ДО 10 МЛН').amount
    ).toBe(22_000_000);
    expect(
      parsePrice(
        '💰 Цена продажи: 1 200 000 000 донгов\n🔑 Аренда помещения: 18 000 000 донгов/месяц'
      ).amount
    ).toBe(18_000_000);
  });

  it('converts the chosen rent to VND on the normalized offer', async () => {
    const offer = await normalizeOffer(
      {
        sourceId: 'telegram:sample',
        text: '✅ 630$ в месяц.\n✅ 25$ - Охрана и обслуживание здания',
      },
      { rates: { USD: 26_000, VND: 1 } }
    );
    expect(offer.priceVnd).toBe(16_380_000);
  });

  it('reads Chinese rents in dollars and in ten-thousands of dong', () => {
    expect(parsePrice('👉 四房，面河\n租金 : 每月 1500美元')).toEqual({
      amount: 1500,
      currency: 'USD',
      period: 'month',
    });
    expect(parsePrice('🌟三房兩衛浴,面積84.2平米\n租金每月1500萬越盾')).toEqual(
      {
        amount: 15_000_000,
        currency: 'VND',
        period: 'month',
      }
    );
    expect(parsePrice('✅兩房，面積91平米\n租金：3000萬越盾')).toEqual({
      amount: 30_000_000,
      currency: 'VND',
      period: 'month',
    });
    expect(parsePrice('租金: 400美金\n押金: 800美金')).toEqual({
      amount: 400,
      currency: 'USD',
      period: 'month',
    });
  });

  it('skips a scaled amount too small to be a rent', () => {
    expect(
      parsePrice(
        'Giá thuê: 5.5 triệu/tháng. Tầng 3.\n 0,0055 Triệu/tháng\nprice: 0,0055 Triệu/tháng'
      )
    ).toEqual({ amount: 5_500_000, currency: 'VND', period: 'month' });
  });
});
