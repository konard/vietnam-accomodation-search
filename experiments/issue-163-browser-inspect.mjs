import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { extractPageListings } from '../src/browser-collector.js';
import { browserAdapterFor } from '../src/browser-adapters.js';
import { makeBrowserCommander } from 'browser-commander';
import { gotoPage } from '../src/utils.js';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const commander = makeBrowserCommander({ page });
  await page.goto('https://vietnam-real.estate/ru/rent/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  const result = await page.evaluate(() => ({
    cards: globalThis.document.querySelectorAll('.good-item').length,
    legacy: globalThis.document.querySelectorAll('[data-object]').length,
    card: globalThis.document.querySelector('.good-item')?.outerHTML,
  }));
  await writeFile(
    '/tmp/issue-163-logs/live-dom.json',
    JSON.stringify(result, null, 2)
  );
  console.log(
    JSON.stringify({
      cards: result.cards,
      legacy: result.legacy,
      extracted: (
        await commander.evaluate(
          extractPageListings,
          'web',
          browserAdapterFor(page.url()).selectors
        )
      ).length,
    })
  );
  const url = await page
    .locator('.good-item__desc[href]')
    .first()
    .getAttribute('href');
  if (url) {
    await page.goto(new globalThis.URL(url, page.url()).href, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await writeFile(
      '/tmp/issue-163-logs/live-detail.html',
      await page.content()
    );
    const adapter = browserAdapterFor(page.url());
    const rows = await commander.evaluate(
      extractPageListings,
      'web',
      adapter.selectors
    );
    console.log(
      JSON.stringify({
        detail: true,
        cards: rows.length,
        fields: Object.keys(rows[0]?.semantic || {}),
        images: rows[0]?.photos?.length,
      })
    );
  }
  await gotoPage(commander, 'https://vietnam-real.estate/ru/rent/', 45000);
  const trace = await commander.startTrace({
    output: '/tmp/issue-163-logs/inspect-trace',
    screenshots: 'checkpoints',
  });
  await trace.checkpoint('loaded');
  await trace.stop();
  await commander.destroy();
} finally {
  await browser.close();
}
