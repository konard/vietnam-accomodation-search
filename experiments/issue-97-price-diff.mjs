// Compares the committed rent parser with another version over a text corpus
// and prints every post whose parsed price differs.
// Usage: node experiments/issue-97-price-diff.mjs <old-pricing.mjs> <posts.json>
// where posts.json is an array of { source, text } records.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { parsePrice } from '../src/pricing.js';

const [oldModule, corpus] = process.argv.slice(2);
const { parsePrice: oldParsePrice } = await import(
  pathToFileURL(oldModule).href
);
const posts = JSON.parse(await readFile(corpus, 'utf8'));
let changed = 0;
for (const { source, text } of posts) {
  const before = JSON.stringify(oldParsePrice(text));
  const after = JSON.stringify(parsePrice(text));
  if (before !== after) {
    changed += 1;
    console.log(
      `--- ${source}\n${text.slice(0, 700)}\nOLD ${before}\nNEW ${after}\n`
    );
  }
}
console.log(`${changed} of ${posts.length} posts changed`);
