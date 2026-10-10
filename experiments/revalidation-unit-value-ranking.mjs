// Self-authored acceptance for comparable rental value, across every seed.
// No credentials, real offers, source contacts or network access are used.
import assert from 'node:assert/strict';
import { predictCase } from './field-corpus-metrics.mjs';
import {
  DEFAULT_WEB_SOURCES,
  DEFAULT_TELEGRAM_SOURCES,
  DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
  SearchService,
  normalizeOffer,
  parseSearchCommand,
} from '../src/index.js';

const now = new Date();
const text =
  'Apartment for rent in Nha Trang: 12 million VND/month. 2 bedrooms, 3 rooms, 4 beds.';
const sources = [
  ...DEFAULT_WEB_SOURCES,
  ...DEFAULT_TELEGRAM_SOURCES,
  ...DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
];
const parsed = sources.map((source) =>
  normalizeOffer({
    id: `qa:${source.id}`,
    sourceId: source.id,
    sourceType: source.type,
    text,
    collectedAt: now.toISOString(),
    postedAt: now.toISOString(),
  })
);
assert(parsed.every((offer) => offer.priceVnd === 12e6));
assert(parsed.every((offer) => offer.attributes.bedrooms === 2));
assert(parsed.every((offer) => offer.attributes.rooms === 3));
assert(parsed.every((offer) => offer.attributes.beds === 4));
const predicted = await predictCase({
  input: {
    sourceType: 'web',
    sourceId: 'qa-metric',
    text,
    postedAt: now.toISOString(),
  },
});
const metricRoomsRepresentActualRooms = predicted.rooms === 3;

function service(offers) {
  return new SearchService({
    collector: { collect: () => Promise.resolve([]) },
    registry: { list: () => Promise.resolve([]) },
    store: { listOffers: () => Promise.resolve(offers) },
    now: () => now,
  });
}

const controls = service([parsed[0]]);
assert.equal(
  (await controls.search({ refresh: false, maxPerRoomVnd: 4e6 })).length,
  1
);
assert.equal(
  (await controls.search({ refresh: false, maxPerRoomVnd: 3999999 })).length,
  0
);
assert.equal(
  (await controls.search({ refresh: false, maxPerBedVnd: 3e6 })).length,
  1
);
assert.equal(
  (await controls.search({ refresh: false, maxPerBedVnd: 2999999 })).length,
  0
);
const bedrooms = await controls.search({
  refresh: false,
  maxPerBedroomVnd: 5999999,
});
const bedroomLimitRespected = bedrooms.length === 0;

const candidates = [
  {
    id: 'qa-one-bedroom',
    title: 'One bedroom QA apartment',
    priceVnd: 6e6,
    price: { amount: 6e6, currency: 'VND', period: 'month' },
    attributes: { bedrooms: 1, beds: 1, rooms: 1 },
    collectedAt: now.toISOString(),
  },
  {
    id: 'qa-three-bedroom',
    title: 'Three bedroom QA apartment',
    priceVnd: 12e6,
    price: { amount: 12e6, currency: 'VND', period: 'month' },
    attributes: { bedrooms: 3, beds: 3, rooms: 3 },
    collectedAt: now.toISOString(),
  },
];
const ranked = await service(candidates).search({
  refresh: false,
  cheapest: true,
  sortBy: 'pricePerBedroomVnd',
  limit: 1,
});
const unitValueRankingSupported = ranked[0]?.id === 'qa-three-bedroom';
const mixed = [
  {
    ...candidates[0],
    id: 'qa-nightly',
    priceVnd: 400000,
    price: { amount: 400000, currency: 'VND', period: 'night' },
  },
  {
    ...candidates[0],
    id: 'qa-monthly',
    priceVnd: 8e6,
    price: { amount: 8e6, currency: 'VND', period: 'month' },
  },
];
const mixedResult = await service(mixed).search({
  refresh: false,
  cheapest: true,
  comparisonPeriod: 'month',
  stayNights: 30,
  limit: 1,
});
const explicitStayComparisonSupported = mixedResult[0]?.id === 'qa-monthly';
let bedroomCommandSupported = false;
try {
  const command = parseSearchCommand(
    '/search --max-per-bedroom-vnd 6000000 Nha Trang'
  );
  bedroomCommandSupported = command.maxPerBedroomVnd === 6e6;
} catch {
  // Lack of the requested command is a capability gap, not a setup failure.
}
const result = {
  allSeedParsingControl: true,
  metricRoomsRepresentActualRooms,
  roomAndBedFilterControls: true,
  bedroomLimitRespected,
  bedroomCommandSupported,
  unitValueRankingSupported,
  explicitStayComparisonSupported,
  pass:
    metricRoomsRepresentActualRooms &&
    bedroomLimitRespected &&
    bedroomCommandSupported &&
    unitValueRankingSupported &&
    explicitStayComparisonSupported,
};
console.log(JSON.stringify(result));
assert(
  result.pass,
  'Requested per-bedroom value ranking and an explicit comparable stay basis are not delivered.'
);
