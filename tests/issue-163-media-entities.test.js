import { describe, expect, it } from 'test-anywhere';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MediaCache,
  deliverSubscriptionOffers,
  parseTelegramOffer,
} from '../src/index.js';
import {
  normalizeTextEntities,
  telegramEntityEvidence,
} from '../src/telegram-text-entities.js';
import { downloadBoundedPhoto } from '../src/telegram-photo-download.js';
import {
  offerPhotoMedia,
  sendPhotoMedia,
} from '../src/telegram-offer-media.js';
import { createDiagnosticLogger } from '../src/diagnostic-log.js';
import { pruneGraphReferences } from '../src/telegram-retention.js';
import { reconcileTelegramMaterials } from '../src/telegram-pipeline.js';

const nativeIt = typeof globalThis.Deno === 'undefined' ? it : it.skip;
async function failure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected rejection');
}

describe('safe entity evidence', () => {
  it('bounds scalar metadata and respects UTF-16 offsets and malformed overlaps', () => {
    expect(normalizeTextEntities(null, [])).toEqual([]);
    expect(normalizeTextEntities('x', {})).toEqual([]);
    const text = '🏠 Agent';
    const valid = {
      type: 'text_link',
      offset: 3,
      length: 5,
      url: 'https://t.me/qa_agent',
    };
    expect(
      normalizeTextEntities(text, [
        { raw: valid },
        { ...valid, offset: 4, length: 4 },
      ]).length
    ).toBe(1);
    for (const invalid of [
      { ...valid, offset: 1 },
      { ...valid, offset: 0, length: 1 },
      { ...valid, offset: -1 },
      { ...valid, offset: 0.5 },
      { ...valid, length: 0 },
      { ...valid, length: 9 },
      { ...valid, type: 'bold' },
      { ...valid, url: 12 },
      { ...valid, url: 'javascript:alert(1)' },
      { ...valid, url: `https://${'a'.repeat(2048)}` },
      null,
    ]) {
      expect(normalizeTextEntities(text, [invalid])).toEqual([]);
    }
    expect(
      normalizeTextEntities(
        'a'.repeat(150),
        Array.from({ length: 150 }, (_, offset) => ({
          ...valid,
          offset,
          length: 1,
        }))
      ).length
    ).toBe(100);
    expect(
      normalizeTextEntities('Agent', [
        { kind: 'mention', offset: 0, length: 5 },
      ])[0].type
    ).toBe('mention');
    const evidence = telegramEntityEvidence({
      members: [
        { id: 1, text: 'Agent', raw: { entities: [{ ...valid, offset: 0 }] } },
        {
          id: 2,
          caption: '@qa_other',
          caption_entities: [{ type: 'mention', offset: 0, length: 9 }],
        },
      ],
      captionMessageIds: [1],
    });
    expect(evidence.map(({ target }) => target)).toEqual([
      'https://t.me/qa_agent',
    ]);
  });
  it('matches visible controls and only labels explicit property official links', () => {
    const text =
      'Studio for rent in Nha Trang 13 million VND / month\nContact agent\nOfficial website: visit';
    const entity = (label, url) => ({
      type: 'text_link',
      offset: text.indexOf(label),
      length: label.length,
      url,
    });
    const input = {
      date: new Date(),
      text,
      entities: [
        entity('Contact agent', 'https://t.me/qa_agent'),
        entity('visit', 'https://example.com/qa-property'),
      ],
    };
    const hidden = parseTelegramOffer(input);
    const visible = parseTelegramOffer({
      date: new Date(),
      text: `${text}\nhttps://t.me/qa_agent`,
    });
    expect(hidden.contacts.telegram).toEqual(visible.contacts.telegram);
    expect(hidden.raw.text).toBe(text);
    expect(hidden.officialUrl).toBe('https://example.com/qa-property');
    const unrelated = parseTelegramOffer({
      ...input,
      text: text.replace('Official website', 'Agency navigation'),
      entities: [entity('Contact agent', 'https://example.com/agency')],
    });
    expect(unrelated.officialUrl).toBe(undefined);
    expect(unrelated.contacts.telegram).toEqual([]);
    expect(
      parseTelegramOffer({
        date: new Date(),
        caption: text,
        caption_entities: input.entities,
      }).contacts.telegram
    ).toEqual(hidden.contacts.telegram);
    expect(telegramEntityEvidence({}).length).toBe(0);
  });
});

describe('measured native streaming', () => {
  it('rejects oversize data independently of metadata and closes the iterator', async () => {
    let closed = false;
    const client = {
      async *downloadAsIterable() {
        try {
          yield new Uint8Array(6);
          yield new Uint8Array(6);
        } finally {
          closed = true;
        }
      },
    };
    expect(
      (await failure(() => downloadBoundedPhoto(client, {}, { maxBytes: 10 })))
        .code
    ).toBe('OCR_INPUT_BUDGET');
    expect(closed).toBe(true);
  });
  it('bounds SDK prefetch and forwards pre-abort and deadline reasons', async () => {
    const client = {
      async *downloadAsIterable(_media, options) {
        for (let i = 0; i < 5; i += 1) {
          options.throttle();
          yield new Uint8Array(0);
        }
      },
    };
    expect(
      (await failure(() => downloadBoundedPhoto(client, {}, { maxBytes: 1 })))
        .code
    ).toBe('OCR_INPUT_BUDGET');
    const controller = new AbortController();
    controller.abort(new Error('cancelled fixture'));
    const empty = { async *downloadAsIterable() {} };
    expect(
      (
        await failure(() =>
          downloadBoundedPhoto(
            empty,
            {},
            { maxBytes: 10, signal: controller.signal }
          )
        )
      ).message
    ).toBe('cancelled fixture');
    let aborted = false;
    const stalled = {
      downloadAsIterable(_media, { abortSignal }) {
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next() {
            return new Promise((_resolve, reject) =>
              abortSignal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  reject(abortSignal.reason);
                },
                { once: true }
              )
            );
          },
          return() {
            return Promise.resolve({ done: true });
          },
        };
      },
    };
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new Error('deadline fixture')),
      5
    );
    try {
      expect(
        (
          await failure(() =>
            downloadBoundedPhoto(
              stalled,
              {},
              { maxBytes: 10, signal: deadline.signal }
            )
          )
        ).message
      ).toBe('deadline fixture');
    } finally {
      clearTimeout(timer);
    }
    expect(aborted).toBe(true);
  });
  it('reports an accepted offer with unavailable uploads as degraded', async () => {
    const result = await reconcileTelegramMaterials(
      [
        {
          id: 1,
          date: new Date(),
          sourceId: 'telegram:qa',
          text: 'Studio for rent in Nha Trang 13 million VND / month',
        },
      ],
      { extract: async () => ({ id: 'qa', mediaStatus: 'incomplete' }) }
    );
    expect(result.accepted.length).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.reviewQueue[0].reason).toBe(
      'native-photo-upload-unavailable'
    );
  });
});

describe('native cache to bot upload', () => {
  nativeIt(
    'keeps stable IDs for storage while sending file bytes and deduplicating delivery',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'issue163-cache-'));
      try {
        const cache = new MediaCache({ directory });
        const offer = {
          id: 'qa',
          sourceId: 'telegram:qa',
          title: 'QA studio',
          priceVnd: 13e6,
          photos: ['42'],
          provenance: { transport: 'mtproto' },
        };
        const calls = [];
        await cache.cacheTelegramPhotos(
          offer,
          { mediaIds: ['42'] },
          {
            photo: async (id, { maxBytes }) => {
              calls.push([id, maxBytes]);
              return new Uint8Array([1, 2]);
            },
          }
        );
        expect(offer.photos).toEqual(['42']);
        expect(offer.mediaStatus).toBe('cached');
        expect([...(await readFile(offer.cachedPhotos[0].path))]).toEqual([
          1, 2,
        ]);
        await cache.cacheOffers([offer]);
        expect(offer.cachedPhotos.length).toBe(1);
        expect(calls).toEqual([['42', 10 * 1024 ** 2]]);
        const records = [];
        const store = {
          loadRecords: async () => records,
          saveRecords: async (_kind, incoming) => {
            records.splice(0, records.length, ...incoming);
          },
        };
        const sends = [];
        const api = {
          sendMessage: async () => sends.push('text'),
          sendPhoto: async (_chat, photo) => {
            expect(typeof photo).toBe('object');
            sends.push('photo');
          },
        };
        await deliverSubscriptionOffers(api, 123, [offer], { store });
        await deliverSubscriptionOffers(api, 123, [offer], { store });
        expect(sends).toEqual(['text', 'photo']);
        expect(
          (
            await failure(() =>
              Promise.resolve(offerPhotoMedia({ ...offer, cachedPhotos: [] }))
            )
          ).code
        ).toBe('TELEGRAM_MEDIA_UNAVAILABLE');
        expect(
          await offerPhotoMedia({ provenance: { transport: 'mtproto' } })
        ).toEqual([]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
  nativeIt(
    'reports failed downloads and eviction without relabelling success',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'issue163-cache-budget-'));
      try {
        const cache = new MediaCache({ directory, maxBytes: 1 });
        const offer = {};
        await cache.cacheTelegramPhotos(
          offer,
          { mediaIds: ['42', '43'] },
          {
            photo: async (id) => {
              if (id === '43') {
                throw new Error('denied');
              }
              return new Uint8Array(2);
            },
          }
        );
        expect(offer.mediaStatus).toBe('incomplete');
        expect(offer.cachedPhotos).toEqual([]);
        await cache.cacheTelegramPhotos(offer, {}, {});
        expect(offer.mediaStatus).toBe('cached');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
  it('uses the single-photo API and preserves group and no-media behavior', async () => {
    const calls = [];
    await sendPhotoMedia([], undefined, () => calls.push('group'));
    await sendPhotoMedia(
      [{ media: 'photo' }],
      (value) => calls.push(value),
      () => calls.push('group')
    );
    await sendPhotoMedia([{ media: 'a' }, { media: 'b' }], undefined, () =>
      calls.push('group')
    );
    expect(calls).toEqual(['photo', 'group']);
  });
});

describe('published logging and partial graph contracts', () => {
  it('redacts enabled sink arguments and does not evaluate disabled debug', () => {
    const outputs = [];
    const sink = {
      warn: (...args) => outputs.push(args),
      log: (...args) => outputs.push(args),
    };
    const logger = createDiagnosticLogger({
      sink,
      context: { token: 'private-fixture' },
    });
    let evaluated = false;
    logger.debug(() => {
      evaluated = true;
    });
    logger.warn(() => ({ password: 'private-fixture' }));
    expect(evaluated).toBe(false);
    expect(JSON.stringify(outputs)).not.toContain('private-fixture');
    createDiagnosticLogger({ sink, level: 'info' }).info('QA');
    createDiagnosticLogger({ sink: { error() {} }, level: 'error' }).error(
      'QA'
    );
    createDiagnosticLogger({ sink: {}, level: 'warn' }).warn('QA');
    createDiagnosticLogger();
  });
  it('removes orphaned projections transitively while retaining valid entities', () => {
    const records = [
      { id: 'keep', type: 'message' },
      { id: 'raw', type: 'raw-material' },
      {
        id: 'link',
        type: 'semantic-link',
        subject: 'raw',
        predicate: 'raw-material.eventId',
        object: 'missing',
      },
      {
        id: 'orphan',
        type: 'semantic-link',
        subject: 'missing',
        predicate: 'property.x',
        object: 'x',
      },
      { id: 'next', type: 'parser-run' },
      {
        id: 'next-link',
        type: 'semantic-link',
        subject: 'next',
        predicate: 'parser-run.eventId',
        object: 'raw',
      },
    ];
    expect(pruneGraphReferences(records)).toEqual([records[0]]);
    expect(
      pruneGraphReferences([
        { id: 'offer:qa', type: 'offer' },
        { id: 'run', type: 'parser-run' },
        {
          id: 'relation',
          type: 'semantic-link',
          subject: 'run',
          predicate: 'parser-run.offerId',
          object: 'qa',
        },
      ]).length
    ).toBe(3);
  });
});
