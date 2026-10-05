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
    // COHORT_DEBUG=1 prints collector debug messages, such as failed saves.
    logger: process.env.COHORT_DEBUG
      ? { debug: (...parts) => console.error('[debug]', ...parts) }
      : undefined,
  });
  application.registry.list = () => Promise.resolve(sources);
  // Keeps every collected offer, before the store merges duplicates.
  const collectedOffers = [];
  const { collector } = application;
  const collectWithReport = collector.collectWithReport.bind(collector);
  collector.collectWithReport = async (...parts) => {
    const result = await collectWithReport(...parts);
    collectedOffers.push(...result.offers);
    return result;
  };
  const startedAt = new Date().toISOString();
  const { report } = await application.service.searchWithReport({
    query: 'Nha Trang',
    refresh: true,
  });
  const stored = await new LinksStore({ directory }).listOffers();
  const bySource = Map.groupBy(stored, ({ sourceId }) => sourceId);
  const outcomes = report.outcomes.map(
    ({ category, durationMs, message, offers, sourceId, status }) => ({
      category,
      collectedOffers: offers,
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
  const collected = Object.fromEntries(
    [...Map.groupBy(collectedOffers, ({ sourceId }) => sourceId)].map(
      ([sourceId, offers]) => [
        sourceId,
        offers.map((offer) => ({
          attributes: offer.attributes,
          id: offer.id,
          priceVnd: offer.priceVnd,
          text: anonymize(offer.raw?.text || '').slice(0, 300),
          url: offer.url,
        })),
      ]
    )
  );
  await writeFile(
    samplesFile,
    `${JSON.stringify({ collected, stored: samples }, null, 2)}\n`
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}
