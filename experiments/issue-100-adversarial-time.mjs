// Times each adversarial whitespace post the bounded-time test parses.
import { parseListingText } from '../src/index.js';

parseListingText('warm up');
for (const prefix of ['этаж', 'mã']) {
  const started = globalThis.performance.now();
  parseListingText(`${prefix}${' '.repeat(10_000)}!`);
  console.log(prefix, Math.round(globalThis.performance.now() - started), 'ms');
}
