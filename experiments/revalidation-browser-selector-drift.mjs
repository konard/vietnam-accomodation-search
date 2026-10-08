// Self-authored DOM fixtures; no real listing bodies, contacts or network.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { browserAdapterFor } from '../src/browser-adapters.js';
import { extractPageListings } from '../src/browser-collector.js';

const browser = await chromium.launch();
let commander;
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  commander = makeBrowserCommander({ page });
  const selectors = browserAdapterFor(
    'https://vietnam-real.estate/ru/rent/'
  ).selectors;
  await page.setContent(
    '<div class="objects-list"><ul><li data-object="123"><div class="title"><a href="https://vietnam-real.estate/property/qa-123/">Studio for rent in Nha Trang</a></div><div class="price">13 million VND / month</div></li></ul></div>'
  );
  const legacy = await commander.evaluate(
    extractPageListings,
    'web',
    selectors
  );
  assert.equal(legacy.length, 1, 'Legacy selector control must work.');
  await page.setContent(
    '<div class="catalogy__items-blocks"><div class="good-item good-item--noShadow"><div class="good-item__content"><header class="good-item__header"><a class="p2 medium-font good-item__desc" href="https://vietnam-real.estate/property/qa-123/">Studio for rent in Nha Trang</a></header><div class="price">13 million VND / month</div></div></div></div>'
  );
  const current = await commander.evaluate(
    extractPageListings,
    'web',
    selectors
  );
  console.log(
    JSON.stringify({
      legacyCards: legacy.length,
      currentCards: current.length,
      pass: current.length === 1,
    })
  );
  assert.equal(
    current.length,
    1,
    'Supported adapter must recognize the observed current rental-card container shape.'
  );
} finally {
  await commander?.destroy();
  await browser.close();
}
