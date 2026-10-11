import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import { LinksStore, TelegramIngestionService } from '../src/index.js';

const source = { id: 'telegram:self_authored_progress', focus: 'nha-trang' };
const date = '2026-10-10T00:00:00Z';
const rental =
  'Apartment for rent in Nha Trang, 12 million VND/month, 2 bedrooms.';
const message = (id, fields = {}) => ({
  id,
  date,
  text: rental,
  sourceId: source.id,
  ...fields,
});

async function fixture(action, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vac-progress-test-'));
  const store = new LinksStore({ directory, binaryMirror: false });
  let handler;
  const provider = {
    history: options.history,
    liveUpdates: async (callback) => {
      handler = callback;
      return { stop() {} };
    },
    destroy: async () => {},
  };
  const ingestion = new TelegramIngestionService({
    store,
    provider,
    now: () => new Date('2026-10-11T00:00:00Z'),
    ...options,
  });
  try {
    await action({ store, ingestion, update: (event) => handler(event) });
  } finally {
    await ingestion.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('incremental native material publication', () => {
  it('bounds working material while continuing the entire provider history', async () => {
    assert.throws(
      () => new TelegramIngestionService({ backfillBatchSize: 0 }),
      /positive integer/u
    );
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    let observed = 0;
    await fixture(
      async ({ ingestion, store }) => {
        await ingestion.start([source]);
        assert.equal(observed, 6);
        // Repeated captions describe one unit; deduplication stays enabled.
        assert.equal((await store.listOffers()).length, 1);
        const [checkpoint] = await store.loadRecords(
          'telegram-ingestion-checkpoints'
        );
        assert.equal(checkpoint.historyComplete, true);
        assert.equal(checkpoint.complete, false);
        assert.equal(checkpoint.retentionLoss['working-messages'], true);
        assert(ingestion.materialOffers.size <= 2);
      },
      {
        maxEvents: 2,
        backfillBatchSize: 2,
        async *history() {
          for (let id = 6; id > 0; id -= 1) {
            observed += 1;
            yield message(id);
          }
        },
      }
    );
  });

  it('publishes a caption arriving after the first album photo while history is pending', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    let release;
    const tail = new Promise((resolve) => {
      release = resolve;
    });
    let reached;
    const barrier = new Promise((resolve) => {
      reached = resolve;
    });
    await fixture(
      async ({ store, ingestion }) => {
        const started = ingestion.start([source]);
        try {
          await barrier;
          assert.equal((await store.listOffers()).length, 1);
          assert.equal(
            (await store.loadRecords('telegram-ingestion-checkpoints'))[0]
              .complete,
            false
          );
        } finally {
          release();
          await started;
        }
      },
      {
        async *history() {
          yield message(2, { text: '', groupedId: 'album' });
          yield message(1, { groupedId: 'album' });
          reached();
          await tail;
        },
      }
    );
  });

  it('removes provisional offers and graph records when later album captions conflict', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    await fixture(
      async ({ store, ingestion, update }) => {
        await ingestion.start([source]);
        assert.equal((await store.listOffers()).length, 1);
        await update({
          type: 'new',
          sourceId: source.id,
          message: message(2, {
            groupedId: 'album',
            text: 'Looking for an apartment in Nha Trang, 12 million VND/month.',
          }),
        });
        assert.equal((await store.listOffers()).length, 0);
        assert.equal(
          (await store.loadRecords('domain-records')).filter(
            ({ type }) => type === 'offer'
          ).length,
          0
        );
      },
      {
        async *history() {
          yield message(1, { groupedId: 'album' });
        },
      }
    );
  });

  it('replaces edited messages replayed from an incomplete checkpoint', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    await fixture(
      async ({ store, ingestion }) => {
        await store.saveRecords('telegram-events', [
          {
            id: 'previous',
            type: 'backfill',
            sourceId: source.id,
            message: message(1),
          },
        ]);
        await store.saveRecords('telegram-ingestion-checkpoints', [
          {
            id: source.id,
            complete: false,
            oldestMessageId: 1,
            oldestMessageDate: date,
          },
        ]);
        await ingestion.start([source]);
        assert.equal((await store.listOffers()).length, 0);
      },
      {
        async *history() {
          yield message(1, {
            editDate: '2026-10-11T00:00:00Z',
            text: 'Looking for an apartment in Nha Trang, 12 million VND/month.',
          });
        },
      }
    );
  });
});
