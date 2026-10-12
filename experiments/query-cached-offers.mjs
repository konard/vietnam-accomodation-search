// Local QA query of real collected data. Never collect or contact a source.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LinksStore } from '../src/links-store.js';
import { SearchService } from '../src/search-service.js';
import { SourceRegistry } from '../src/sources.js';

function options(values) {
  const result = { directory: 'data', days: 7, limit: 10, minimum: 0 };
  const names = {
    '--directory': 'directory',
    '--days': 'days',
    '--limit': 'limit',
    '--output': 'output',
    '--min-monthly-vnd': 'minimum',
  };
  for (let index = 0; index < values.length; index += 2) {
    const name = names[values[index]];
    assert(
      name && values[index + 1],
      'Unknown or incomplete cache query flag.'
    );
    result[name] = values[index + 1];
  }
  result.days = Number(result.days);
  result.limit = Number(result.limit);
  result.minimum = Number(result.minimum);
  assert(Number.isInteger(result.days) && result.days > 0 && result.days <= 90);
  assert(
    Number.isInteger(result.limit) && result.limit > 0 && result.limit <= 50
  );
  result.directory = resolve(result.directory);
  assert(Number.isFinite(result.minimum) && result.minimum >= 0);
  result.output ||= resolve(result.directory, 'top-10-nha-trang-monthly.json');
  assert(resolve(result.output).startsWith(`${result.directory}/`));
  return result;
}

const paths = options(process.argv.slice(2));
const now = new Date();
const since = now.getTime() - paths.days * 86400000;
let networkRequests = 0;
globalThis.fetch = () => {
  networkRequests += 1;
  throw new Error('Cached ranking must not make a source request.');
};
const store = new LinksStore({ directory: paths.directory });
const cached = await store.listOffers();
const available = (offer) =>
  offer.attributes?.reviewRequired !== true &&
  offer.attributes?.availableNow !== false &&
  offer.attributes?.availability !== 'unavailable';
const candidates = cached.filter(
  (offer) =>
    /nha[\s_-]?trang|ня[\s-]?чанг/iu.test(offer.location || '') &&
    (offer.sourceType !== 'telegram' || Date.parse(offer.postedAt) >= since) &&
    offer.price?.currency === 'VND' &&
    offer.price?.period === 'month' &&
    offer.priceBasis === 'property' &&
    offer.priceVnd >= paths.minimum &&
    !!offer.url &&
    available(offer)
);
const service = new SearchService({
  store: {
    listOffers: () => Promise.resolve(candidates),
    loadRecords: store.loadRecords.bind(store),
  },
  registry: new SourceRegistry({ store }),
  collector: {
    collect() {
      networkRequests += 1;
      throw new Error('Cached ranking must not collect.');
    },
  },
  traceRecorder: { record() {}, persist: () => Promise.resolve() },
  now: () => now,
});
const result = await service.searchWithReport({
  query: '',
  refresh: false,
  cheapest: true,
  sortBy: 'totalVnd',
  comparisonBasis: 'property',
  comparisonPeriod: 'quoted',
  limit: paths.limit,
});
assert.equal(networkRequests, 0);
assert(
  result.offers.every(
    (offer, index, all) =>
      offer.url &&
      (index === 0 || all[index - 1].value.totalVnd <= offer.value.totalVnd)
  )
);
await writeFile(
  paths.output,
  JSON.stringify({
    generatedAt: now.toISOString(),
    partial: true,
    manuallyReviewed: false,
    productionRankingDefectsRemain: true,
    ranking: 'Nha Trang, quoted whole-offer monthly VND total ascending',
    publicationWindowDays: paths.days,
    minimumMonthlyVndScreen: paths.minimum,
    availabilityVerified: false,
    independentFieldQualityVerified: false,
    noTargetApiRequests: true,
    offers: result.offers,
    report: result.report,
  }),
  { mode: 0o600 }
);
console.log(
  JSON.stringify({
    partialTop10Available: result.offers.length >= 10,
    directLinksPresent: result.offers.every((offer) => !!offer.url),
    monthlyOriginalVndOnly: true,
    cachedProductionRankingExercised: true,
    noTargetApiRequests: networkRequests === 0,
    availabilityVerified: false,
  })
);
