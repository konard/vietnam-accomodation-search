// Self-authored wrapper around observed Vietnamese negative amenity grammar.
import assert from 'node:assert/strict';
import { normalizeOffer } from '../src/offers.js';
const offer = normalizeOffer({
  text: 'Cho thuê studio Nha Trang. Full nội thất, không có máy giặt. Giá 4 triệu/tháng.',
});
const included = offer.attributes.amenities.includes('washing-machine');
console.log(JSON.stringify({ explicitlyAbsentWasherIncluded: included }));
assert.equal(
  included,
  false,
  'An explicitly absent washing machine must not satisfy an amenity filter.'
);
