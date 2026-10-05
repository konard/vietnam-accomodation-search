#!/usr/bin/env node
// Field accuracy of the product search path: createApplication →
// SearchService → BrowserCollector → LinksStore.
//
//   node experiments/audit-search-service.mjs
//   BROWSER_NO_SANDBOX=1 node experiments/audit-search-service.mjs --live
//
// The default run serves the reviewed live web cards of
// fixtures/reviewed-live-corpus.json to the collector through a stub browser,
// searches "Nha Trang" in a temporary data directory, reads the persisted
// offers back from a fresh store, and scores them per field against the
// review. `--live` searches the real default web sources instead and scores
// the persisted offers whose anonymised text matches a reviewed card; listings
// change daily, so it also reports how many offers matched.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LinksStore, createApplication } from '../src/index.js';
import { fieldMetrics, loadCorpus } from './field-corpus-metrics.mjs';
import { anonymize } from './live-corpus-anonymize.mjs';

const QUERY = 'Nha Trang';

const webCases = (corpus) =>
  corpus.cases.filter(({ input }) => input.sourceType === 'web');

const cardUrl = (testCase) =>
  `https://${testCase.input.sourceId}.audit.invalid/${testCase.id}`;

// A stub browser whose every listing page holds the reviewed cards of the
// source the collector opened.
export function replayRuntime(cases) {
  return {
    launchBrowser: () =>
      Promise.resolve({ browser: { close: () => Promise.resolve() } }),
    makeBrowserCommander: () => {
      let url = '';
      return {
        destroy: () => Promise.resolve(),
        evaluate: (operation) => {
          if (operation.name === 'extractPageState') {
            return Promise.resolve({ status: 200, url });
          }
          const host = new globalThis.URL(url).hostname;
          return Promise.resolve(
            cases
              .filter(
                (testCase) =>
                  new globalThis.URL(cardUrl(testCase)).hostname === host
              )
              .map((testCase) => ({
                text: testCase.input.text,
                title: testCase.input.text.split('\n')[0],
                url: cardUrl(testCase),
              }))
          );
        },
        goto: ({ url: target }) => {
          url = target;
          return Promise.resolve();
        },
      };
    },
  };
}

// Each replayed source keeps the city focus its reviewed cards came from.
export function replaySources(cases) {
  const focus = new Map(
    cases.map(({ input }) => [input.sourceId, input.focus])
  );
  return [...focus].map(([id, geographicFocus]) => ({
    geographicFocus,
    id,
    searchUrl: `https://${id}.audit.invalid/search?q={query}`,
    type: 'web',
  }));
}

// The same fields field-corpus-metrics.mjs reads from the parser, read here
// from a stored offer. A card the search did not store is not an offer.
function storedFields(offer) {
  if (!offer) {
    return { offer: false };
  }
  const inherited = offer.locationProvenance?.method === 'source-inherited';
  return {
    offer: true,
    price: offer.price ?? undefined,
    period: offer.price?.period ?? undefined,
    availability:
      offer.attributes?.availability === 'unavailable'
        ? 'unavailable'
        : undefined,
    location: (!inherited && offer.location) || undefined,
    rooms: offer.attributes?.bedrooms ?? undefined,
  };
}

async function searchAndReload({ application, directory }) {
  const { offers, report } = await application.service.searchWithReport({
    query: QUERY,
    refresh: true,
  });
  const stored = await new LinksStore({ directory }).listOffers();
  return {
    outcomes: Object.fromEntries(
      report.outcomes.map(({ sourceId, status }) => [sourceId, status])
    ),
    returned: offers.length,
    stored,
  };
}

function summary(metrics) {
  return {
    ...metrics,
    misses: metrics.misses.length,
  };
}

export async function auditReplay({ corpus, directory }) {
  const cases = webCases(corpus);
  const application = createApplication({
    browserRuntime: replayRuntime(cases),
    directory,
    environment: { BROWSER_MAX_INTERVAL_MS: '1', BROWSER_MIN_INTERVAL_MS: '1' },
    rateProvider: { getRates: () => Promise.resolve(corpus.rates) },
  });
  application.registry.list = () => Promise.resolve(replaySources(cases));
  const search = await searchAndReload({ application, directory });
  const byUrl = new Map(search.stored.map((offer) => [offer.url, offer]));
  const metrics = await fieldMetrics(
    { ...corpus, cases },
    { predict: (testCase) => storedFields(byUrl.get(cardUrl(testCase))) }
  );
  return { ...search, metrics, stored: search.stored.length };
}

// `browserRuntime`, `rateProvider` and `sources` replace the real browser,
// exchange rates and default web sources, so tests can run it offline.
export async function auditLive({
  browserRuntime,
  corpus,
  directory,
  environment,
  rateProvider,
  sources,
}) {
  const application = createApplication({
    browserRuntime,
    directory,
    environment,
    rateProvider,
  });
  if (sources) {
    application.registry.list = () => Promise.resolve(sources);
  }
  const search = await searchAndReload({ application, directory });
  const byText = new Map(
    search.stored.map((offer) => [
      anonymize(offer.raw?.text || '').trim(),
      offer,
    ])
  );
  const matched = webCases(corpus).filter(({ input }) =>
    byText.has(input.text)
  );
  const metrics = await fieldMetrics(
    { ...corpus, cases: matched },
    { predict: (testCase) => storedFields(byText.get(testCase.input.text)) }
  );
  return {
    ...search,
    matchedReviewedCards: matched.length,
    metrics,
    stored: search.stored.length,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const live = process.argv.includes('--live');
  const directory = await mkdtemp(join(tmpdir(), 'vac-search-audit-'));
  try {
    const corpus = await loadCorpus();
    const result = live
      ? await auditLive({ corpus, directory, environment: process.env })
      : await auditReplay({ corpus, directory });
    const misses = process.argv.includes('--misses');
    console.log(
      JSON.stringify(
        {
          ...result,
          metrics: misses ? result.metrics : summary(result.metrics),
          mode: live ? 'live' : 'replay',
        },
        null,
        2
      )
    );
    process.exitCode = result.metrics.pass ? 0 : 1;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
