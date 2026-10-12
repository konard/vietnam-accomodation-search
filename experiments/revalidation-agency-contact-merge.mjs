// Synthetic distinct studio posts with the observed short agency-title shape.
import assert from 'node:assert/strict';
import { deduplicateOffers, normalizeOffer } from '../src/offers.js';
const offer = (id, price, description) =>
  normalizeOffer({
    sourceId: 'telegram:qa_agency',
    sourceType: 'telegram',
    url: `https://t.me/qa_agency/${id}`,
    title: 'QA-HOME',
    text: `Studio for rent in Nha Trang. ${description} Price: ${price} million VND/month.`,
    contacts: { phone: ['+84000000000'] },
    attributes: { bedrooms: 0 },
  });
const merged = deduplicateOffers([
  offer(1, 3.5, 'Shared kitchen and laundry.'),
  offer(2, 4.2, 'No kitchen. Available next month.'),
]);
console.log(JSON.stringify({ distinctPostsCollapsed: merged.length === 1 }));
assert.equal(
  merged.length,
  2,
  'A shared agency contact and short heading are not evidence of the same rental unit.'
);
