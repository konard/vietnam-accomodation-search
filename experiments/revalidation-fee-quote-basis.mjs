// Self-authored rent/fee grammar observed during cached candidate review.
import assert from 'node:assert/strict';
import { normalizeOffer } from '../src/offers.js';
const offer = normalizeOffer({
  text: 'Apartment for rent in Nha Trang. Price: 3.5 million VND/month.\n• Water:120,000VND/person\n• Management:200,000VND/person',
});
assert.equal(offer.priceVnd, 3500000);
console.log(
  JSON.stringify({
    wholePropertyRentMisclassified: offer.priceBasis === 'person',
  })
);
assert.equal(
  offer.priceBasis,
  'property',
  'A utility per-person fee must not change the monthly rent scope.'
);
