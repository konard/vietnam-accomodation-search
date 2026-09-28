#!/usr/bin/env node
// Shows that links-notation's default Parser rejects input over 10 MiB while
// parseNotation accepts canonical snapshots up to MAX_NOTATION_LENGTH.
import { performance } from 'node:perf_hooks';

import { Parser } from 'links-notation';

import { parseNotation } from '../src/link-cli-mirror.js';
import { deserializeRecords, serializeRecords } from '../src/links-store.js';

const notation = serializeRecords('offer', [
  { id: 'large', text: 'x'.repeat(10 * 1024 * 1024) },
]);
console.log({ length: notation.length });
try {
  new Parser().parse(notation);
} catch (error) {
  console.log({ defaultParser: error.message });
}
let started = performance.now();
console.log({
  links: parseNotation(notation).length,
  ms: Math.round(performance.now() - started),
});
started = performance.now();
console.log({
  textLength: deserializeRecords('offer', notation)[0].text.length,
  ms: Math.round(performance.now() - started),
});
