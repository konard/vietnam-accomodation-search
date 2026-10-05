#!/usr/bin/env node
// Live outcome of every enabled default web source through the product
// collector, without the registry's top-20 cut.
//
//   BROWSER_NO_SANDBOX=1 COHORT_SOURCES=homedy,yourhome \
//     node experiments/issue-96-source-cohort.mjs \
//     [summary.json] [/tmp/cohort-samples.json]
//
// The summary holds per-source status, failure category, and stored offer
// count. The samples file holds up to five anonymised stored offers per
// source for review and stays outside the repository.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_WEB_SOURCES,
  LinksStore,
  createApplication,
} from '../src/index.js';
import { anonymize } from './live-corpus-anonymize.mjs';

const [summaryFile, samplesFile = '/tmp/cohort-samples.json'] =
  process.argv.slice(2);
const only = new Set(
  (process.env.COHORT_SOURCES || '').split(',').filter(Boolean)
);
const sources = DEFAULT_WEB_SOURCES.filter(
  ({ enabled, id }) => enabled !== false && (!only.size || only.has(id))
);
const directory = await mkdtemp(join(tmpdir(), 'vac-cohort-'));
try {
  const application = createApplication({
    directory,
    environment: { ...process.env, SEARCH_BUDGET_MS: '900000' },
  });
  application.registry.list = () => Promise.resolve(sources);
  const startedAt = new Date().toISOString();
  const { report } = await application.service.searchWithReport({
    query: 'Nha Trang',
    refresh: true,
  });
  const stored = await new LinksStore({ directory }).listOffers();
  const bySource = Map.groupBy(stored, ({ sourceId }) => sourceId);
  const outcomes = report.outcomes.map(
    ({ category, durationMs, message, sourceId, status }) => ({
      category,
      durationMs,
      message,
      sourceId,
      status,
      storedOffers: bySource.get(sourceId)?.length || 0,
    })
  );
  const summary = { query: 'Nha Trang', startedAt, outcomes };
  const output = JSON.stringify(summary, null, 2);
  if (summaryFile) {
    await writeFile(summaryFile, `${output}\n`);
  }
  console.log(output);
  const samples = Object.fromEntries(
    [...bySource].map(([sourceId, offers]) => [
      sourceId,
      offers.slice(0, 5).map((offer) => ({
        attributes: offer.attributes,
        location: offer.location,
        price: offer.price,
        priceVnd: offer.priceVnd,
        text: anonymize(offer.raw?.text || ''),
      })),
    ])
  );
  await writeFile(samplesFile, `${JSON.stringify(samples, null, 2)}\n`);
} finally {
  await rm(directory, { force: true, recursive: true });
}
