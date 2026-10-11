import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { compareOfferValue, formatOfferValue } from '../src/value-pricing.js';
import { SearchService } from '../src/search-service.js';
import { parseSearchCommand } from '../src/commands.js';

const quote = (basis, amount = 3e6) => ({
  id: basis,
  sourceId: 'self-authored',
  priceVnd: amount,
  price: { amount, currency: 'VND', period: 'month', basis },
  attributes: { bedrooms: 2, rooms: 3, beds: 4 },
});

it('reports unusable unit metrics for missing positive rent or an unknown property denominator', async () => {
  for (const offer of [
    quote('bed', -1),
    { ...quote('property'), attributes: {} },
  ]) {
    const service = new SearchService({
      collector: {},
      registry: { list: async () => [] },
      store: { listOffers: async () => [offer] },
    });
    const { offers, report } = await service.searchWithReport({
      refresh: false,
      comparisonBasis: offer.price.basis,
      sortBy: 'pricePerBedVnd',
    });
    assert.equal(offers.length, 0);
    assert(
      report.valueExclusions[0].reasons.includes('missing-pricePerBedVnd')
    );
    if (offer.priceVnd < 0) {
      assert(
        report.valueExclusions[0].reasons.includes('missing-positive-rent')
      );
    }
  }
});

it('uses only the explicitly quoted matching unit and preserves stay/FX evidence', () => {
  for (const [basis, key] of [
    ['bed', 'pricePerBedVnd'],
    ['room', 'pricePerRoomVnd'],
    ['bedroom', 'pricePerBedroomVnd'],
  ]) {
    const offer = { ...quote(basis), attributes: {} };
    const value = compareOfferValue(offer, { stayNights: 15 });
    assert.equal(value[key], 1.5e6);
    assert.equal(value.totalVnd, undefined);
    assert.equal(value.metricProvenance[key], 'explicit-unit-quote');
    assert.equal(value.comparisonPool, `quote-per-${basis}`);
    assert.equal(value.currencyProvenance.status, 'original-VND');
    assert.match(formatOfferValue(value), /explicit unit quote/u);
    assert.doesNotMatch(formatOfferValue(value), /÷ undefined/u);
    for (const other of [
      'pricePerBedVnd',
      'pricePerRoomVnd',
      'pricePerBedroomVnd',
    ].filter((metric) => metric !== key)) {
      assert.equal(value[other], undefined);
    }
    assert.equal(compareOfferValue(quote(basis, -1))[key], undefined);
    assert.equal(
      compareOfferValue(
        { ...offer, price: { ...offer.price, period: 'unknown' } },
        { stayNights: 15 }
      )[key],
      undefined
    );
  }
  assert.equal(compareOfferValue(quote('person')).pricePerBedVnd, undefined);
  const foreign = {
    ...quote('room'),
    price: { amount: 100, currency: 'USD', period: 'week', basis: 'room' },
    currencyProvenance: {
      status: 'converted',
      rate: 30000,
      source: 'self-authored-rate',
      fetchedAt: '2026-10-11T00:00:00Z',
    },
  };
  const converted = compareOfferValue(foreign, { comparisonPeriod: 'month' });
  assert.equal(converted.pricePerRoomVnd, (3e6 * 30) / 7);
  assert.equal(converted.stayNights, 30);
  assert.equal(converted.quotedPeriod, 'week');
  assert.equal(converted.basis, 'room');
  assert.deepEqual(converted.currencyProvenance, foreign.currencyProvenance);
  assert.equal(converted.totalVnd, undefined);
  assert.match(formatOfferValue(converted), /self-authored-rate/u);
});

it('scopes search and filters to a billing basis without mixing exclusive properties and unit quotes', async () => {
  const offers = [
    quote('bed'),
    quote('property', 4e6),
    quote('room', 1e6),
    quote('person', 1e6),
  ];
  const service = new SearchService({
    collector: {},
    registry: { list: async () => [] },
    store: { listOffers: async () => offers },
  });
  const mixed = await service.searchWithReport({
    refresh: false,
    sortBy: 'pricePerBedVnd',
  });
  assert.equal(mixed.offers.length, 0);
  assert(
    mixed.report.valueExclusions.some(({ reasons }) =>
      reasons.includes('mixed-quote-bases-require-comparison-basis')
    )
  );
  const scoped = await service.searchWithReport({
    refresh: false,
    sortBy: 'pricePerBedVnd',
    comparisonBasis: 'bed',
    maxPerBedVnd: 3e6,
  });
  assert.deepEqual(
    scoped.offers.map(({ id }) => id),
    ['bed']
  );
  assert.equal(scoped.report.comparison.comparisonBasis, 'bed');
  assert.equal(scoped.offers[0].value.pricePerBedVnd, 3e6);
  const filtered = await service.searchWithReport({
    refresh: false,
    comparisonBasis: 'bed',
    maxPerBedVnd: 3e6,
  });
  assert.deepEqual(
    filtered.offers.map(({ id }) => id),
    ['bed']
  );
  assert.equal(filtered.report.comparison.sortBy, 'pricePerBedVnd');
  assert.equal(
    (
      await service.search({
        refresh: false,
        sortBy: 'pricePerBedVnd',
        comparisonBasis: 'bed',
        maxPerBedVnd: 2e6,
      })
    ).length,
    0
  );
  assert.equal(
    (
      await service.search({
        refresh: false,
        sortBy: 'pricePerBedVnd',
        comparisonBasis: 'property',
      })
    )[0].value.pricePerBedVnd,
    1e6
  );
  const parsed = parseSearchCommand(
    '--sort-by pricePerBedVnd --comparison-basis bed'
  );
  assert.equal(parsed.comparisonBasis, 'bed');
  assert.throws(() =>
    compareOfferValue(quote('bed'), { comparisonBasis: 'person' })
  );
});
