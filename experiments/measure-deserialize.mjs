#!/usr/bin/env node
// Measures canonical LiNo read-path cost (parse + deserializeRecords) on
// synthetic record-shaped offers. Prints aggregates only.
import { performance } from 'node:perf_hooks';

import { parseNotation } from '../src/link-cli-mirror.js';
import { deserializeRecords, serializeRecords } from '../src/links-store.js';

for (const count of (process.argv[2] || '250,500,1000,2000')
  .split(',')
  .map(Number)) {
  const records = Array.from({ length: count }, (_, index) => ({
    id: `offer-${index}`,
    price: { amount: index * 10, currency: 'VND', period: 'month' },
    sourceIds: [`source-${index % 40}`],
    text: `Room ${index}\nnear the beach`,
    url: `https://audit.invalid/${index}`,
  }));
  const notation = serializeRecords('offer', records);
  let started = performance.now();
  const links = parseNotation(notation).length;
  const parseMs = Math.round(performance.now() - started);
  started = performance.now();
  const restored = deserializeRecords('offer', notation).length;
  const deserializeMs = Math.round(performance.now() - started);
  console.log(
    JSON.stringify({
      bytes: notation.length,
      count,
      deserializeMs,
      links,
      parseMs,
      restored,
    })
  );
}
