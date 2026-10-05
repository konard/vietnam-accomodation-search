// Collects listing-card text from the Vietnamese Nha Trang web sources with
// the collector's own in-page extraction, for the reviewed field corpus.
//
//   node experiments/issue-97-collect-vi-cards.mjs /tmp/vi-cards.json
//   CARD_SOURCES=be-jib-nha-trang,nha-trang-vn \
//     node experiments/issue-97-collect-vi-cards.mjs /tmp/web-cards.json
//
// The output holds live contact details; anonymise it before committing.
import { writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

import { browserAdapterFor } from '../src/browser-adapters.js';
import { extractPageListings } from '../src/browser-collector.js';
import { DEFAULT_WEB_SOURCES } from '../src/index.js';

const output = process.argv[2] || '/tmp/vi-cards.json';
// CARD_SOURCES picks enabled sources by id in any language.
const only = new Set(
  (process.env.CARD_SOURCES || '').split(',').filter(Boolean)
);
const sources = DEFAULT_WEB_SOURCES.filter(
  (source) =>
    source.enabled !== false &&
    (only.size
      ? only.has(source.id)
      : source.geographicFocus === 'nha-trang' &&
        source.languages?.includes('vi'))
);

const browser = await chromium.launch({
  args: process.env.BROWSER_NO_SANDBOX ? ['--no-sandbox'] : [],
});
const cards = [];
try {
  for (const source of sources) {
    const url = source.searchUrl || source.url;
    const page = await browser.newPage();
    try {
      await page.goto(url, { timeout: 45_000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3_000);
      const selectors = JSON.stringify(browserAdapterFor(url).selectors);
      const rows = await page.evaluate(
        `(${extractPageListings.toString()})('web', ${selectors})`
      );
      console.error(`${source.id}: ${rows.length} cards`);
      cards.push(
        ...rows.map((row) => ({
          sourceId: source.id,
          text: row.text,
          url: row.url,
        }))
      );
    } catch (error) {
      console.error(`${source.id}: ${error.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(output, `${JSON.stringify(cards, null, 2)}\n`);
console.error(`${cards.length} cards written to ${output}`);
