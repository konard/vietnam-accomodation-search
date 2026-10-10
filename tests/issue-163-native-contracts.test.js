import { describe, expect, it } from 'test-anywhere';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LinksStore,
  MtcuteTelegramProvider,
  TelegramIngestionService,
  normalizeMtcuteMessage,
  parseTelegramOffer,
} from '../src/index.js';
import { assembleTelegramAlbums } from '../src/telegram-pipeline.js';

const nativeIt = typeof globalThis.Deno === 'undefined' ? it : it.skip;

const source = { id: 'telegram:qa_fixture' };
const text =
  '🏠 Studio for rent in Nha Trang 13 million VND / month\nContact agent';
const entity = {
  _: 'messageEntityTextUrl',
  offset: text.indexOf('Contact agent'),
  length: 13,
  url: 'https://t.me/qa_agent_fixture',
};
const message = (fields = {}) => ({
  id: 1,
  date: new Date(),
  text,
  chat: { id: -1000000000001 },
  ...fields,
});

describe('native SDK and entity contracts (#158, #161, #162)', () => {
  nativeIt(
    'preserves the installed Photo, Document and WebPage scalar IDs',
    async () => {
      const { Photo, Document, WebPage } = await import('@mtcute/core');
      const common = {
        id: 42n,
        accessHash: 1n,
        fileReference: new Uint8Array([1]),
        dcId: 2,
        date: 1,
      };
      const media = [
        new Photo({
          ...common,
          _: 'photo',
          sizes: [{ _: 'photoSize', type: 'x', w: 800, h: 600, size: 100 }],
        }),
        new Document({
          ...common,
          _: 'document',
          mimeType: 'application/pdf',
          size: 100,
          attributes: [],
        }),
        new WebPage({
          _: 'webPage',
          id: 42n,
          url: 'https://example.com',
          displayUrl: 'example.com',
          hash: 0,
        }),
        { raw: { _: 'messageMediaPhoto', photo: { id: 42n } } },
      ];
      for (const item of media) {
        const normalized = normalizeMtcuteMessage(
          message({ media: item }),
          source
        );
        expect(normalized.media.id).toBe('42');
        expect(JSON.stringify(normalized)).not.toContain('fileReference');
        expect(JSON.stringify(normalized)).not.toContain('accessHash');
      }
    }
  );

  it('extracts hidden native and Bot API caption contacts without changing text', () => {
    const normalized = normalizeMtcuteMessage(
      message({ raw: { entities: [entity] } }),
      source
    );
    expect(normalized.text).toBe(text);
    expect(parseTelegramOffer(normalized).contacts.telegram).toContain(
      'qa_agent_fixture'
    );
    const bot = {
      date: new Date(),
      caption: text,
      caption_entities: [{ ...entity, type: 'text_link' }],
    };
    expect(parseTelegramOffer(bot).contacts.telegram).toContain(
      'qa_agent_fixture'
    );
    expect(
      parseTelegramOffer({
        ...bot,
        caption_entities: [{ ...entity, offset: -1, type: 'text_link' }],
      }).contacts.telegram
    ).toEqual([]);
  });

  it('keeps each album caption entity attached to its original UTF-16 text', () => {
    const messages = [
      normalizeMtcuteMessage(
        message({ groupedId: 3n, raw: { entities: [entity] } }),
        source
      ),
      normalizeMtcuteMessage(
        message({ id: 2, groupedId: 3n, text: 'Additional information' }),
        source
      ),
    ];
    const [album] = assembleTelegramAlbums(messages);
    expect(parseTelegramOffer(album).contacts.telegram).toContain(
      'qa_agent_fixture'
    );
  });

  nativeIt(
    'downloads through the installed SDK with a non-aligned file size',
    async () => {
      const { Photo } = await import('@mtcute/core');
      const { downloadAsIterable } = await import(
        new globalThis.URL(
          './highlevel/methods/files/download-iterable.js',
          import.meta.resolve('@mtcute/core')
        )
      );
      const photo = new Photo({
        _: 'photo',
        id: 42n,
        accessHash: 1n,
        fileReference: new Uint8Array([1]),
        dcId: 2,
        date: 1,
        sizes: [{ _: 'photoSize', type: 'x', w: 800, h: 600, size: 100 }],
      });
      const sdk = {
        getPrimaryDcId: async () => 2,
        getPoolSize: async () => 1,
        log: { debug() {} },
        call: async () => ({ _: 'upload.file', bytes: new Uint8Array(100) }),
      };
      const client = {
        start: async () => {},
        getMe: async () => ({ id: 99 }),
        getMessages: async () => [{ media: photo }],
        downloadAsIterable: (location, options) =>
          downloadAsIterable(sdk, location, options),
        destroy: async () => {},
      };
      const provider = new MtcuteTelegramProvider({
        apiId: 12,
        apiHash: 'fixture',
        session: 'fixture',
        clientFactory: async () => client,
      });
      try {
        const material = {
          members: [{ id: 1, sourceId: source.id, media: { id: '42' } }],
        };
        expect((await provider.photo('42', { material })).length).toBe(100);
        expect(
          (await provider.photo('42', { material, maxBytes: 101 })).length
        ).toBe(100);
        photo.fileSize = 1;
        expect(
          (await provider.photo('42', { material, maxBytes: 101 })).length
        ).toBe(100);
        photo.fileSize = undefined;
        expect(
          (await provider.photo('42', { material, maxBytes: 101 })).length
        ).toBe(100);
        let error;
        try {
          await provider.photo('42', { material, maxBytes: 99 });
        } catch (failure) {
          error = failure;
        }
        expect(error.code).toBe('OCR_INPUT_BUDGET');
      } finally {
        await provider.destroy();
      }
    }
  );
});

describe('projection retention completeness (#159)', () => {
  for (const mode of ['updateRecords', 'saveRecords']) {
    nativeIt(
      `reports retention through the legacy ${mode} store contract`,
      async () => {
        const directory = await mkdtemp(
          join(tmpdir(), 'issue163-legacy-retention-')
        );
        const backing = new LinksStore({ directory });
        const store = new Proxy(backing, {
          get(target, key) {
            if (
              key === 'appendRecords' ||
              (mode === 'saveRecords' && key === 'updateRecords')
            ) {
              return undefined;
            }
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const provider = {
          async *history() {
            for (let id = 1; id <= 2; id += 1) {
              yield {
                id,
                sourceId: source.id,
                date: new Date().toISOString(),
                text: 'Self-authored unrelated control',
              };
            }
          },
          liveUpdates: async () => ({ stop() {} }),
          destroy: async () => {},
        };
        const service = new TelegramIngestionService({
          store,
          provider,
          maxEvents: 1,
        });
        try {
          await service.start([source]);
          const fresh = new LinksStore({ directory });
          expect((await fresh.loadRecords('telegram-events')).length).toBe(1);
          const [status] = await fresh.loadRecords('telegram-retentions');
          expect(status.retentionLoss['telegram-events']).toBe(true);
          expect(status.retentionLoss['domain-records']).toBe(true);
          expect(
            (await fresh.loadRecords('telegram-ingestion-checkpoints'))[0]
              .complete
          ).toBe(false);
        } finally {
          await service.destroy();
          await rm(directory, { recursive: true, force: true });
        }
      }
    );
  }
  for (const budget of [
    { maxEvents: 2 },
    { maxEvents: 100, maxRecordBytes: 6000 },
  ]) {
    nativeIt(
      `reports projection loss for ${JSON.stringify(budget)} on fresh readback`,
      async () => {
        const directory = await mkdtemp(join(tmpdir(), 'issue163-retention-'));
        const binaryMirror =
          typeof globalThis.Deno === 'undefined' &&
          process.env.REQUIRE_REAL_CLINK === '1';
        const store = new LinksStore({ directory, binaryMirror });
        const provider = {
          async *history() {
            yield* [1, 2].map((id) => ({
              id,
              sourceId: source.id,
              date: new Date().toISOString(),
              text: 'Unrelated self-authored control',
            }));
          },
          liveUpdates: async () => ({ stop() {} }),
          destroy: async () => {},
        };
        const service = new TelegramIngestionService({
          store,
          provider,
          ...budget,
        });
        try {
          await service.start([source]);
          const fresh = new LinksStore({ directory, binaryMirror });
          const [checkpoint] = await fresh.loadRecords(
            'telegram-ingestion-checkpoints'
          );
          expect(checkpoint.complete).toBe(false);
          expect(checkpoint.retentionLoss['domain-records']).toBe(true);
          const graph = await fresh.loadRecords('domain-records');
          const entities = new Set(
            graph
              .filter(({ type }) => type !== 'semantic-link')
              .map(({ id }) => id)
          );
          expect(
            graph.filter(
              ({ type, subject }) =>
                type === 'semantic-link' && !entities.has(subject)
            )
          ).toEqual([]);
          expect(
            graph.filter(
              ({ predicate, object }) =>
                predicate === 'raw-material.eventId' && !entities.has(object)
            )
          ).toEqual([]);
          expect(
            (await fresh.loadRecords('telegram-retentions'))[0].complete
          ).toBe(false);
        } finally {
          await service.destroy();
          await rm(directory, { recursive: true, force: true });
        }
      }
    );
  }
  nativeIt(
    'keeps a larger default-budget cohort complete across restart',
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'issue163-default-retention-')
      );
      const binaryMirror = process.env.REQUIRE_REAL_CLINK === '1';
      const store = new LinksStore({ directory, binaryMirror });
      const provider = {
        async *history() {
          for (let id = 1; id <= 12; id += 1) {
            yield {
              id,
              sourceId: source.id,
              date: new Date().toISOString(),
              text: 'Self-authored unrelated control',
            };
          }
        },
        liveUpdates: async () => ({ stop() {} }),
        destroy: async () => {},
      };
      const service = new TelegramIngestionService({ store, provider });
      try {
        await service.start([source]);
        const fresh = new LinksStore({ directory, binaryMirror });
        expect((await fresh.loadRecords('telegram-events')).length).toBe(12);
        const graph = await fresh.loadRecords('domain-records');
        expect(graph.filter(({ type }) => type === 'message').length).toBe(12);
        expect(
          (await fresh.loadRecords('telegram-ingestion-checkpoints'))[0]
            .complete
        ).toBe(true);
        expect(await fresh.loadRecords('telegram-retentions')).toEqual([]);
      } finally {
        await service.destroy();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
  nativeIt(
    'hands accepted native photos to the cache and retains entity contacts in fresh clink',
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'issue163-native-handoff-')
      );
      const binaryMirror = process.env.REQUIRE_REAL_CLINK === '1';
      const store = new LinksStore({ directory, binaryMirror });
      let cached = 0;
      const provider = {
        async *history() {
          yield normalizeMtcuteMessage(
            message({
              media: { type: 'photo', id: '42' },
              raw: { entities: [entity] },
            }),
            source
          );
        },
        liveUpdates: async () => ({ stop() {} }),
        destroy: async () => {},
      };
      const service = new TelegramIngestionService({
        store,
        provider,
        mediaCache: {
          cacheTelegramPhotos: async (offer, material, actualProvider) => {
            expect(actualProvider).toBe(provider);
            expect(material.mediaIds).toEqual(['42']);
            cached += 1;
            offer.cachedPhotos = [
              {
                url: '42',
                path: '/self-authored-fixture/photo.jpg',
                size: 100,
              },
            ];
            offer.mediaStatus = 'cached';
          },
        },
      });
      try {
        await service.start([source]);
        const fresh = new LinksStore({ directory, binaryMirror });
        const [offer] = await fresh.loadRecords('offers');
        expect(cached).toBe(1);
        expect(offer.photos).toEqual(['42']);
        expect(offer.contacts.telegram).toContain('qa_agent_fixture');
        expect(offer.provenance.messageId).toBe(1);
        expect(offer.raw.text).toBe(text);
      } finally {
        await service.destroy();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
  nativeIt(
    'makes checkpoint and review truncation visible in durable status',
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'issue163-review-retention-')
      );
      const store = new LinksStore({ directory });
      const provider = {
        async *history(current) {
          yield {
            id: 1,
            sourceId: current.id,
            date: new Date().toISOString(),
            text: 'Self-authored unrelated control',
          };
        },
        liveUpdates: async () => ({ stop() {} }),
        destroy: async () => {},
      };
      const service = new TelegramIngestionService({
        store,
        provider,
        maxEvents: 1,
      });
      try {
        await service.start(
          Array.from({ length: 11 }, (_, id) => ({ id: `telegram:qa${id}` }))
        );
        const fresh = new LinksStore({ directory });
        const [status] = await fresh.loadRecords('telegram-retentions');
        expect(status.retentionLoss['telegram-ingestion-checkpoints']).toBe(
          true
        );
        expect(status.retentionLoss['telegram-reviews']).toBe(true);
        expect(
          (await fresh.loadRecords('telegram-ingestion-checkpoints')).every(
            ({ complete }) => !complete
          )
        ).toBe(true);
      } finally {
        await service.destroy();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
});
