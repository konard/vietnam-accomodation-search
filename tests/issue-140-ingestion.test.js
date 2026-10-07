import { describe, it, expect } from 'test-anywhere';
import {
  TelegramIngestionService,
  TelegramHistoryCollector,
  reconcileTelegramMaterials,
  parseListingText,
} from '../src/index.js';

function memoryStore(initial = {}) {
  const records = { offers: [], ...initial };
  const merge = (kind, entries) => {
    records[kind] = [
      ...new Map(
        [...(records[kind] || []), ...entries].map((entry) => [entry.id, entry])
      ).values(),
    ];
  };
  return {
    records,
    store: {
      loadRecords: async (kind) => records[kind] || [],
      saveRecords: async (kind, entries) => {
        records[kind] = entries;
      },
      appendRecords: async (kind, entries) => merge(kind, entries),
      updateRecords: async (kind, update) => {
        records[kind] = await update(records[kind] || []);
      },
      saveOffers: async (offers) => merge('offers', offers),
      deleteOffersByMessages: async (sourceId, ids) => {
        records.offers = records.offers.filter(
          (offer) =>
            offer.sourceId !== sourceId ||
            !offer.provenance?.messageIds?.some((id) => ids.includes(id))
        );
      },
    },
  };
}
const rental = 'For rent: studio in Nha Trang. 13M VND/month.';
describe('durable rolling history and album integration', () => {
  it('invalidates earlier source completeness when a later source exhausts shared retention', async () => {
    const now = new Date();
    const { store, records } = memoryStore();
    const service = new TelegramIngestionService({
      store,
      maxEvents: 2,
      now: () => now,
      provider: {
        history: async (source) =>
          Array.from(
            { length: source.id.endsWith('first') ? 1 : 2 },
            (_, index) => ({
              id: index + 1,
              sourceId: source.id,
              date: now.toISOString(),
              text: rental,
              chat: { username: source.id.slice('telegram:'.length) },
            })
          ),
        liveUpdates: async () => ({ stop: () => {} }),
        destroy: async () => {},
      },
    });
    try {
      await service.start([
        { id: 'telegram:first' },
        { id: 'telegram:second' },
      ]);
      expect(
        records['telegram-ingestion-checkpoints'].every(
          ({ complete }) => complete === false
        )
      ).toBe(true);
      expect(records.offers.length).toBe(3);
    } finally {
      await service.destroy();
    }
  });
  it('persists both album offers, marks exhausted retention degraded, and dates live updates at their actual time', async () => {
    let now = new Date();
    const source = { id: 'telegram:fixture' };
    const { store, records } = memoryStore();
    let update;
    let subscribed;
    const provider = {
      history: async () =>
        [1, 2, 3].map((id) => ({
          id,
          groupedId: id < 3 ? 'album' : undefined,
          sourceId: source.id,
          chat: { username: 'fixture' },
          text:
            id === 2
              ? rental.replace('13M', '14M')
              : id === 1
                ? rental
                : 'For rent: apartment in Nha Trang. Contact for price.',
          date: now.toISOString(),
        })),
      liveUpdates: async (handler, options) => {
        update = handler;
        subscribed = options.sources;
        return { stop: () => {} };
      },
      destroy: async () => {},
    };
    const service = new TelegramIngestionService({
      provider,
      store,
      maxEvents: 2,
      now: () => now,
    });
    try {
      const result = await service.start([
        source,
        { id: 'telegram:disabled', enabled: false },
      ]);
      expect(result.backfilled).toBe(2);
      expect(new Set(records.offers.map((offer) => offer.url)).size).toBe(2);
      expect(records['telegram-ingestion-checkpoints'][0].complete).toBe(false);
      expect(
        records['telegram-reviews'].some(
          ({ reason }) => reason === 'rolling-window-retention-budget'
        )
      ).toBe(true);
      expect(subscribed).toEqual([source]);
      now = new Date(now.getTime() + 86400000);
      await update({
        sourceId: source.id,
        type: 'new',
        message: {
          id: 5,
          sourceId: source.id,
          chat: { username: 'fixture' },
          date: now.toISOString(),
          text: rental,
        },
      });
      expect(records.offers.at(-1).collectedAt).toBe(now.toISOString());
    } finally {
      await service.destroy();
    }
  });
  it('resumes retained messages, drops expired events and checkpoints an intermediate batch', async () => {
    const now = new Date();
    const source = { id: 'telegram:fixture' };
    const retained = {
      id: 1,
      sourceId: source.id,
      date: new Date(now.getTime() - 86400000).toISOString(),
      text: rental,
    };
    const { store, records } = memoryStore({
      'telegram-events': [
        {
          id: 'retained',
          sourceId: source.id,
          type: 'backfill',
          message: retained,
        },
        {
          id: 'expired',
          sourceId: source.id,
          type: 'backfill',
          message: {
            ...retained,
            id: 9999,
            date: new Date(now.getTime() - 95 * 86400000).toISOString(),
          },
        },
      ],
      'telegram-ingestion-checkpoints': [
        {
          id: source.id,
          complete: false,
          oldestMessageId: 1,
          oldestMessageDate: retained.date,
        },
      ],
    });
    let resume;
    const provider = {
      history: async (_source, options) => {
        resume = options.resume;
        return Array.from({ length: 250 }, (_, index) => ({
          ...retained,
          id: index + 1,
          text: index === 0 ? rental : 'Community update',
        }));
      },
      liveUpdates: async () => ({ stop: () => {} }),
      destroy: async () => {},
    };
    const service = new TelegramIngestionService({
      provider,
      store,
      now: () => now,
    });
    try {
      await service.start([source]);
      expect(resume.oldestMessageId).toBe(1);
      expect(
        records['telegram-events'].some(({ id }) => id === 'expired')
      ).toBe(false);
      expect(records['telegram-ingestion-checkpoints'][0].messages).toBe(250);
      expect(records['telegram-ingestion-checkpoints'][0].complete).toBe(true);
    } finally {
      await service.destroy();
    }
  });
});
describe('conservative extraction boundaries', () => {
  it('keeps incompatible album captions in review with all content retained', async () => {
    const result = await reconcileTelegramMaterials([
      { id: 1, groupedId: 'mixed', text: rental },
      {
        id: 2,
        groupedId: 'mixed',
        text: 'Looking for an apartment to rent in Nha Trang',
      },
    ]);
    expect(result.accepted.length).toBe(0);
    expect(result.reviewQueue[0].reason).toBe('conflicting-album-captions');
    expect(result.reviewQueue[0].captions.length).toBe(2);
  });
  it('reports an eligible legacy listing without a numeric rent as an extraction error', async () => {
    const now = new Date();
    const collector = new TelegramHistoryCollector({
      now: () => now,
      router: {
        history: async () => [
          {
            id: 1,
            date: now,
            text: 'For rent: apartment in Nha Trang. Contact for price.',
          },
        ],
      },
    });
    expect(await collector.collect([{ id: 'telegram:fixture' }])).toEqual([]);
    expect(collector.reviewQueue[0].reason).toBe('offer-extraction-empty');
  });
  it('keeps an unmatched selected-price layout unknown and validates inferred leap dates', () => {
    const text =
      'Studio on 17th floor: 15M VND/month\n2BR apartment on 3rd floor: 12M VND/month';
    expect(
      parseListingText(text, {
        price: { amount: 1, currency: 'VND', period: 'month' },
      }).attributes.bedrooms
    ).toBe(undefined);
    expect(
      parseListingText('Available from February 29', {
        referenceDate: new Date(Date.UTC(2024, 11, 1)),
      }).attributes.availableFrom
    ).toBe(undefined);
  });
});
