import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';
import {
  LinksStore,
  LinkCliMirror,
  SearchService,
  TelegramHistoryCollector,
  deduplicateOffers,
  parseTelegramOffer,
} from '../src/index.js';
import {
  chronologyTimestamp,
  compareOfferChronology,
} from '../src/offer-chronology.js';

const now = new Date('2026-10-07T12:00:00Z');
const older = '2026-10-05T12:00:00Z';
const newer = '2026-10-06T12:00:00Z';
function message(id, date, sold, editDate) {
  return {
    id,
    messageId: id,
    sourceId: 'telegram:qa-history',
    date,
    editDate,
    text: `For rent: Ocean Home studio apartment in Nha Trang.\nID: A1702\n50 m², 1 bedroom, floor: 17.\n${sold ? 8 : 9} million VND/month. Contact: @qa_rental_agent\n${sold ? 'Sold out. No longer available.' : 'Available now.'}`,
  };
}
const parsed = (...args) => parseTelegramOffer(message(...args), { now });
const orders = (left, right) => [
  [left, right],
  [right, left],
];

describe('source chronology on observation-time ties (#147)', () => {
  it('keeps the newer unavailable state and price in both history orders', () => {
    const sold = parsed(2, newer, true);
    const available = parsed(1, older, false);
    expect(sold.collectedAt).toBe(available.collectedAt);
    expect(sold.attributes.availableNow).toBe(false);
    expect(available.attributes.availableNow).toBe(true);
    for (const input of orders(sold, available)) {
      const result = deduplicateOffers(input);
      expect(result.length).toBe(1);
      expect(result[0].attributes.availableNow).toBe(false);
      expect(result[0].priceVnd).toBe(8_000_000);
      expect(result[0].priceHistory.map(({ priceVnd }) => priceVnd)).toEqual([
        9_000_000, 8_000_000,
      ]);
    }
    expect(deduplicateOffers([sold, available])).toEqual(
      deduplicateOffers([available, sold])
    );
  });

  it('honors an explicit edit time and a genuinely later reopening repost', () => {
    for (const editDate of [now.toISOString(), now, now.getTime() / 1000]) {
      const edited = parsed(1, older, true, editDate);
      for (const input of orders(edited, parsed(2, newer, false))) {
        expect(deduplicateOffers(input)[0].attributes.availableNow).toBe(false);
      }
    }
    for (const input of orders(
      parsed(1, older, true),
      parsed(2, newer, false)
    )) {
      const result = deduplicateOffers(input)[0];
      expect(result.attributes.availableNow).toBe(true);
      expect(result.priceVnd).toBe(9_000_000);
    }
  });

  it('replaces a stale copy of the same message using edit chronology', () => {
    const stale = { ...parsed(1, older, false), id: 'same-message' };
    const edited = { ...parsed(1, older, true, newer), id: 'same-message' };
    for (const input of orders(stale, edited)) {
      const result = deduplicateOffers(input)[0];
      expect(result.variants.length).toBe(1);
      expect(result.variants[0].attributes.availableNow).toBe(false);
      expect(result.priceVnd).toBe(8_000_000);
    }
  });

  it('does not promote re-collected old source history over newer source state', () => {
    const sold = parsed(2, newer, true);
    const recollected = parseTelegramOffer(message(1, older, false), {
      now: new Date(now.getTime() + 3600_000),
    });
    for (const input of orders(sold, recollected)) {
      const result = deduplicateOffers(input)[0];
      expect(result.attributes.availableNow).toBe(false);
      expect(result.priceVnd).toBe(8_000_000);
      expect(result.collectedAt).toBe(recollected.collectedAt);
    }
  });

  it('recognizes legacy raw/provenance edits and Bot API edit_date', () => {
    for (const metadata of [
      { provenance: { editedAt: now.getTime() / 1000 } },
      { raw: { editDate: now } },
      { raw: { edit_date: now.getTime() / 1000 } },
    ]) {
      const edited = { ...parsed(1, older, true), ...metadata };
      const result = deduplicateOffers([edited, parsed(2, newer, false)])[0];
      expect(result.attributes.availableNow).toBe(false);
      expect(result.priceVnd).toBe(8_000_000);
    }
    const botMessage = {
      ...message(1, older, true),
      edit_date: now.getTime() / 1000,
    };
    expect(parseTelegramOffer(botMessage, { now }).updatedAt).toBe(
      now.toISOString()
    );
  });

  it('restores source chronology on persisted legacy price observations from retained variants', () => {
    const available = parsed(1, older, false);
    const sold = parsed(2, newer, true);
    const legacy = deduplicateOffers([available, sold])[0];
    legacy.priceHistory = legacy.priceHistory.map((observation) =>
      Object.fromEntries(
        Object.entries(observation).filter(
          ([key]) => !['postedAt', 'updatedAt', 'provenance'].includes(key)
        )
      )
    );
    legacy.priceVnd = 9_000_000;
    for (const input of orders(legacy, available)) {
      const restored = deduplicateOffers(input)[0];
      expect(restored.priceVnd).toBe(8_000_000);
      expect(restored.priceHistory.length).toBe(2);
      expect(restored.priceHistory.at(-1).postedAt).toBe(
        new Date(newer).toISOString()
      );
    }
  });

  it('normalizes invalid dates and resolves known-time ties while preserving undated replacements', () => {
    expect(chronologyTimestamp('invalid')).toBe(0);
    expect(chronologyTimestamp(now.getTime())).toBe(now.getTime());
    expect(compareOfferChronology({ id: 'old' }, { id: 'new' })).toBe(0);
    const first = { collectedAt: now.toISOString(), value: 'a' };
    const second = { collectedAt: now.toISOString(), value: 'b' };
    expect(compareOfferChronology(first, second) < 0).toBe(true);
    expect(compareOfferChronology(second, first) > 0).toBe(true);
  });

  it('handles the production newest-first history collector', async () => {
    const source = { id: 'telegram:qa-history' };
    const collector = new TelegramHistoryCollector({
      now: () => now,
      router: {
        history: async () => [
          message(2, newer, true),
          message(1, older, false),
        ],
      },
    });
    const result = deduplicateOffers(await collector.collect([source]));
    expect(result[0].attributes.availableNow).toBe(false);
    expect(result[0].priceVnd).toBe(8_000_000);
  });

  it('selects the later edit of repeated history messages with ISO dates in both orders', async () => {
    const source = { id: 'telegram:qa-history' };
    for (const input of orders(
      message(1, older, true, now.toISOString()),
      message(1, older, false, newer)
    )) {
      const collector = new TelegramHistoryCollector({
        now: () => now,
        router: { history: async () => input },
      });
      const result = deduplicateOffers(await collector.collect([source]));
      expect(result.length).toBe(1);
      expect(result[0].attributes.availableNow).toBe(false);
    }
  });

  it('retains edits to an album caption when the first photo has no edit timestamp', async () => {
    const source = { id: 'telegram:qa-history' };
    const collector = new TelegramHistoryCollector({
      now: () => now,
      router: {
        history: async () => [
          message(3, newer, false),
          { ...message(2, older, true, now), groupedId: 'album' },
          { ...message(1, older, false), text: '', groupedId: 'album' },
        ],
      },
    });
    const result = deduplicateOffers(await collector.collect([source]))[0];
    expect(result.attributes.availableNow).toBe(false);
    expect(result.priceVnd).toBe(8_000_000);
  });

  it('persists and searches both batch orders and independent collection writes', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'issue-147-'));
    try {
      const mirror =
        process.env.REQUIRE_REAL_CLINK === '1'
          ? new LinkCliMirror()
          : undefined;
      let index = 0;
      for (const input of orders(
        parsed(2, newer, true),
        parsed(1, older, false)
      )) {
        for (const incremental of [false, true]) {
          const path = join(directory, String(index++));
          const store = new LinksStore({ directory: path, mirror });
          if (incremental) {
            await store.saveOffers([input[0]]);
            await store.saveOffers([input[1]]);
          } else {
            await store.saveOffers(input);
          }
          const restarted = new LinksStore({
            directory: path,
            mirror,
          });
          const restored = await restarted.listOffers();
          expect(restored[0].attributes.availableNow).toBe(false);
          expect(restored[0].priceVnd).toBe(8_000_000);
          const search = new SearchService({
            store: restarted,
            registry: { list: async () => [] },
            now: () => now,
          });
          expect(
            await search.search({ query: 'Nha Trang', sources: [] })
          ).toEqual([]);
          expect(
            (
              await search.search({
                query: 'Nha Trang',
                sources: [],
                includeUnavailable: true,
              })
            )[0].priceVnd
          ).toBe(8_000_000);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
