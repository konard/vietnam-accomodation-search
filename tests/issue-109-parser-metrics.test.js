import { describe, expect, it } from 'test-anywhere';

import { normalizeOffer, parsePrice, SearchService } from '../src/index.js';
import {
  fieldMetrics,
  loadCorpus,
} from '../experiments/field-corpus-metrics.mjs';

const terms = [
  ['Договор 6–12 месяцев', 'Договор 3–5 месяцев', 16_000_000, 16_500_000],
  ['Договор 3–12 месяцев', 'Договор 1–2 месяца', 21_000_000, 23_000_000],
  ['Договор 2–6 месяцев', 'Договор 7–12 месяцев', 23_000_000, 22_000_000],
  ['Договор от 3 месяцев', 'Договор 1–2 месяца', 15_500_000, 16_500_000],
  ['6–12 months', '3–5 months', 16_000_000, 16_500_000],
  ['Contract from 3 months', 'Contract 1–2 months', 15_500_000, 16_500_000],
  ['hợp đồng 6–12 tháng', 'hợp đồng 3–5 tháng', 16_000_000, 16_500_000],
  ['hợp đồng từ 3 tháng', 'hợp đồng 1–2 tháng', 15_500_000, 16_500_000],
];

describe('contract-term rent and meaningful field gates (#102, #103)', () => {
  it('keeps fee amounts out of cheapest results and maximum-price subscriptions', async () => {
    const offer = normalizeOffer({
      id: 'contract',
      text: 'Apartment for rent in Nha Trang\nДоговор 6–12 месяцев: 16.000.000 VND / месяц\nДополнительные расходы:\n200.000 VND',
    });
    const service = new SearchService({
      store: { listOffers: async () => [offer] },
      registry: { list: async () => [] },
      traceRecorder: { record: () => {}, persist: async () => {} },
    });
    expect(
      await service.search({
        cheapest: true,
        maxTotalVnd: 1_000_000,
        refresh: false,
      })
    ).toEqual([]);
    expect(
      (await service.search({ cheapest: true, refresh: false }))[0].priceVnd
    ).toBe(16_000_000);
    expect(parsePrice('Rent: 800.000 VND/month')).toEqual({
      amount: 800_000,
      currency: 'VND',
      period: 'month',
    });
  });

  it('keeps the quoted billing period and available negations', () => {
    expect(parsePrice('Contract 3–6 months: $20/night').period).toBe('night');
    for (const status of ['not occupied', 'unoccupied']) {
      expect(
        normalizeOffer({ text: `Apartment for rent. $500/month. ${status}` })
          .attributes?.availability
      ).not.toBe('unavailable');
    }
  });
  for (const [first, second, a, b] of terms) {
    it(`selects rent options labelled ${first}`, async () => {
      const text = [
        'Apartment for rent in Nha Trang. Rent:',
        `• ${first}: ${a.toLocaleString('de-DE')} VND / month`,
        `• ${second}: ${b.toLocaleString('de-DE')} VND / month`,
        'Additional costs:',
        '• 50.000 VND',
        '• 200.000 VND',
      ].join('\n');
      expect(parsePrice(text)).toEqual({
        amount: Math.min(a, b),
        currency: 'VND',
        period: 'month',
        range: { max: Math.max(a, b), min: Math.min(a, b) },
      });
      expect((await normalizeOffer({ text })).priceVnd).toBe(Math.min(a, b));
    });
  }

  it('scores USD extraction independently of the exchange rate', async () => {
    const corpus = await loadCorpus();
    const usd = corpus.cases.filter(
      ({ input }) => input.sourceId === 'nha-trang-renting'
    );
    const report = await fieldMetrics(
      { ...corpus, cases: usd },
      { rates: { USD: 25_641, VND: 1 } }
    );
    expect(report.fields.price.pass).toBe(true);
    expect(report.fields.price.truePositive).toBe(8);
    expect(report.misses).toEqual([]);
  });

  it('reports zero expected positives as not evaluated even with predictions', async () => {
    for (const availability of [undefined, 'unavailable']) {
      const report = await fieldMetrics(
        {
          cases: [
            {
              expected: { offer: true },
              id: 'empty',
              input: {},
              language: 'en',
            },
          ],
        },
        {
          predict: () => ({ offer: true, availability }),
        }
      );
      expect(report.fields.availability.status).toBe('not-evaluated');
      expect(report.fields.availability.pass).toBe(null);
    }
  });

  it('gates at least twenty explicitly unavailable multilingual cases', async () => {
    const corpus = await loadCorpus();
    const unavailable = corpus.cases.filter(
      ({ expected }) => expected.availability === 'unavailable'
    );
    expect(unavailable.length >= 20).toBe(true);
    expect(new Set(unavailable.map(({ language }) => language)).size >= 3).toBe(
      true
    );
    const report = await fieldMetrics({ ...corpus, cases: unavailable });
    expect(report.fields.availability.truePositive).toBe(unavailable.length);
    expect(report.fields.availability.pass).toBe(true);
  });
});
