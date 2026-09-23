import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'test-anywhere';

import { parseTelegramOffer } from '../src/telegram-parser.js';
import {
  classifyTelegramPost,
  reconcileTelegramMaterials,
} from '../src/telegram-pipeline.js';

const corpus = JSON.parse(
  await readFile(
    new globalThis.URL(
      '../experiments/fixtures/telegram-accommodation-parser-cases.json',
      import.meta.url
    ),
    'utf8'
  )
);

function expectSubset(actual, expected) {
  for (const [key, value] of Object.entries(expected || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      expectSubset(actual?.[key], value);
    } else {
      expect(actual?.[key]).toEqual(value);
    }
  }
}

describe('reviewed Telegram parser corpus v2', () => {
  it('is versioned, multilingual, unique, and free of live identities', () => {
    expect(corpus.schemaVersion).toBe(2);
    expect(corpus.dataPolicy).toBe('synthetic-and-anonymized-only');
    expect(new Set(corpus.cases.map(({ id }) => id)).size).toBe(
      corpus.cases.length
    );
    expect(new Set(corpus.cases.map(({ language }) => language))).toEqual(
      new Set(['en', 'ru', 'vi'])
    );
    expect(JSON.stringify(corpus)).not.toMatch(
      /https?:\/\/t\.me\/|\+\d{8,}|@[A-Za-z][A-Za-z\d_]{4,31}/u
    );
  });

  for (const testCase of corpus.cases.filter(({ input }) => input.text)) {
    it(`matches reviewed outcome: ${testCase.id}`, () => {
      const relevance = classifyTelegramPost(testCase.input.text);
      expect(relevance.eligible).toBe(testCase.expected.relevant);
      if (!testCase.expected.relevant) {
        return;
      }

      const postedAt = new Date(testCase.input.postedAt);
      const offer = parseTelegramOffer(
        {
          chat: { username: 'synthetic_fixture' },
          date: postedAt,
          messageId: 1,
          text: testCase.input.text,
        },
        { now: postedAt }
      );
      expect(offer).not.toBeNull();
      expect(offer.language.language).toBe(testCase.language);
      const expectedOffer = { ...testCase.expected };
      delete expectedOffer.relevant;
      expectSubset(offer, expectedOffer);
    });
  }

  it('coalesces the reviewed album into exactly one offer', async () => {
    const testCase = corpus.cases.find(
      ({ id }) => id === 'telegram-album-is-one-offer'
    );
    const messages = testCase.input.messages.map((message, index) => ({
      ...message,
      chatId: 'synthetic-chat',
      id: index + 1,
    }));
    const result = await reconcileTelegramMaterials(messages, {
      extract: (material) =>
        parseTelegramOffer(
          {
            ...material,
            chat: { username: 'synthetic_fixture' },
            date: '2026-09-22T00:00:00.000Z',
            messageId: material.messageIds[0],
            photos: material.mediaIds,
          },
          { now: new Date('2026-09-22T00:00:00.000Z') }
        ),
    });
    expect(result.accepted.length).toBe(testCase.expected.offerCount);
    expect(result.accepted[0].photos.length).toBe(testCase.expected.photoCount);
    expectSubset(result.accepted[0], { price: testCase.expected.price });
  });

  it('classifies a reviewed photo-only case through bounded OCR', async () => {
    const testCase = corpus.cases.find(
      ({ id }) => id === 'telegram-photo-only-ocr-offer'
    );
    const messages = testCase.input.messages.map((message, index) => ({
      ...message,
      chatId: 'synthetic-chat',
      id: index + 1,
    }));
    const result = await reconcileTelegramMaterials(messages, {
      extract: (material) =>
        parseTelegramOffer(
          {
            ...material,
            chat: { username: 'synthetic_fixture' },
            date: '2026-09-22T00:00:00.000Z',
            messageId: material.messageIds[0],
          },
          { now: new Date('2026-09-22T00:00:00.000Z') }
        ),
      ocr: async () => testCase.input.ocrText,
    });
    expect(result.accepted.length).toBe(testCase.expected.offerCount);
    expect(result.accepted[0].raw.ocrState).toBe(testCase.expected.ocrState);
    expectSubset(result.accepted[0], { price: testCase.expected.price });
  });

  it('normalizes Unicode, punctuation, and whitespace mutations', () => {
    const mutations = [
      'Cho\u0020thuê\u0020căn\u0020hộ\u0020Nha\u0020Trang,\u002012\u0020triệu\u0020VND/tháng',
      'Cho\u00a0thuê căn hộ Nha Trang — 12 triệu VND / tháng',
      'Cho thuê\n\t căn hộ Nha Trang: 12 triệu VND/tháng!!!',
    ];
    for (const text of mutations) {
      expect(classifyTelegramPost(text.normalize('NFD')).eligible).toBe(true);
    }
  });
});
