#!/usr/bin/env node

// Inspect a private Browser Commander checkpoint without printing raw card text.
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { assertManualLocalRun } from './browser-real-estate-audit-lib.mjs';
import { browserAdapterFor } from '../src/browser-adapters.js';

assertManualLocalRun(process.env);
const [checkpointArgument, sourceUrl] = process.argv.slice(2);
if (!checkpointArgument || !sourceUrl) {
  throw new Error('Pass a private /tmp checkpoint and its source URL.');
}
const checkpoint = await realpath(checkpointArgument);
if (!checkpoint.startsWith('/tmp/')) {
  throw new Error('The checkpoint must remain under /tmp/.');
}
const adapter = browserAdapterFor(sourceUrl);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(checkpoint).toString());
  const cards = await page.evaluate(
    (selectors) =>
      [...globalThis.document.querySelectorAll(selectors.cards)].map(
        (card) => ({
          classes: card.className,
          links: [...card.querySelectorAll('a[href]')].map((link) => ({
            classes: link.className,
            pathname: (() => {
              try {
                return new globalThis.URL(link.href).pathname;
              } catch {
                return undefined;
              }
            })(),
          })),
          titleLength: card.querySelector(selectors.title)?.textContent?.trim()
            .length,
          textLength: card.innerText.length,
          descendants: [...card.querySelectorAll('*')]
            .map((node) => node.className)
            .filter((name) => typeof name === 'string' && name)
            .slice(0, 40),
        })
      ),
    adapter.selectors
  );
  console.log(JSON.stringify(cards, null, 2));
} finally {
  await browser.close();
}
