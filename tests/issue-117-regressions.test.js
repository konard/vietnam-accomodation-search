import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'test-anywhere';

import {
  LinksStore,
  MtcuteTelegramProvider,
  normalizeOffer,
  parseListingText,
  parsePrice,
  parseTelegramOffer,
  PresetService,
  SearchService,
  SubscriptionScheduler,
  TelegramSourceDiscovery,
} from '../src/index.js';
import {
  fieldMetrics,
  loadCorpus,
} from '../experiments/field-corpus-metrics.mjs';

const now = new Date('2026-10-06T00:00:00Z');
const surchargeText = `Квартира в Нячанге сдаётся.
Стоимость аренды: 7.800.000 VND / месяц
Для 1 человека: 6.800.000 VND / месяц
При аренде на 3 месяца: + 500.000 VND / месяц
Условия аренды:
Депозит: 1 месяц
Договор: 6 месяцев`;
const mixedText = `New apartments in Nha Trang.
Mountain view + partial sea view: 12 million VND/month.
Sea-view Studio: 15 million VND/month.`;
const trace = { record: () => {}, persist: async () => {} };

describe('Bun subprocess credential isolation', () => {
  it('runs the fingerprint regression from a checkout with a synthetic .env', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'issue-113-'));
    try {
      await writeFile(
        join(directory, '.env'),
        'TELEGRAM_BOT_TOKEN=123456:synthetic-dotenv-token\n'
      );
      const args = globalThis.Bun
        ? ['test', '--no-env-file', '--timeout', '30000']
        : ['--test', '--test-timeout=30000'];
      await promisify(execFile)(
        process.execPath,
        [
          ...args,
          '--test-name-pattern=prints only a salted digest',
          fileURLToPath(
            new URL('./issue-78-polling-conflict.test.js', import.meta.url)
          ),
        ],
        { cwd: directory, env: { PATH: process.env.PATH } }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function searchService(offers) {
  return new SearchService({
    now: () => now,
    registry: { list: async () => [] },
    store: { listOffers: async () => offers },
    traceRecorder: trace,
  });
}

async function subscriptionResults(service, options) {
  const records = new Map();
  const presets = new PresetService({
    store: {
      loadRecords: async (kind) => records.get(kind) || [],
      saveRecords: async (kind, values) => records.set(kind, values),
    },
  });
  await presets.save('1', 'filtered', options);
  await presets.subscribe('1', 'filtered');
  const delivered = [];
  const scheduler = new SubscriptionScheduler({
    deliver: async (_user, offers) => delivered.push(...offers),
    now: () => now,
    presets,
    search: (filters) => service.search({ ...filters, refresh: false }),
    traceRecorder: trace,
  });
  await scheduler.tick();
  return delivered;
}

describe('audit collection contract', () => {
  it('round-trips every cohort collection used by the runner through a real retained LinksStore', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const runner = await readFile(
      new URL(
        '../experiments/audit-telegram-accommodations.mjs',
        import.meta.url
      ),
      'utf8'
    );
    const names = [
      ...runner.matchAll(/\.(?:load|save)Records\('(audit-cohorts?)'/gu),
    ].map((match) => match[1]);
    expect(names.length).toBe(3);
    const directory = await mkdtemp(join(tmpdir(), 'issue-111-'));
    try {
      const cohort = {
        id: 'cohort',
        auditPass: 'retained',
        sources: [{ username: 'public_source' }],
      };
      for (const name of names) {
        const store = new LinksStore({ directory });
        await store.saveRecords(name, [cohort]);
        expect(await new LinksStore({ directory }).loadRecords(name)).toEqual([
          cohort,
        ]);
      }
      expect(() =>
        new LinksStore({ directory }).pathFor('audit-cohort')
      ).toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe('additive charges and rental option association', () => {
  it('selects the standalone 6.8M occupancy option and excludes the +500k surcharge', () => {
    const offer = parseTelegramOffer(
      {
        date: now,
        messageId: 1,
        sourceId: 'telegram:synthetic',
        text: surchargeText,
      },
      { now }
    );
    expect(offer.price).toEqual({
      amount: 6_800_000,
      currency: 'VND',
      period: 'month',
      range: { min: 6_800_000, max: 7_800_000 },
    });
    expect(offer.priceVnd).toBe(6_800_000);
  });

  for (const charge of [
    '+ 500.000 VND / month',
    '+500000 VND/month',
    '＋ 500k VND/month',
    'plus 500k VND/month',
    'Surcharge: 500k VND/month',
    'Extra rent: 500k VND/month',
    '500k VND/month extra',
    'Надбавка: 500k VND/месяц',
    'Доплата за короткий срок: 500k VND/месяц',
    'Phụ thu: 500k VND/tháng',
    'Trả thêm 500k VND/tháng',
    'Cộng thêm 500k VND/tháng',
  ]) {
    it(`excludes the additive charge ${charge}`, () => {
      expect(parsePrice(`Rent: 7.8 million VND/month\n${charge}`).amount).toBe(
        7_800_000
      );
      expect(parsePrice(charge)).toBe(null);
    });
  }

  it('preserves affordable shared rooms and unspaced sums', () => {
    for (const text of [
      'Shared room rent: 500k VND/month',
      'Phòng ghép giá: 500k VND/tháng',
      'Комната: аренда 500k VND/месяц',
    ]) {
      expect(parsePrice(text).amount).toBe(500_000);
    }
    expect(
      parsePrice('Rent: 7.8 million VND/month + 500k VND/month').amount
    ).toBe(7_800_000);
    expect(
      parsePrice('Rent: 7.8 million VND/month+500000 VND/month').amount
    ).toBe(7_800_000);
    expect(
      parsePrice('Rent: 7.8 million VND/month + extra rent 500k VND/month')
        .amount
    ).toBe(7_800_000);
    expect(
      parsePrice('Rent: 7.8 million VND/month plus extra rent 500k VND/month')
        .amount
    ).toBe(7_800_000);
    expect(parsePrice('Extra large studio rent: 500k VND/month').amount).toBe(
      500_000
    );
  });

  it('keeps the surcharge out of cheapest sorting and low-price subscriptions', async () => {
    const offers = [
      normalizeOffer({ id: 'surcharge', text: surchargeText }, { now }),
      normalizeOffer(
        { id: 'shared', text: 'Shared room rent: 800k VND/month' },
        { now }
      ),
    ];
    const service = searchService(offers);
    expect(
      (await service.search({ cheapest: true, refresh: false })).map(
        ({ id }) => id
      )
    ).toEqual(['shared', 'surcharge']);
    expect(
      (await subscriptionResults(service, { maxTotalVnd: 1_000_000 })).map(
        ({ id }) => id
      )
    ).toEqual(['shared']);
  });

  it('leaves the cheaper apartment bedrooms unknown in both shared entry points', () => {
    expect(parseListingText(mixedText).attributes.bedrooms).toBe(undefined);
    const offer = normalizeOffer({ text: mixedText }, { now });
    expect(offer.priceVnd).toBe(12_000_000);
    expect(offer.attributes.bedrooms).toBe(undefined);
    expect(offer.kind).toBe('apartment');
  });

  for (const [text, bedrooms] of [
    ['Studio: 12 million VND/month\n2BR apartment: 15 million VND/month', 0],
    ['1BR apartment: 12 million VND/month\nStudio: 15 million VND/month', 1],
    ['Studio: 15 million VND/month\n2BR apartment: 12 million VND/month', 2],
    ['Studio: 12 million VND/month, 2BR apartment: 15 million VND/month', 0],
    ['Rent: 12 million VND/month\nStudio: 15 million VND/month', undefined],
    ['Studio: 8 million VND/month\nRent: 12 million VND/month', undefined],
    [
      '2BR apartment\nRent: 15 million VND/month\nStudio\nRent: 12 million VND/month',
      0,
    ],
    ['Studio 8 million VND/month', 0],
    [
      'Studio: 12 million VND/month\n2BR apartment: 12 million VND/month',
      undefined,
    ],
    [
      '2BR apartment\nRent: 12 million VND/month\nprice: 12 million VND/month',
      2,
    ],
    [
      '2BR apartment\nContract 6 months: 12 million VND/month\nContract 3 months: 15 million VND/month',
      2,
    ],
  ]) {
    it(`retains the selected option count in ${text}`, () => {
      expect(normalizeOffer({ text }).attributes.bedrooms).toBe(bedrooms);
    });
  }

  it('uses an explicitly supplied price to select its matching layout and preserves unknown for unmatched prices', () => {
    for (const [amount, currency, period, bedrooms] of [
      [15_000_000, 'VND', 'month', 0],
      [20_000_000, 'VND', 'month', undefined],
      [15_000_000, 'USD', 'month', undefined],
      [15_000_000, 'VND', 'night', undefined],
    ]) {
      const offer = normalizeOffer({
        text: mixedText,
        price: { amount, currency, period },
      });
      expect(offer.attributes.bedrooms).toBe(bedrooms);
    }
  });

  it('does not invent cheap zero-bedroom search or subscription matches', async () => {
    const service = searchService([
      normalizeOffer({ id: 'mixed', text: mixedText }, { now }),
    ]);
    const filters = { filters: { bedrooms: 0 }, maxTotalVnd: 13_000_000 };
    expect(await service.search({ ...filters, refresh: false })).toEqual([]);
    expect(await subscriptionResults(service, filters)).toEqual([]);
  });

  it('checks the reviewed mixed-option case with an exact assertion', async () => {
    const corpus = await loadCorpus();
    const sample = corpus.cases.find(
      ({ id }) => id === 'tg-arendaotshahnoza-006'
    );
    expect(Boolean(sample)).toBe(true);
    const report = await fieldMetrics({ ...corpus, cases: [sample] });
    expect(report.misses).toEqual([]);
  });

  it('preserves every reviewed field across the complete multilingual corpus', async () => {
    const report = await fieldMetrics(await loadCorpus());
    expect(report.misses).toEqual([]);
  });
});

describe('native Telegram member metadata', () => {
  it('ranks public discovery sources using full metadata and fetches each missing count once', async () => {
    let fullCalls = 0;
    const popular = {
      type: 'chat',
      chatType: 'channel',
      id: 7,
      username: 'popular_rentals',
      title: 'Nha Trang rentals',
    };
    const provider = new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: 12,
      session: 'session',
      clientFactory: async () => ({
        start: async () => {},
        getMe: async () => ({ id: 99 }),
        getFullChat: async (id) => {
          expect(id).toBe(7);
          fullCalls += 1;
          return { membersCount: 678 };
        },
        async *iterSearchGlobal() {
          yield { chat: popular };
          yield { chat: popular };
          yield {
            chat: {
              ...popular,
              id: 8,
              username: 'small_rentals',
              membersCount: 42,
            },
          };
        },
      }),
    });
    const discovery = new TelegramSourceDiscovery({
      providers: [provider],
      now: () => now,
      traceRecorder: trace,
    });
    const result = await discovery.discover({
      queries: [{ id: 'rent', text: 'Nha Trang rentals', language: 'en' }],
    });
    expect(result.sources.map(({ popularity }) => popularity.value)).toEqual([
      678, 42,
    ]);
    expect(fullCalls).toBe(1);
  });
  for (const [basic, full, expected] of [
    [{ membersCount: 42 }, {}, 42],
    [{ membersCount: 0 }, {}, 0],
    [{ participantsCount: 12 }, {}, 12],
    [{ membersCount: null }, { membersCount: 678 }, 678],
    [{}, { participantsCount: 23 }, 23],
    [{}, {}, null],
    [{}, new Error('full metadata unavailable'), null],
  ]) {
    it(`returns ${expected} members from basic/full metadata ${JSON.stringify(basic)}`, async () => {
      let fullCalls = 0;
      const provider = new MtcuteTelegramProvider({
        apiHash: 'hash',
        apiId: 12,
        session: 'session',
        logger: { debug: () => {} },
        clientFactory: async () => ({
          start: async () => {},
          getMe: async () => ({ id: 99 }),
          getChat: async () => basic,
          getFullChat: async (peer) => {
            expect(peer).toBe('@rentals');
            fullCalls += 1;
            if (full instanceof Error) {
              throw full;
            }
            return full;
          },
        }),
      });
      expect(await provider.popularity('@rentals')).toEqual({
        members: expected,
      });
      expect(fullCalls).toBe(
        (basic.membersCount !== undefined && basic.membersCount !== null) ||
          basic.participantsCount !== undefined
          ? 0
          : 1
      );
    });
  }
});
