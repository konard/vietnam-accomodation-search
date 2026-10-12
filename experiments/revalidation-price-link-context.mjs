// Self-authored same-property, different-source quote provenance control.
import assert from 'node:assert/strict';
import { deduplicateOffers, normalizeOffer } from '../src/offers.js';
const input = (username, amount, date) =>
  normalizeOffer(
    {
      sourceId: `telegram:${username}`,
      sourceType: 'telegram',
      url: `https://t.me/${username}/1`,
      text: `Apartment for rent in Nha Trang. Price: ${amount} million VND/month.`,
      title: `Same apartment, source ${username}`,
      identifiers: { property: 'qa-same-property' },
      postedAt: date,
      attributes: { bedrooms: 1, areaM2: 30 },
    },
    { now: new Date(date) }
  );
const lower = input('qa_source_alpha', 5, '2026-10-10T00:00:00Z');
const newer = input('qa_source_beta', 18, '2026-10-11T00:00:00Z');
const [offer] = deduplicateOffers([lower, newer]);
assert.equal(offer.priceVnd, 5000000);
console.log(
  JSON.stringify({
    selfAuthoredOnly: true,
    selectedCheapestQuoteSource: offer.sourceId === lower.sourceId,
    displayedLinkMatchesQuoteSource: offer.url === lower.url,
  })
);
assert.equal(
  offer.url,
  lower.url,
  'Displayed listing URL must belong to the selected quote, not a newer different source.'
);
