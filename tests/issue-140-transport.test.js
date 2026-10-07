import { describe, it, expect } from 'test-anywhere';
import {
  createSegmentLedger,
  parseTelegramOffer,
  reconcileTelegramMaterials,
  assembleTelegramAlbums,
  classifyTelegramError,
  retryTelegramOperation,
} from '../src/index.js';
import { auditTelegramBatch } from '../experiments/telegram-live-audit-runtime.mjs';
const now = new Date('2026-10-07T12:00:00Z');
const rental = 'For rent: studio in Nha Trang. 13 million VND/month.';
describe('history and material accounting regressions', () => {
  it('accepts the exact 90-day boundary and rejects the preceding instant', () => {
    const date = new Date(now.getTime() - 90 * 86400000);
    expect(
      parseTelegramOffer({ text: rental, date }, { now })?.price.amount
    ).toBe(13000000);
    expect(
      parseTelegramOffer(
        { text: rental, date: new Date(date.getTime() - 1) },
        { now }
      )
    ).toBe(null);
  });
  it('does not invent an undefined source segment', () => {
    const ledger = createSegmentLedger(undefined);
    expect(ledger.segments.length).toBe(0);
    expect(ledger.summary.error).toBe(1);
  });
  it('tracks original source offsets for each nonempty line', () => {
    const text = '  Apartment\r\n\n  𝟏𝟑M VND/month  ';
    const ledger = createSegmentLedger(text);
    expect(ledger.segments.length).toBe(2);
    expect(text.slice(ledger.segments[1].start, ledger.segments[1].end)).toBe(
      '𝟏𝟑M VND/month'
    );
  });
  it('accounts for extraction-empty eligible attempts', async () => {
    const result = await reconcileTelegramMaterials([{ id: 1, text: rental }], {
      extract: () => null,
    });
    expect(result.eligibleAttempts).toBe(1);
    expect(result.reviewQueue[0].reason).toBe('offer-extraction-empty');
  });
  it('audits real normalized source lines and OCR terminal totals', async () => {
    const result = await auditTelegramBatch(
      [{ id: 1, date: now, text: `${rental}\n1 bedroom\nContact: @fixture` }],
      { now, sourceAlias: 'fixture' }
    );
    expect(result.segments.total).toBe(3);
    const photo = await auditTelegramBatch(
      [{ id: 2, date: now, photo: { id: 'poster' } }],
      { now, sourceAlias: 'fixture', ocr: async () => rental }
    );
    expect(photo.materials.unaccounted).toBe(0);
  });
  it('preserves and independently reconciles all distinct rental captions', async () => {
    const messages = [
      { id: 1, groupedId: 22, text: rental },
      {
        id: 2,
        groupedId: 22,
        text: 'For rent: house in Nha Trang. 20M VND/month.',
      },
    ];
    const materials = assembleTelegramAlbums(messages);
    expect(materials.length).toBe(2);
    expect(materials[1].captionMessageIds).toEqual([2]);
    expect((await reconcileTelegramMaterials(messages)).accepted.length).toBe(
      2
    );
  });
  it('does not erase complementary or repeated album captions', () => {
    const materials = assembleTelegramAlbums([
      { id: 1, groupedId: 22, text: rental },
      { id: 2, groupedId: 22, text: 'Available from October 9, 2026' },
      { id: 3, groupedId: 22, text: rental },
    ]);
    expect(materials.length).toBe(1);
    expect(materials[0].text).toContain('October 9');
    expect(materials[0].captions[0].messageIds).toEqual([1, 3]);
  });
  it('classifies native mtcute flood waits and never shortens them', async () => {
    const error = Object.assign(new Error('FLOOD_WAIT_%d'), {
      code: 420,
      seconds: 22,
    });
    expect(classifyTelegramError(error).delayMs).toBe(22000);
    const sleeps = [];
    let calls = 0;
    await retryTelegramOperation(
      () => {
        if (!calls++) {
          throw error;
        }
        return 1;
      },
      {
        idempotent: true,
        maxDelayMs: 30000,
        sleep: async (n) => sleeps.push(n),
      }
    );
    expect(sleeps).toEqual([22000]);
    let rejected;
    try {
      await retryTelegramOperation(
        () => {
          throw error;
        },
        {
          idempotent: true,
          sleep: async () => {
            throw new Error('must not retry too soon');
          },
        }
      );
    } catch (e) {
      rejected = e;
    }
    expect(rejected).toBe(error);
  });
});

describe('lazy Telegram history retry', () => {
  it('resumes after an iterator flood wait without gaps or duplicates', async () => {
    const { resilientTelegramHistory } =
      await import('../src/telegram-iterate.js');
    const offsets = [];
    const sleeps = [];
    let failed = false;
    const factory = async function* (options) {
      offsets.push(options.offset?.id);
      if (!options.offset) {
        yield { id: 4, date: now };
        if (!failed) {
          failed = true;
          throw Object.assign(new Error('FLOOD_WAIT_%d'), {
            code: 420,
            seconds: 22,
          });
        }
      }
      yield { id: 3, date: now };
      yield { id: 2, date: now };
    };
    const ids = [];
    for await (const message of resilientTelegramHistory(
      factory,
      {},
      { sleep: async (ms) => sleeps.push(ms) }
    )) {
      ids.push(message.id);
    }
    expect(ids).toEqual([4, 3, 2]);
    expect(offsets).toEqual([undefined, 4]);
    expect(sleeps).toEqual([22000]);
  });
  it('guards public handles against users and private peers before history is read', async () => {
    const { MtcuteTelegramProvider } = await import('../src/index.js');
    let historyReads = 0;
    let chat = { type: 'user' };
    const client = {
      start: async () => {},
      getMe: async () => ({ id: 1 }),
      resolvePeer: async () => ({}),
      getChat: async () => chat,
      iterHistory() {
        historyReads++;
        return [];
      },
      destroy: async () => {},
    };
    const provider = new MtcuteTelegramProvider({
      apiId: 1,
      apiHash: 'fixture',
      session: 'fixture',
      clientFactory: async () => client,
    });
    let error;
    try {
      await provider.history({
        id: 'telegram:fixture',
        access: 'public-preview',
      });
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe('PUBLIC_SOURCE_NOT_COMMUNITY');
    expect(historyReads).toBe(0);
    chat = { type: 'chat', chatType: 'supergroup' };
    let privateError;
    try {
      await provider.history({
        id: 'telegram:fixture',
        access: 'public-preview',
      });
    } catch (caught) {
      privateError = caught;
    }
    expect(privateError.code).toBe('PUBLIC_SOURCE_NOT_COMMUNITY');
    expect(historyReads).toBe(0);
    chat = { ...chat, username: 'fixture' };
    for await (const message of await provider.history({
      id: 'telegram:fixture',
      access: 'public-preview',
    })) {
      throw new Error(`Unexpected message ${message.id}`);
    }
    expect(historyReads).toBe(1);
    await provider.destroy();
  });
});

describe('shared rolling window and selected property facts', () => {
  it('reports incomplete preview history when a page cap stops before the cutoff', async () => {
    const { BrowserCollector } = await import('../src/index.js');
    const collector = new BrowserCollector({
      now: () => now,
      maxTelegramPages: 1,
    });
    const rows = await collector.collectTelegramRows(
      {
        goto: async () => {},
        evaluate: async () => [
          {
            text: rental,
            date: now.toISOString(),
            url: 'https://t.me/fixture/5',
          },
        ],
      },
      {
        id: 'telegram:fixture',
        url: 'https://t.me/fixture',
        searchUrl: 'https://t.me/s/fixture',
      },
      ''
    );
    expect(rows.length).toBe(1);
    expect(rows.historyComplete).toBe(false);
  });
  it('supports explicit windows and rejects invalid configuration', async () => {
    const { telegramHistoryWindow } = await import('../src/telegram-window.js');
    expect(telegramHistoryWindow({ now, historyDays: 120 }).historyDays).toBe(
      120
    );
    expect(
      telegramHistoryWindow({ now, since: new Date(now.getTime() - 86400000) })
        .historyDays
    ).toBe(1);
    let error;
    try {
      telegramHistoryWindow({ now, historyDays: 0 });
    } catch (e) {
      error = e;
    }
    expect(error instanceof TypeError).toBe(true);
    expect(
      parseTelegramOffer(
        { text: rental, date: new Date(now.getTime() - 100 * 86400000) },
        { now, historyDays: 120 }
      )?.price.amount
    ).toBe(13000000);
  });
  it('scopes floors to the chosen property', async () => {
    const { parseListingText } = await import('../src/index.js');
    const text =
      'Studio on 17th floor: 15M VND/month\n2BR apartment on 3rd floor: 12M VND/month';
    expect(parseListingText(text).attributes.floor).toBe(3);
  });
  it('retains history but excludes older Telegram offers and provisional OCR from current search', async () => {
    const { SearchService } = await import('../src/index.js');
    const old = parseTelegramOffer(
      { text: rental, date: new Date(now.getTime() - 100 * 86400000) },
      { now, historyDays: 120 }
    );
    const provisional = parseTelegramOffer(
      { text: rental, date: now },
      { now }
    );
    provisional.attributes.reviewRequired = true;
    const service = new SearchService({
      now: () => now,
      registry: { list: async () => [] },
      store: { listOffers: async () => [old, provisional] },
      traceRecorder: { record() {}, async persist() {} },
    });
    expect((await service.search({ refresh: false })).length).toBe(0);
    expect(
      (await service.search({ refresh: false, includeUnavailable: true }))
        .length
    ).toBeGreaterThan(0);
  });
  it('reconciles legacy media and exposes explicit review outcomes', async () => {
    const { TelegramHistoryCollector } = await import('../src/index.js');
    const saved = [];
    const collector = new TelegramHistoryCollector({
      now: () => now,
      ocr: async () => rental,
      store: {
        appendRecords: async (kind, records) => saved.push({ kind, records }),
      },
      router: {
        history: async () => [{ id: 1, date: now, photo: { id: 'poster' } }],
      },
    });
    const offers = await collector.collect([{ id: 'telegram:fixture' }]);
    expect(offers[0].attributes.reviewRequired).toBe(true);
    expect(saved[0].kind).toBe('telegram-reviews');
    expect(collector.reviewQueue[0].state).toBe('review');
  });
});
