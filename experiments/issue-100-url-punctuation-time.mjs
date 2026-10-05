// Times parsing of an official URL followed by a long punctuation run.
import { parseListingText } from '../src/index.js';

const text = `Official website: https://hotel.example/${'!'.repeat(20_000)}x`;
parseListingText(text);
for (let run = 0; run < 3; run += 1) {
  const started = globalThis.performance.now();
  parseListingText(text);
  console.log(Math.round(globalThis.performance.now() - started), 'ms');
}
