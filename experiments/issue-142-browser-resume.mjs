#!/usr/bin/env node
// Self-authored pages in a real Chromium browser; no private Telegram data.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import {
  BrowserCollector,
  LinksStore,
  formatSearchFailures,
} from '../src/index.js';

const directory = await mkdtemp(join(tmpdir(), 'preview-resume-'));
const browser = await chromium.launch({ headless: true });
const now = new Date('2026-10-07T00:00:00Z');
const source = {
  id: 'telegram:qa144',
  url: 'https://t.me/qa144',
  searchUrl: 'https://t.me/s/qa144',
  type: 'telegram',
};
const visits = [];
try {
  const makeRuntime = () => ({
    launchBrowser: async () => {
      const page = await browser.newPage();
      await page.route('https://t.me/**', async (route) => {
        const url = new globalThis.URL(route.request().url());
        const before = Number(url.searchParams.get('before') || 100);
        const id = before === 100 ? 80 : 30;
        const date =
          before === 100 ? now.toISOString() : '2026-07-01T00:00:00Z';
        visits.push(url.href);
        await route.fulfill({
          contentType: 'text/html',
          body: `<div class="tgme_widget_message">
          <div class="tgme_widget_message_text">For rent: studio apartment in Nha Trang, 13 million VND/month.</div>
          <a class="tgme_widget_message_date" href="https://t.me/qa144/${id}"><time datetime="${date}"></time></a></div>`,
        });
      });
      return { browser: { close: () => page.close() }, page };
    },
    makeBrowserCommander: ({ page }) => ({
      goto: ({ url }) => page.goto(url, { waitUntil: 'domcontentloaded' }),
      evaluate: (operation, value) => page.evaluate(operation, value),
      destroy: async () => {},
    }),
  });
  const results = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const store = new LinksStore({ directory, binaryMirror: false });
    const collector = new BrowserCollector({
      store,
      now: () => now,
      maxTelegramPages: 1,
      browserRuntime: makeRuntime(),
      logger: { debug: console.error },
      scheduler: { run: (_url, operation) => operation() },
    });
    const result = await collector.collectWithReport([source], '', {
      onSourceComplete: ({ offers }) => store.saveOffers(offers),
    });
    results.push({
      status: result.outcomes[0].status,
      summary: result.summary,
      warning: formatSearchFailures(result),
      cached: (await store.listOffers()).length,
    });
  }
  console.log(
    JSON.stringify(
      { mode: 'self-authored-real-browser', visits, results },
      null,
      2
    )
  );
  if (
    results[0].status !== 'partial' ||
    !results[0].warning ||
    results[1].summary.succeeded !== 1 ||
    results[1].cached !== 1 ||
    !visits[1].includes('before=80')
  ) {
    throw new Error('Real-browser resume acceptance failed.');
  }
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
