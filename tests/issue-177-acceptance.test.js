/* eslint local/no-changelog-comments: ["warn", {"allowDatesInStrings": true}] -- Dates are fixed fixture inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRegistry, SearchService, normalizeOffer } from '../src/index.js';
import {
  sourceInventory,
  sourceCompleteness,
} from '../src/source-inventory.js';
import { collectionKey } from '../src/search-refresh.js';
import { ExchangeRateProvider } from '../src/pricing.js';
import {
  compareOfferValue,
  formatOfferValue,
  quoteBasis,
  validateComparison,
} from '../src/value-pricing.js';
import { formatSearchFailures } from '../src/telegram-bot.js';
import { classifyListingPage } from '../src/browser-adapters.js';
import { statusForFailure } from '../src/source-pool.js';
import { gotoPage } from '../src/utils.js';
import { TelegramPhotoScheduler } from '../src/telegram-photo-scheduler.js';
import { TelegramMediaRetries } from '../src/telegram-media-retries.js';
import { retryNativePhoto } from '../src/telegram-photo-retry.js';
import { reconcileTelegramMaterials } from '../src/telegram-pipeline.js';

const now = new Date('2025-01-01T00:00:00Z');

it('reconciles peer aliases and preserves a disabled manifest over stored rediscovery', () => {
  const inventory = sourceInventory(
    [
      {
        id: 'telegram:First',
        type: 'channel',
        username: '@First',
        peerId: '42',
        enabled: false,
        reason: 'disabled',
      },
      { id: 'plain', type: 'web' },
    ],
    [
      {
        id: 'alternate',
        type: 'megagroup',
        telegram: { username: 'SECOND', peerId: 42 },
        enabled: true,
      },
    ]
  );
  const peer = inventory.find((source) => source.type === 'telegram');
  assert.equal(peer.id, 'telegram:first');
  assert.equal(peer.enabled, false);
  assert.deepEqual(peer.aliases, [
    'telegram:First',
    'telegram:first',
    'alternate',
    'telegram:second',
  ]);
});

it('updates every supported candidate and keeps catalogue exclusions visible across restarts', async () => {
  let stored = [{ id: 'extra', type: 'telegram', username: 'extra' }];
  const seen = [];
  const store = {
    loadSources: async () => stored,
    saveSources: async (sources) => {
      stored = sources;
    },
  };
  const registry = new SourceRegistry({
    store,
    discover: async (type, options) => {
      seen.push({ type, ids: options.candidates.map(({ id }) => id) });
      assert.equal(options.mode, 'exhaustive');
      return options.candidates;
    },
  });
  const expected = (await registry.inventory()).filter(
    ({ capability }) => capability === 'supported'
  );
  const updated = await registry.update({ mode: 'exhaustive' });
  assert.deepEqual(
    [...updated.web, ...updated.telegram].map(({ id }) => id).sort(),
    expected.map(({ id }) => id).sort()
  );
  assert.equal(seen.flatMap(({ ids }) => ids).length, expected.length);
  assert(stored.some(({ capability }) => capability === 'disabled'));
  const fallback = await new SourceRegistry({ store }).update({
    mode: 'exhaustive',
  });
  assert.equal(fallback.telegram.length, updated.telegram.length);
});

it('separates collection completion from reviewed inventory and reports exact outstanding IDs', async () => {
  const source = { id: 'web', type: 'web' };
  const state = {
    id: collectionKey('web', 'q'),
    status: 'offers',
    collectedAt: now.toISOString(),
    attemptedAt: now.toISOString(),
    parseComplete: true,
    paginationComplete: true,
  };
  const offers = [
    normalizeOffer(
      {
        id: 'offer',
        sourceId: 'web',
        text: 'For rent: 12M VND/month; 2 bedrooms, 3 rooms, 4 beds.',
        searchQuery: 'q',
      },
      { now }
    ),
  ];
  const report = (states) =>
    sourceCompleteness({
      inventory: sourceInventory([source]),
      states,
      offers,
      query: 'q',
      now,
      maxAgeMs: 1000,
    });
  assert.equal(report([state]).inventory[0].collectionComplete, true);
  assert.equal(report([state]).complete, false);
  assert.equal(report([{ ...state, reviewComplete: true }]).complete, true);
  assert.equal(
    report([{ ...state, collectedAt: '1999-01-01' }]).inventory[0].fresh,
    false
  );
  assert.equal(
    sourceCompleteness({
      inventory: [],
      states: [],
      offers: [],
      query: 'q',
      now,
      maxAgeMs: 1000,
    }).complete,
    false
  );
  const warnings = formatSearchFailures({
    completeness: report([state]),
    valueExclusions: [{ offerId: 'other', reasons: ['quote-per-person'] }],
  });
  assert.match(warnings, /Outstanding: web/);
  assert.match(warnings, /quote-per-person/);
  const service = new SearchService({
    registry: {
      inventory: async () => sourceInventory([source]),
      list: async () => [source],
    },
    collector: {},
    store: { listOffers: async () => offers, loadRecords: async () => [state] },
    now: () => now,
  });
  const result = await service.searchWithReport({
    sourceMode: 'exhaustive',
    query: 'q',
    refresh: false,
  });
  assert.deepEqual(result.report.completeness.outstandingSources, ['web']);
  const fallback = new SearchService({
    registry: { list: async () => [source] },
    collector: {},
    store: { listOffers: async () => offers },
    now: () => now,
  });
  assert.equal(
    (
      await fallback.searchWithReport({
        sourceMode: 'exhaustive',
        refresh: false,
      })
    ).report.completeness.verdict,
    'incomplete'
  );
});

it('records the exact fetched FX table provenance while preserving numeric rate enumeration', async () => {
  const rates = await new ExchangeRateProvider({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ rates: { USD: 1 / 25000 } }),
    }),
  }).getRates();
  assert.deepEqual(Object.keys(rates), ['VND', 'USD']);
  const offer = normalizeOffer(
    { sourceId: 'fx', text: 'For rent: 100 USD/month, 2 bedrooms.' },
    { now, rates }
  );
  assert(Math.abs(offer.currencyProvenance.rate - 25000) < 0.000001);
  assert.match(offer.currencyProvenance.observedAt, /^\d{4}-/);
  assert.equal(
    offer.currencyProvenance.source,
    'https://open.er-api.com/v6/latest/VND'
  );
});

it('validates value policies and classifies multilingual unit quotes before division', () => {
  assert.throws(() => validateComparison({ sortBy: 'unknown' }), TypeError);
  assert.throws(
    () => validateComparison({ comparisonPeriod: 'unknown' }),
    TypeError
  );
  assert.throws(() => validateComparison({ stayNights: -1 }), RangeError);
  assert.equal(quoteBasis('Rent: 500 USD за кровать'), 'bed');
  assert.equal(quoteBasis('Rent: 500 USD per bedroom'), 'bedroom');
  assert.equal(quoteBasis('Rent: 500 USD per person'), 'person');
  assert.equal(quoteBasis('Giá: 500 EUR mỗi phòng'), 'room');
  assert.equal(quoteBasis('Giá: 500 GBP/giường'), 'bed');
  assert.equal(
    compareOfferValue({ priceVnd: 1, priceBasis: 'room' }).totalVnd,
    undefined
  );
});

it('explains each quoted denominator, stay estimate and currency provenance in result output', () => {
  const offer = normalizeOffer(
    {
      sourceId: 'fixture',
      text: 'For rent: 12M VND/month; 2 bedrooms, 3 rooms, 4 beds.',
    },
    { now }
  );
  const value = compareOfferValue(offer, { stayNights: 15 });
  assert.equal(value.basisProvenance, 'inferred-from-quote');
  const formatted = formatOfferValue(value);
  assert.match(formatted, /Estimated 15-night total: 6,000,000 VND/);
  assert.match(formatted, /3,000,000 VND\/bedroom\/stay ÷ 2/);
  assert.match(formatted, /2,000,000 VND\/room\/stay ÷ 3/);
  assert.match(formatted, /1,500,000 VND\/bed\/stay ÷ 4/);
  assert.match(formatted, /"currency":"VND","rate":1/);
  const unknown = formatOfferValue(
    compareOfferValue(
      { priceVnd: 100, price: { currency: 'USD', basis: 'person' } },
      { stayNights: 7 }
    )
  );
  assert.match(unknown, /Stay total excluded: quote-per-person/);
  assert.match(unknown, /room: excluded/);
  assert.equal(formatOfferValue(), undefined);
});

it('keeps price ceiling exclusions visible and refuses vague room-count filters', async () => {
  const offers = [
    {
      id: 'valid',
      sourceId: 'fixture',
      priceVnd: 120,
      attributes: { rooms: 3, beds: 4, bedrooms: 2 },
    },
    {
      id: 'unknown',
      sourceId: 'fixture',
      priceVnd: 120,
      attributes: { labeledFields: { rooms: 'at least 3' } },
    },
    {
      id: 'expensive',
      sourceId: 'fixture',
      priceVnd: 1200,
      attributes: { rooms: 3, beds: 4, bedrooms: 2 },
    },
  ];
  const service = new SearchService({
    registry: { list: async () => [] },
    collector: {},
    store: { listOffers: async () => offers },
    now: () => now,
  });
  const result = await service.searchWithReport({
    maxPerRoomVnd: 100,
    refresh: false,
  });
  assert.deepEqual(
    result.offers.map(({ id }) => id),
    ['valid']
  );
  assert.equal(result.report.valueExclusions[0].offerId, 'unknown');
  assert.deepEqual(
    (await service.search({ minRooms: 2, refresh: false }))
      .map(({ id }) => id)
      .sort(),
    ['expensive', 'valid']
  );
});

it('propagates a reconciliation deadline to OCR and stops every queued album photo', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    reconcileTelegramMaterials(
      [
        {
          sourceId: 'fixture',
          id: 1,
          groupedId: 'album',
          media: { id: '1' },
          text: '',
        },
        {
          sourceId: 'fixture',
          id: 2,
          groupedId: 'album',
          media: { id: '2' },
          text: '',
        },
      ],
      {
        signal: controller.signal,
        ocr: async (_id, options) => {
          assert.equal(options.signal, controller.signal);
          calls += 1;
          controller.abort(new Error('OCR deadline'));
          options.signal.throwIfAborted();
        },
      }
    ),
    /OCR deadline/
  );
  assert.equal(calls, 1);
});

it('uses the main-frame raw HTTP status even when a commander reports DOM readiness', async () => {
  const page = new EventEmitter();
  const frame = {};
  page.mainFrame = () => frame;
  const commander = {
    page,
    goto: async () => {
      page.emit('response', {
        request: () => ({ isNavigationRequest: () => true }),
        frame: () => ({}),
        status: () => 200,
      });
      page.emit('response', {
        request: () => ({ isNavigationRequest: () => true }),
        frame: () => frame,
        status: () => 503,
      });
      return { navigated: true, status: 'ready' };
    },
  };
  assert.equal(
    (await gotoPage(commander, 'https://fixture.invalid')).httpStatus,
    503
  );
  assert.equal(page.listenerCount('response'), 0);
  assert.equal(
    (
      await gotoPage(
        { goto: async () => ({ status: () => 202 }) },
        'https://fixture.invalid'
      )
    ).httpStatus,
    202
  );
  for (const [status, category] of [
    [202, 'http-pending'],
    [404, 'http-client-error'],
    [502, 'http-server-error'],
    [503, 'http-server-error'],
    [302, 'http-unresolved'],
  ]) {
    assert.equal(classifyListingPage({ status, cards: 1 }), category);
  }
  assert.equal(statusForFailure('http-pending', 202), 'pending');
});

it('a caller deadline cannot start another lookup while the previous native RPC is still active', async () => {
  const queue = new TelegramPhotoScheduler({ minIntervalMs: 0 });
  let finish;
  const active = new Promise((resolve) => {
    finish = resolve;
  });
  let started = false;
  const controller = new AbortController();
  const first = queue.run(() => active, { signal: controller.signal });
  await Promise.resolve();
  controller.abort(new Error('deadline'));
  await assert.rejects(first, /deadline/);
  const second = queue.run(() => {
    started = true;
    return 'done';
  });
  await Promise.resolve();
  assert.equal(started, false);
  finish('done');
  assert.equal(await second, 'done');
});

it('persists native OCR flood backoff before restart and never calls a deferred or cancelled RPC', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'qa-native-ocr-retry-'));
  try {
    let time = Date.now();
    const retries = new TelegramMediaRetries(directory, { now: () => time });
    const options = {
      material: { members: [{ sourceId: 'fixture', media: { id: '1' } }] },
    };
    await assert.rejects(
      retryNativePhoto(retries, '1', options, () => {
        throw new Error('FLOOD_WAIT_45');
      })
    );
    let calls = 0;
    const operation = () => {
      calls += 1;
      return new Uint8Array([1]);
    };
    await assert.rejects(
      retryNativePhoto(
        new TelegramMediaRetries(directory, { now: () => time }),
        '1',
        options,
        operation
      ),
      { code: 'TELEGRAM_MEDIA_DEFERRED' }
    );
    assert.equal(calls, 0);
    time += 45001;
    assert.deepEqual(
      await retryNativePhoto(retries, '1', options, operation),
      new Uint8Array([1])
    );
    assert.deepEqual(await retries.records(), []);
    assert.equal(
      await retryNativePhoto(undefined, '1', {}, () => 'no ledger'),
      'no ledger'
    );
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await assert.rejects(
      retryNativePhoto(retries, '2', { signal: controller.signal }, operation),
      /cancelled/
    );
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
