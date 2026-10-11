/* eslint local/no-changelog-comments: ["warn", {"allowDatesInStrings": true}] -- Dates are fixed fixture inputs. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { it } from 'test-anywhere';
import {
  compareOfferValue,
  formatOfferValue,
  offerDenominator,
  quoteBasis,
  validateComparison,
} from '../src/value-pricing.js';
import {
  SourceRegistry,
  SearchService,
  sourceInventory,
  sourceCompleteness,
  parseSearchCommand,
  normalizeOffer,
} from '../src/index.js';
import { collectionKey } from '../src/search-refresh.js';

const now = new Date('2025-01-01T01:00:00Z');
const base = {
  id: 'value',
  sourceId: 'fixture',
  priceVnd: 12e6,
  price: { amount: 12e6, currency: 'VND', period: 'month' },
  attributes: { bedrooms: 2, rooms: 3, beds: 4 },
  collectedAt: now.toISOString(),
};

it('bounds quote scanning for a long digit-only listing', () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const result = JSON.parse(
    execFileSync(
      'node',
      ['--max-old-space-size=64', 'experiments/issue-177-quote-scan.mjs'],
      {
        encoding: 'utf8',
      }
    )
  );
  assert.equal(result.pass, true);
});

it('compares distinct denominators and an explicit stay while preserving the quote', () => {
  const value = compareOfferValue(base, { stayNights: 15 });
  assert.equal(value.totalVnd, 6e6);
  assert.equal(value.pricePerBedroomVnd, 3e6);
  assert.equal(value.pricePerRoomVnd, 2e6);
  assert.equal(value.pricePerBedVnd, 1.5e6);
  assert.equal(base.priceVnd, 12e6);
  assert.match(formatOfferValue(value), /15-night total/);
  assert.match(formatOfferValue(value), /attributes.bedrooms/);
  assert.equal(
    compareOfferValue(base, { comparisonPeriod: 'night' }).totalVnd,
    400000
  );
  assert.equal(compareOfferValue(base).comparisonPeriod, 'month');
  assert.equal(formatOfferValue(), undefined);
});

it('excludes zero, negative, vague, fractional and unknown counts without inventing studios', () => {
  for (const count of [0, -1, undefined, 1.5]) {
    const value = compareOfferValue({
      ...base,
      attributes: { bedrooms: count },
    });
    assert.equal(value.pricePerBedroomVnd, undefined);
    assert.match(formatOfferValue(value), /excluded/);
  }
  assert.deepEqual(offerDenominator({}, 'beds'), {
    count: undefined,
    provenance: 'unknown',
  });
  assert.equal(
    offerDenominator({ attributes: { labeledFields: { beds: ['4'] } } }, 'beds')
      .count,
    4
  );
  assert.equal(
    offerDenominator(
      { attributes: { labeledFields: { rooms: 'at least 3' } } },
      'rooms'
    ).count,
    undefined
  );
  assert.equal(
    compareOfferValue({ ...base, attributes: { bedrooms: 0, rooms: 1 } })
      .pricePerRoomVnd,
    12e6
  );
});

it('keeps quote basis, FX and denominators aligned with the selected merged variant', () => {
  for (const [text, basis] of [
    ['100 USD per person', 'person'],
    ['2M VND/room', 'room'],
    ['3M VND/bedroom', 'bedroom'],
    ['4M VND/bed', 'bed'],
    ['5M VND за комнату', 'room'],
    ['6M VND mỗi người', 'person'],
    ['12M VND/month\nElectricity 10 USD per person', 'property'],
  ]) {
    assert.equal(quoteBasis(text), basis);
  }
  const perPerson = compareOfferValue(
    { ...base, priceBasis: 'person' },
    { stayNights: 5 }
  );
  assert.equal(perPerson.totalVnd, undefined);
  assert.match(formatOfferValue(perPerson), /quote-per-person/);
  assert.equal(compareOfferValue({}).totalVnd, undefined);
  assert.equal(
    compareOfferValue({ ...base, price: {} }, { comparisonPeriod: 'week' })
      .totalVnd,
    undefined
  );
  const merged = {
    ...base,
    attributes: { bedrooms: 9 },
    variants: [
      { ...base, currencyProvenance: { rate: 25000, source: 'fixture' } },
    ],
  };
  assert.equal(compareOfferValue(merged).pricePerBedroomVnd, 6e6);
  assert.equal(compareOfferValue(merged).currencyProvenance.source, 'fixture');
  const normalized = normalizeOffer(
    { text: 'For rent: 100 USD per person', sourceId: 'fixture' },
    {
      now,
      rates: { USD: 25000 },
      rateObservedAt: now.toISOString(),
      rateSource: 'fixture',
    }
  );
  assert.equal(compareOfferValue(normalized).totalVnd, undefined);
  assert.equal(normalized.currencyProvenance.observedAt, now.toISOString());
});

it('validates and persists the shared comparison option contract', () => {
  for (const options of [
    { sortBy: 'other' },
    { comparisonPeriod: 'other' },
    { stayNights: 0 },
    { stayNights: 3651 },
    { stayNights: 1.5 },
  ]) {
    assert.throws(() => validateComparison(options));
  }
  assert.deepEqual(
    parseSearchCommand(
      '--all-sources --comparison-period month --stay-nights 30 --min-per-bedroom-vnd 100 --sort-by pricePerBedVnd'
    ).sourceMode,
    'exhaustive'
  );
});

it('excludes mixed billing periods until a comparison policy is supplied and resets previous values', async () => {
  const offers = [
    base,
    {
      ...base,
      id: 'night',
      sourceId: 'night',
      priceVnd: 1e6,
      price: { currency: 'VND', period: 'night' },
    },
  ];
  const service = new SearchService({
    now: () => now,
    collector: {},
    registry: { list: async () => [] },
    store: { listOffers: async () => offers },
  });
  const rejected = await service.searchWithReport({
    refresh: false,
    sortBy: 'totalVnd',
  });
  assert.equal(rejected.offers.length, 0);
  assert.equal(rejected.report.valueExclusions.length, 2);
  const accepted = await service.search({
    refresh: false,
    stayNights: 15,
    sortBy: 'pricePerBedroomVnd',
  });
  assert.equal(accepted[0].value.totalVnd, 6e6);
  assert.equal(
    (await service.search({ refresh: false }))[0].value.totalVnd,
    12e6
  );
});

it('keeps every manifest entry visible and removes ranked caps only in exhaustive mode', async () => {
  const seed = Array.from({ length: 25 }, (_, index) => ({
    id: `web-${index}`,
    type: 'web',
    enabled: true,
    popularity: { value: index },
  }));
  seed.push(
    {
      id: 'disabled',
      type: 'web',
      enabled: false,
      reason: 'unsupported-selector',
    },
    { id: 'retired', type: 'web', retired: true },
    { id: 'unsupported', type: 'other' },
    { id: 'telegram:Alias', username: '@Alias', type: 'telegram' }
  );
  const store = {
    loadSources: async () => [
      ...seed,
      { id: 'telegram:alias', type: 'telegram', url: 'https://t.me/s/Alias' },
    ],
    saveSources: async () => {},
  };
  const registry = new SourceRegistry({ store });
  // Custom inventory also exercises case and @ alias canonicalization.
  const inventory = sourceInventory(seed, await store.loadSources());
  assert.equal(inventory.filter(({ type }) => type === 'telegram').length, 1);
  assert.equal(
    inventory.find(({ id }) => id === 'disabled').capability,
    'disabled'
  );
  assert.equal(
    inventory.find(({ id }) => id === 'retired').capability,
    'retired'
  );
  assert.equal(
    inventory.find(({ id }) => id === 'unsupported').capability,
    'unsupported'
  );
  assert((await registry.inventory()).length >= 29);
  assert(
    (await registry.list(undefined, { mode: 'exhaustive' })).length >
      (await registry.list()).length
  );
});

it('never upgrades a fetched, unreviewed or stale source into complete inventory', () => {
  const inventory = sourceInventory([
    { id: 'one', type: 'web' },
    { id: 'two', type: 'telegram' },
    { id: 'disabled', type: 'web', enabled: false },
  ]);
  const states = [
    {
      id: collectionKey('one', 'q'),
      status: 'offers',
      attemptedAt: now.toISOString(),
      collectedAt: now.toISOString(),
      parseComplete: true,
      paginationComplete: true,
      reviewComplete: true,
    },
    {
      id: collectionKey('two', 'q'),
      status: 'partial',
      collectedAt: '1999-01-01',
      historyComplete: false,
    },
  ];
  const report = sourceCompleteness({
    inventory,
    states,
    offers: [{ ...base, sourceId: 'one' }],
    query: 'q',
    now,
    maxAgeMs: 10000,
  });
  assert.equal(report.verdict, 'incomplete');
  assert.deepEqual(report.outstandingSources, ['telegram:two']);
  assert.equal(
    report.inventory[1].fieldCoverage.beds.accuracy,
    'not-evaluated'
  );
  assert.equal(report.excludedSources.length, 1);
  assert.equal(
    sourceCompleteness({
      inventory: [inventory.find(({ id }) => id === 'one')],
      states,
      offers: [],
      query: 'q',
      now,
      maxAgeMs: 10000,
    }).verdict,
    'complete'
  );
  assert.equal(
    sourceCompleteness({
      inventory: [],
      states: [],
      offers: [],
      query: '',
      now,
      maxAgeMs: 0,
    }).verdict,
    'incomplete'
  );
});

it('retains native peer and renamed-handle aliases in inventory and completeness evidence', () => {
  const inventory = sourceInventory(
    [
      { id: 'telegram:-1005', type: 'megagroup', peerId: '-1005' },
      {
        id: 'telegram:OldName',
        type: 'channel',
        username: '@NewName',
        peerId: '-1005',
      },
    ],
    [{ id: 'telegram:other', type: 'chat', username: 'Other', peerId: '-1005' }]
  );
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].id, 'telegram:peer:-1005');
  assert(inventory[0].aliases.includes('telegram:OldName'));
  assert(inventory[0].aliases.includes('telegram:newname'));
  const report = sourceCompleteness({
    inventory,
    states: [
      {
        id: collectionKey('telegram:OldName', 'q'),
        collectedAt: now.toISOString(),
        attemptedAt: now.toISOString(),
        status: 'offers',
        historyComplete: true,
        parseComplete: true,
        reviewComplete: true,
      },
    ],
    offers: [{ ...base, sourceId: 'telegram:OldName' }],
    query: 'q',
    now,
    maxAgeMs: 1000,
  });
  assert.equal(report.inventory[0].offers, 1);
  assert.equal(report.complete, true);
});

it('keeps currency-first and Russian bed-space quotations out of property totals', () => {
  for (const [text, basis] of [
    ['USD 100/bed', 'bed'],
    ['€ 100 per person', 'person'],
    ['1 млн ₽ за койко-место', 'bed'],
    ['Giá 1tr/người', 'person'],
  ]) {
    assert.equal(quoteBasis(text), basis);
    assert.equal(
      compareOfferValue({ ...base, raw: { text } }).totalVnd,
      undefined
    );
  }
});
