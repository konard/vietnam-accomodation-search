// Self-authored feature acceptance: a quoted unit price is known without
// inventing a whole-property total or a denominator from missing attributes.
import assert from 'node:assert/strict';
import { compareOfferValue } from '../src/value-pricing.js';

const rows = [
  ['bed', 'pricePerBedVnd'],
  ['room', 'pricePerRoomVnd'],
  ['bedroom', 'pricePerBedroomVnd'],
].map(([basis, metric]) => {
  const amount = 3_000_000;
  const value = compareOfferValue(
    {
      title: 'Self-authored explicitly priced unit',
      priceVnd: amount,
      price: { amount, currency: 'VND', period: 'month', basis },
      attributes: {},
    },
    { sortBy: metric, comparisonPeriod: 'quoted' }
  );
  assert.equal(value.totalVnd, undefined);
  return {
    basis,
    metric,
    matchingUnitQuoteAvailable: value[metric] === amount,
    propertyTotalNotInvented: value.totalVnd === undefined,
    excludedForExplicitBasis: value.exclusions.includes(`quote-per-${basis}`),
  };
});
console.log(
  JSON.stringify({ selfAuthoredOnly: true, independentLiveTruth: false, rows })
);
assert(
  rows.every((row) => row.matchingUnitQuoteAvailable),
  'Explicitly quoted units remain unavailable to their matching value comparison.'
);
