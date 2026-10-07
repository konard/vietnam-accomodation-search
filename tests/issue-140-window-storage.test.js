import { describe, it, expect } from 'test-anywhere';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LinksStore,
  LinkCliMirror,
  MtcuteTelegramProvider,
  TelegramHistoryCollector,
  parseTelegramOffer,
} from '../src/index.js';
const now = new Date('2026-10-07T12:00:00Z');
describe('90-day history beyond the former 3,000-message cap', () => {
  it('protects offers inside the configured history budget and fails closed', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'telegram-window-budget-'));
    try {
      for (const [age, historyDays] of [
        [75, 90],
        [110, 120],
      ]) {
        const store = new LinksStore({ directory, maxBytes: 1, historyDays });
        const current = new Date();
        const offer = parseTelegramOffer(
          {
            id: 1,
            text: 'For rent: studio 13M VND/month',
            date: new Date(current.getTime() - age * 86400000),
          },
          { now: current, historyDays }
        );
        let error;
        try {
          await store.saveOffers([offer]);
        } catch (caught) {
          error = caught;
        }
        expect(error?.code).toBe('offer-budget-exhausted');
        expect(await store.listOffers()).toEqual([]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('covers the whole bounded window, survives a lazy flood wait, and round-trips offers and resume checkpoints', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'telegram-window-storage-'));
    const source = { id: 'telegram:fixture' };
    const count = 3005;
    const messages = Array.from({ length: count + 1 }, (_, index) => ({
      id: count - index + 1,
      date: new Date(
        now.getTime() - Math.floor((index * 90 * 86400000) / (count - 1))
      ),
      chat: { username: 'fixture' },
      text:
        index === count - 1 || index === count - 2
          ? `For rent: studio in Nha Trang. ${index === count - 1 ? 13 : 14}M VND/month.`
          : 'Community update.',
    }));
    let failed = false;
    let reads = 0;
    const sleeps = [];
    const client = {
      start: async () => {},
      getMe: async () => ({ id: 1 }),
      resolvePeer: async () => ({}),
      destroy: async () => {},
      async *iterHistory(_peer, options) {
        const start = options.offset
          ? messages.findIndex((message) => message.id === options.offset.id) +
            1
          : 0;
        for (let index = start; index < messages.length; index++) {
          reads++;
          if (index === 1500 && !failed) {
            failed = true;
            throw Object.assign(new Error('FLOOD_WAIT_%d'), {
              code: 420,
              seconds: 22,
            });
          }
          yield messages[index];
        }
      },
    };
    const provider = new MtcuteTelegramProvider({
      apiId: 1,
      apiHash: 'fixture',
      session: 'fixture',
      clientFactory: async () => client,
    });
    try {
      const collector = new TelegramHistoryCollector({
        now: () => now,
        router: {
          history: (selected, options) =>
            provider.history(selected, {
              ...options,
              retry: {
                sleep: async (milliseconds) => sleeps.push(milliseconds),
              },
            }),
        },
      });
      const offers = await collector.collect([source]);
      expect(reads).toBeGreaterThan(3000);
      expect(sleeps).toEqual([22000]);
      expect(offers.length).toBe(2);
      const publicationBaseline = messages
        .slice(0, count)
        .filter((message) => /For rent/u.test(message.text))
        .map((message) =>
          parseTelegramOffer(
            { ...message, sourceId: source.id },
            { now: message.date }
          )
        );
      expect(offers.map((offer) => offer.price.amount).sort()).toEqual(
        publicationBaseline.map((offer) => offer.price.amount).sort()
      );
      const mirror =
        typeof globalThis.Deno === 'undefined' &&
        process.env.REQUIRE_REAL_CLINK === '1'
          ? new LinkCliMirror()
          : undefined;
      if (mirror) {
        await mirror.preflight();
      }
      const store = new LinksStore({ directory, mirror });
      await store.saveOffers(offers);
      expect((await store.listOffers()).length).toBe(2);
      const checkpoint = {
        id: source.id,
        complete: false,
        oldestMessageId: 2,
        oldestMessageDate: messages[count - 1].date.toISOString(),
        cutoff: messages[count - 1].date.toISOString(),
      };
      await store.saveRecords('telegram-ingestion-checkpoints', [checkpoint]);
      expect(
        (await store.loadRecords('telegram-ingestion-checkpoints'))[0]
      ).toEqual(checkpoint);
      const resumed = [];
      for await (const message of await provider.history(source, {
        resume: checkpoint,
        since: messages[count - 1].date,
      })) {
        resumed.push(message.id);
      }
      expect(new Set(resumed).size).toBe(resumed.length);
    } finally {
      await provider.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
