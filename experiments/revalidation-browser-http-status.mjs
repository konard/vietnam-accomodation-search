// Self-authored QA-classifier status controls; no browser or external data.
import assert from 'node:assert/strict';
import { classifyPage } from './browser-real-estate-audit-lib.mjs';

const fixture = {
  text: 'Studio for rent in Nha Trang, 12 million VND/month',
  title: 'Self-authored rental fixture',
  url: 'https://qa.invalid/rent',
};
assert.equal(
  classifyPage({ ...fixture, cardCount: 1, status: 200 }),
  'success'
);
const rows = [
  { status: 404, cardCount: 0 },
  { status: 502, cardCount: 0 },
  { status: 503, cardCount: 1 },
].map((input) => {
  const classification = classifyPage({ ...fixture, ...input });
  return {
    ...input,
    classification,
    failurePreserved: !['success', 'zero_cards'].includes(classification),
  };
});
console.log(JSON.stringify({ successControl: true, rows }));
assert(
  rows.every(({ failurePreserved }) => failurePreserved),
  'The QA classifier must not turn HTTP failures into successful or empty inventories.'
);
