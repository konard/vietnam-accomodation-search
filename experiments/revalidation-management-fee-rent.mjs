// Sanitized actual quote grammar, tested without accounts or network.
import assert from 'node:assert/strict';
import { parsePrice } from '../src/pricing.js';
const text =
  '16 млн VND/месяц\nМенеджмент 500.000 VND, интернет 250.000 VND, оплата электричества и воды по счетчикам.';
const parsed = parsePrice(text);
console.log(
  JSON.stringify({
    sanitizedActualFeeGrammar: true,
    managementFeeSelectedAsRent: parsed?.amount === 500000,
    actualAmount: parsed?.amount,
  })
);
assert.equal(
  parsed?.amount,
  16000000,
  'A management fee must not replace the explicitly quoted monthly rent.'
);
