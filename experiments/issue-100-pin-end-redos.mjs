// Times a pinned location line padded with whitespace that no delimiter ends.
import { parseListingText } from '../src/index.js';

for (const size of [10_000, 20_000, 40_000]) {
  const text = `📍 Lộc Thọ${'\t'.repeat(size)}x`;
  const started = globalThis.performance.now();
  parseListingText(text);
  console.log(size, Math.round(globalThis.performance.now() - started), 'ms');
}
