import { describe, expect, it } from 'test-anywhere';

import {
  FIELDS,
  FIELD_THRESHOLDS,
  fieldMetrics,
  loadCorpus,
} from '../experiments/field-corpus-metrics.mjs';
import { propertyIdMerges } from '../experiments/issue-94-property-id-merges.mjs';

const corpus = await loadCorpus();

describe('field accuracy on the reviewed live corpus', () => {
  it('samples at least 200 messages from 10 sources in every language', () => {
    expect(corpus.dataPolicy).toBe('anonymized-live-sample');
    expect(corpus.cases.length >= 200).toBe(true);
    expect(
      new Set(corpus.cases.map(({ input }) => input.sourceId)).size >= 10
    ).toBe(true);
    const languages = new Set(corpus.cases.map(({ language }) => language));
    for (const language of ['en', 'ru', 'vi']) {
      expect(languages.has(language)).toBe(true);
    }
    expect(new Set(corpus.cases.map(({ id }) => id)).size).toBe(
      corpus.cases.length
    );
    // A field the message does not state is left out of `expected`.
    for (const { expected } of corpus.cases) {
      expect(typeof expected.offer).toBe('boolean');
      expect(Object.keys(expected).every((key) => FIELDS.includes(key))).toBe(
        true
      );
    }
  });

  it('carries no contacts, links, or handles', () => {
    const text = corpus.cases.map(({ input }) => input.text).join('\n');
    expect(text).not.toMatch(/https?:\/\/|t\.me\//u);
    expect(text).not.toMatch(/@[A-Za-z][A-Za-z\d_]{3,31}/u);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/iu);
    expect(text).not.toMatch(/(?<![\d.,])(?:\+84|0)\d{9,10}(?![\d.,])/u);
  });

  it('meets the precision and recall threshold of every field', async () => {
    const report = await fieldMetrics(corpus);
    for (const field of FIELDS) {
      const { precision, recall } = report.fields[field];
      expect({
        field,
        precision: precision >= FIELD_THRESHOLDS[field].precision,
        recall: recall >= FIELD_THRESHOLDS[field].recall,
      }).toEqual({ field, precision: true, recall: true });
    }
    expect(report.pass).toBe(true);
  });

  it('counts a wrong value as both a false positive and a false negative', async () => {
    const report = await fieldMetrics({
      cases: [
        {
          expected: {
            offer: true,
            period: 'month',
            priceVnd: 9_000_000,
            rooms: 2,
          },
          id: 'wrong-price',
          input: {
            postedAt: '2026-01-01T00:00:00.000Z',
            sourceId: 'web-sample',
            sourceType: 'web',
            text: 'Cho thuê căn hộ 2PN\nGiá thuê: 7 triệu/tháng',
          },
          language: 'vi',
        },
        {
          expected: { offer: false },
          id: 'request',
          input: {
            focus: 'nha-trang',
            postedAt: '2026-01-01T00:00:00.000Z',
            sourceId: 'telegram:sample',
            sourceType: 'telegram',
            text: 'Ищу квартиру в Нячанге до 10 млн',
          },
          language: 'ru',
        },
      ],
      rates: { VND: 1 },
    });
    const counts = ({ falseNegative, falsePositive, truePositive }) => ({
      falseNegative,
      falsePositive,
      truePositive,
    });
    expect(counts(report.fields.priceVnd)).toEqual({
      falseNegative: 1,
      falsePositive: 1,
      truePositive: 0,
    });
    expect(counts(report.fields.offer)).toEqual({
      falseNegative: 0,
      falsePositive: 0,
      truePositive: 1,
    });
    expect(report.misses).toEqual([
      {
        actual: 7_000_000,
        expected: 9_000_000,
        field: 'priceVnd',
        id: 'wrong-price',
      },
    ]);
  });

  it('keeps every reviewed offer apart by its source property id', () => {
    const { merged, offers } = propertyIdMerges(corpus);

    expect(offers >= 200).toBe(true);
    expect(merged).toBe(0);
  });
});
