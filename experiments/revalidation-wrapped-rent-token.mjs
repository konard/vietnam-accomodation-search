// Sanitized observed newline inside a monetary token; no account or network.
import assert from 'node:assert/strict';
import { parsePrice } from '../src/pricing.js';
const parsed = parsePrice(
  'Studio for rent in Nha Trang.\n💸 1\n3,500,000 VND/month'
);
console.log(
  JSON.stringify({
    splitMoneyTokenUnderpriced: parsed?.amount === 3500000,
  })
);
assert(
  !parsed || parsed.amount === 13500000,
  'A wrapped money token must be reconciled or excluded, not lose its leading digit.'
);
