// Self-authored legacy normalized record: current parsing flags it, cache does not.
import assert from 'node:assert/strict';
import { LinksStore } from '../src/links-store.js';
import { normalizeOffer } from '../src/offers.js';
import { SearchService } from '../src/search-service.js';
import { SourceRegistry } from '../src/sources.js';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';
await withQaCleanup(async (scope) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-legacy-rent-');
  const parsed = normalizeOffer({
    sourceId: 'telegram:qa_legacy',
    sourceType: 'telegram',
    text: 'Apartment for rent in Nha Trang. Price: 4 VND/month.',
    url: 'https://t.me/qa_legacy/1',
    postedAt: new Date().toISOString(),
  });
  assert.equal(parsed.attributes.reviewRequired, true);
  const legacy = {
    ...parsed,
    attributes: { ...parsed.attributes, reviewRequired: false },
  };
  const store = new LinksStore({ directory });
  await store.saveOffers([legacy]);
  const service = new SearchService({
    store: new LinksStore({ directory }),
    registry: new SourceRegistry({ store }),
    collector: {
      collect() {
        throw new Error('No source request authorized.');
      },
    },
    traceRecorder: { record() {}, persist: () => Promise.resolve() },
  });
  const result = await service.searchWithReport({
    query: '',
    refresh: false,
    cheapest: true,
    sortBy: 'totalVnd',
    limit: 10,
  });
  console.log(
    JSON.stringify({
      currentParserRequiresReview: true,
      legacyTinyRentStillRanked: result.offers.some((o) => o.priceVnd === 4),
    })
  );
  assert.equal(
    result.offers.length,
    0,
    'Pre-fix normalized cache must not bypass current rent safety checks after an upgrade.'
  );
});
