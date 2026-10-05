// Times a post of many blank lines that no pinned line follows.
import { parseListingText } from '../src/index.js';

parseListingText('warm up');
for (const size of [10_000, 20_000, 40_000]) {
  const started = globalThis.performance.now();
  parseListingText(`Room${'\n'.repeat(size)}x`);
  console.log(size, Math.round(globalThis.performance.now() - started), 'ms');
}
