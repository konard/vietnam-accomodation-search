// Self-authored wrapper around observed Vietnamese bed-option grammar.
import assert from 'node:assert/strict';
import { normalizeOffer } from '../src/offers.js';
import { compareOfferValue } from '../src/value-pricing.js';
const offer = normalizeOffer({
  text: 'Cho thuê studio Nha Trang. Studio 1 hoặc 2 giường. Giá 5 triệu/tháng.',
});
const value = compareOfferValue(offer);
console.log(
  JSON.stringify({
    alternativeBedCountTreatedAsDefinite: Number.isFinite(value.pricePerBedVnd),
  })
);
assert.equal(
  value.pricePerBedVnd,
  undefined,
  'Alternative bed configurations must not supply a definite denominator.'
);
