// Replay a private Browser Commander checkpoint with candidate selectors.
// Prints aggregate coverage only; raw page content and URLs remain local.
// Usage: node experiments/replay-browser-candidate.mjs checkpoint.html selectors.json
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { extractPageListings } from '../src/browser-collector.js';
import {
  assessSourceCoverage,
  summarizeStructuredCards,
} from './browser-real-estate-audit-lib.mjs';

const [filename, configFilename] = process.argv.slice(2);
if (!filename || !configFilename) {
  throw new Error(
    'Usage: replay-browser-candidate.mjs checkpoint.html selectors.json'
  );
}
const { selectors, url } = JSON.parse(await readFile(configFilename, 'utf8'));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setContent(await readFile(filename, 'utf8'));
  await page.evaluate((baseUrl) => {
    const base = globalThis.document.createElement('base');
    base.href = baseUrl;
    globalThis.document.head.prepend(base);
  }, url);
  const cards = await page.evaluate(
    `(${extractPageListings.toString()})('web', ${JSON.stringify(selectors)})`
  );
  const pageText = await page.evaluate('document.body.innerText');
  const pageSemantic = await page.evaluate(() => ({
    contact: globalThis.document.querySelector(
      'a[href^="tel:"], a[href^="mailto:"]'
    )?.href,
  }));
  const summary = summarizeStructuredCards(cards);
  const unknownLines = cards
    .flatMap((card) => card.segments || [])
    .filter((segment) => segment.category === 'unknown')
    .slice(0, 100)
    .map((segment) => segment.text);
  const unknownNodes = await page.evaluate((lines) => {
    const counts = new Map();
    for (const line of lines) {
      const matching = [...globalThis.document.querySelectorAll('*')].filter(
        (element) => element.innerText?.trim() === line
      );
      const element = matching.at(-1);
      const label = element
        ? `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 4).join('.')}<${element.parentElement?.tagName.toLowerCase()}.${[...(element.parentElement?.classList || [])].slice(0, 4).join('.')}<${element.parentElement?.parentElement?.tagName.toLowerCase()}.${[...(element.parentElement?.parentElement?.classList || [])].slice(0, 4).join('.')}>`
        : 'unmatched';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Object.fromEntries(counts);
  }, unknownLines);
  const coverage = assessSourceCoverage({
    cards,
    finalUrl: url,
    pageSemantic,
    pageText,
    requestedUrl: url,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        cardCount: summary.cardCount,
        incompleteCards: summary.incompleteCards,
        issues: summary.issues,
        missing: coverage.missing,
        unknownNodes,
        segments: {
          consumed: summary.consumed,
          total: summary.total,
          unconsumed: summary.unconsumed,
        },
      },
      null,
      2
    )}\n`
  );
} finally {
  await browser.close();
}
