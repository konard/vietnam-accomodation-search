#!/usr/bin/env node
// Self-authored HTTP pages prove that DOM readiness cannot override status.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { withQaCleanup } from './qa-cleanup.mjs';
import { gotoPage } from '../src/utils.js';
import { classifyPage } from './browser-real-estate-audit-lib.mjs';
import { classifyListingPage } from '../src/browser-adapters.js';
await withQaCleanup(async (scope, signal) => {
  const server = createServer((request, response) => {
    const requestedStatus = Number(request.url.slice(1));
    response.writeHead(requestedStatus >= 200 ? requestedStatus : 404, {
      'content-type': 'text/html',
    });
    response.end(
      '<title>Rental results</title><article>Apartment for rent: 12M VND/month, 2 bedrooms, 3 rooms, 4 beds.</article>'
    );
  });
  scope.defer('HTTP fixture server', () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox'],
  });
  scope.defer('browser', () => browser.close());
  const page = await browser.newPage();
  const commander = makeBrowserCommander({ page, logLevel: 'none' });
  scope.defer('commander', () => commander.destroy());
  const results = [];
  for (const status of [200, 202, 404, 502, 503]) {
    const url = `http://127.0.0.1:${server.address().port}/${status}`;
    const navigation = await gotoPage(commander, url, 5000, signal);
    assert.equal(navigation.httpStatus, status);
    const cards = await page.locator('article').count();
    const qa = classifyPage({
      status: navigation.httpStatus,
      cardCount: cards,
      url,
    });
    const production = classifyListingPage({
      status: navigation.httpStatus,
      cards,
      url,
    });
    assert.equal(qa === 'success', status === 200);
    assert.equal(production === 'rental', status === 200);
    results.push({ status, cards, qa, production });
  }
  console.log(
    JSON.stringify({ selfAuthored: true, actualBrowser: true, results })
  );
});
