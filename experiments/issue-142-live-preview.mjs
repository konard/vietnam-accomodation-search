#!/usr/bin/env node
// Read-only public preview probe. Print aggregate evidence only.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import {
  BrowserCollector,
  LinksStore,
  formatSearchFailures,
} from '../src/index.js';

const preview = new globalThis.URL(process.env.ISSUE_142_SOURCE_URL || '');
if (
  preview.origin !== 'https://t.me' ||
  !/^\/s\/[a-z\d_]+$/iu.test(preview.pathname) ||
  preview.search
) {
  throw new Error('Set ISSUE_142_SOURCE_URL to a public t.me/s/channel URL.');
}
const passes = Number(process.env.ISSUE_142_PASSES || 12);
if (!Number.isInteger(passes) || passes < 1 || passes > 12) {
  throw new Error('ISSUE_142_PASSES must be an integer from 1 to 12.');
}
const pages = Number(process.env.ISSUE_142_PAGES || 10);
if (!Number.isInteger(pages) || pages < 1 || pages > 10) {
  throw new Error('ISSUE_142_PAGES must be an integer from 1 to 10.');
}
const source = {
  id: 'telegram:live-preview-probe',
  type: 'telegram',
  url: preview.href.replace('/s/', '/'),
  searchUrl: preview.href,
};
const directory = await mkdtemp(join(tmpdir(), 'live-preview-resume-'));
const browser = await chromium.launch({ headless: true });
let complete = false;
let cutoffObserved = false;
try {
  for (let pass = 0; pass < passes && !complete; pass += 1) {
    const startedAt = Date.now();
    const visits = [];
    let messageRows = 0;
    let oldestMessageAgeDays = 0;
    const store = new LinksStore({ directory, binaryMirror: false });
    const browserRuntime = {
      launchBrowser: async () => {
        const page = await browser.newPage();
        return { browser: { close: () => page.close() }, page };
      },
      makeBrowserCommander: ({ page }) => ({
        goto: ({ url }) => {
          visits.push(url);
          return page.goto(url, { waitUntil: 'domcontentloaded' });
        },
        evaluate: async (operation, value) => {
          const result = await page.evaluate(operation, value);
          if (Array.isArray(result)) {
            for (const row of result) {
              const time = Date.parse(row.date);
              if (Number.isFinite(time)) {
                messageRows += 1;
                oldestMessageAgeDays = Math.max(
                  oldestMessageAgeDays,
                  (Date.now() - time) / (24 * 60 * 60 * 1000)
                );
              }
            }
          }
          return result;
        },
        destroy: async () => {},
      }),
    };
    const collector = new BrowserCollector({
      browserRuntime,
      concurrency: 1,
      maxTelegramPages: pages,
      store,
    });
    const result = await collector.collectWithReport([source], '', {
      onSourceComplete: ({ offers }) => store.saveOffers(offers),
    });
    const outcome = result.outcomes[0];
    complete = outcome.historyComplete === true;
    cutoffObserved ||= oldestMessageAgeDays >= 90;
    console.log(
      JSON.stringify({
        pass: pass + 1,
        pages: visits.length,
        messageRows,
        oldestMessageAgeDays: Math.floor(oldestMessageAgeDays),
        resumed: visits[0]?.includes('?before=') || false,
        status: outcome.status,
        historyComplete: outcome.historyComplete ?? null,
        offers: result.offers.length,
        cachedOffers: (await store.listOffers()).length,
        warning: Boolean(formatSearchFailures(result)),
        elapsedMs: Date.now() - startedAt,
      })
    );
    if (!complete && outcome.status !== 'partial') {
      break;
    }
  }
  console.log(
    JSON.stringify({ mode: 'live-public-preview', complete, cutoffObserved })
  );
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
