#!/usr/bin/env node

/**
 * Inspect raw unknown segment text from a private Browser Commander checkpoint.
 * The checkpoint must remain under /tmp; output is for local debugging only.
 */

import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { launchBrowser, makeBrowserCommander } from 'browser-commander';

import { browserAdapterFor } from '../src/browser-adapters.js';
import { extractPageListings } from '../src/browser-collector.js';

const [checkpointArgument, sourceUrl] = process.argv.slice(2);
if (!checkpointArgument || !sourceUrl) {
  throw new Error(
    'Usage: inspect-browser-audit-segments.mjs /tmp/checkpoint.html https://source.example/path'
  );
}
const checkpoint = await realpath(checkpointArgument);
if (!checkpoint.startsWith('/tmp/')) {
  throw new Error('Private checkpoint inspection is restricted to /tmp/.');
}

const launched = await launchBrowser({
  channel: 'chrome',
  engine: 'playwright',
  headless: true,
});
const commander = makeBrowserCommander({ page: launched.page });
try {
  await commander.goto({
    url: pathToFileURL(checkpoint).toString(),
    waitUntil: 'domcontentloaded',
  });
  const adapter = browserAdapterFor(sourceUrl);
  const cards = await commander.evaluate(
    extractPageListings,
    'web',
    adapter.selectors
  );
  const diagnostics = cards
    .map((card, cardIndex) => ({
      cardIndex,
      missing: {
        availability: !card.semantic?.availability,
        location: !card.semantic?.location,
        media: !card.photos?.length,
        price: !card.semantic?.price,
        stableIdentity: !card.attributes?.propertyId && !card.url,
        title: !card.title,
      },
      unknown: (card.segments || [])
        .filter(({ category }) => category === 'unknown')
        .map(({ text }) => text),
    }))
    .filter(
      ({ missing, unknown }) =>
        unknown.length || Object.values(missing).some(Boolean)
    );
  console.log(JSON.stringify(diagnostics, null, 2));
} finally {
  await commander.destroy().catch(() => {});
  await launched.browser.close().catch(() => {});
}
