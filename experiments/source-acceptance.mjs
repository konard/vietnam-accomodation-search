#!/usr/bin/env node
// Manual source-by-source collection and independent-review gate. All listing
// text, account/source identities and review packs remain in private files.
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { createApplication } from '../src/application.js';
import { assembleTelegramAlbums } from '../src/telegram-pipeline.js';
import { quoteBasis } from '../src/value-pricing.js';
import { buildSearchUrl } from '../src/browser-collector.js';
import { stableHash } from '../src/utils.js';
import { durableWrite } from '../src/link-cli-mirror.js';
import { resolveTelegramSecrets } from '../src/telegram-auth.js';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';
import { withQaCleanup } from './qa-cleanup.mjs';
import { acquireQaStorageGuard } from './qa-storage-guard.mjs';
import {
  evaluateSourceAcceptance,
  findMaterialOffer,
  nativeParseComplete,
  reviewTemplate,
} from './source-acceptance-lib.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) =>
  durableWrite(path, `${JSON.stringify(value, null, 2)}\n`);

// eslint-disable-next-line complexity -- Preserve independent unknown values for every reviewed field.
function prediction(offer) {
  return {
    offer: Boolean(offer),
    bedrooms: offer?.attributes?.bedrooms ?? null,
    rooms: offer?.attributes?.rooms ?? null,
    beds: offer?.attributes?.beds ?? null,
    quoteBasis: offer
      ? offer.price?.basis ||
        offer.priceBasis ||
        quoteBasis(offer.raw?.text || offer.title)
      : null,
    period: offer?.price?.period ?? null,
  };
}

// eslint-disable-next-line complexity -- Native and browser evidence retain their independent completion flags.
async function collectObservation(
  application,
  source,
  credentials,
  scope,
  signal
) {
  let outcome;
  let materials = [];
  let offers = [];
  const observation = {
    sourceId: source.id,
    type: source.type,
    provenance: 'live',
    observedAt: new Date().toISOString(),
    fetchComplete: false,
    parseComplete: false,
    paginationComplete: false,
  };
  if (source.capability !== 'supported') {
    return { ...observation, materials, exclusion: source.capability };
  }
  if (source.type === 'telegram') {
    if (!credentials.session || !credentials.apiId || !credentials.apiHash) {
      return {
        ...observation,
        materials,
        exclusion: 'native-session-unavailable',
      };
    }
    const ingestion = application.createTelegramIngestionService(credentials);
    scope.defer('source native session', () => ingestion.destroy());
    try {
      await ingestion.start([source], { signal });
    } finally {
      await ingestion.destroy();
    }
    const checkpoint = (
      await application.store.loadRecords('telegram-ingestion-checkpoints')
    ).find(({ id }) => id === source.id);
    observation.historyComplete = checkpoint?.historyComplete === true;
    const reviews = (
      await application.store.loadRecords('telegram-reviews')
    ).filter(({ sourceId }) => sourceId === source.id);
    observation.parseComplete = nativeParseComplete(checkpoint, reviews);
    observation.mediaCoverage = (
      await application.store.loadRecords('telegram-media-checkpoints')
    ).find(({ id }) => id === source.id);
    observation.retentionLoss = Boolean(checkpoint?.retentionLoss);
    observation.fetchComplete = observation.historyComplete;
    observation.paginationComplete = observation.historyComplete;
    const events = (
      await application.store.loadRecords('telegram-events')
    ).filter(({ sourceId }) => sourceId === source.id);
    const latest = new Map();
    for (const event of events) {
      for (const id of event.messageIds || []) {
        latest.delete(String(id));
      }
      if (event.message) {
        latest.set(String(event.message.id), event.message);
      }
    }
    materials = assembleTelegramAlbums([...latest.values()]);
    offers = await application.store.listOffers();
  } else {
    const report = await application.collector.collectWithReport([source], '', {
      signal,
    });
    outcome = report.outcomes[0];
    offers = report.offers;
    const requestedUrl = buildSearchUrl(source, '');
    const checkpoint =
      await application.collector.webProgress.load(requestedUrl);
    // A completed checkpoint is deliberately refreshed by load(); retain its
    // raw rows from the durable record for review instead.
    const stored =
      (await application.store.loadRecords('web-pagination-checkpoints')).find(
        ({ firstUrl }) => firstUrl === requestedUrl
      ) || checkpoint;
    materials = stored.rows || [];
    observation.fetchComplete = ['offers', 'empty', 'partial'].includes(
      outcome?.status
    );
    observation.paginationComplete = stored.complete === true;
    observation.parseComplete = outcome?.parseComplete === true;
    observation.retentionLoss = stored.retentionLoss === true;
    if (!observation.fetchComplete) {
      observation.exclusion = outcome?.category || 'fetch-failed';
    }
  }
  observation.observedAt = new Date().toISOString();
  const reviewPack = materials.map((material, index) => ({
    id: material.id || material.url || String(index),
    digest: stableHash(JSON.stringify(material)),
    photoOnly: Boolean(material.mediaIds?.length && !material.text?.trim()),
    material,
  }));
  observation.materials = reviewPack.map(({ material, ...metadata }) => {
    const offer = findMaterialOffer(offers, material, source);
    return { ...metadata, prediction: prediction(offer) };
  });
  return { ...observation, reviewPack };
}

// eslint-disable-next-line complexity, max-lines-per-function -- The finite operator command dispatches collect, independent review and inventory status.
async function main(scope, signal) {
  assertManualLocalRun(process.env);
  const output = resolve(option('--output') || '.deploy/source-acceptance');
  await mkdir(output, { mode: 0o700, recursive: true });
  if (args[0] === 'review') {
    const observation = await load(option('--observation'));
    const review = await load(option('--labels'));
    const result = evaluateSourceAcceptance(observation, review);
    await save(
      join(output, `${stableHash(observation.sourceId)}-acceptance.json`),
      result
    );
    await save(
      join(output, `${stableHash(observation.sourceId)}-reviewed-labels.json`),
      review
    );
    console.log(JSON.stringify(result));
    if (!result.pass) {
      process.exitCode = 1;
    }
    return;
  }
  if (
    !['collect', 'status'].includes(args[0]) ||
    (args[0] === 'collect' && !option('--source') && !args.includes('--all'))
  ) {
    throw new Error(
      'Choose collect --source SOURCE or collect --all, or review --observation FILE --labels FILE.'
    );
  }
  const envFile = option('--env-file');
  const environment = {
    ...process.env,
    ...(envFile ? parseEnv(await readFile(envFile, 'utf8')) : {}),
  };
  const secretEnvironment = Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      envFile && key.endsWith('_FILE')
        ? resolve(dirname(resolve(envFile)), value)
        : value,
    ])
  );
  const credentials = await resolveTelegramSecrets(secretEnvironment);
  const application = createApplication({
    environment,
    telegramCredentials: credentials,
    logger: { debug() {}, warn() {}, error() {} },
  });
  const inventory = await application.registry.inventory();
  if (args[0] === 'status') {
    const rows = [];
    for (const source of inventory) {
      const prefix = join(output, stableHash(source.id));
      const observation = await load(`${prefix}-observation.json`).catch(
        (error) => {
          if (error.code === 'ENOENT') {
            return undefined;
          }
          throw error;
        }
      );
      const review = await load(`${prefix}-reviewed-labels.json`).catch(
        (error) => {
          if (error.code === 'ENOENT') {
            return undefined;
          }
          throw error;
        }
      );
      rows.push({
        sourceId: source.id,
        capability: source.capability,
        ...(observation
          ? evaluateSourceAcceptance(observation, review)
          : {
              pass: false,
              state: 'incomplete',
              reasons: ['source-not-observed'],
            }),
      });
    }
    await save(join(output, 'inventory-acceptance.json'), rows);
    const accepted = rows.filter(({ pass }) => pass).length;
    console.log(
      JSON.stringify({
        inventory: rows.length,
        accepted,
        incomplete: rows.length - accepted,
        excluded: rows.filter(({ capability }) => capability !== 'supported')
          .length,
        globalOptimality: 'unverified',
      })
    );
    if (accepted !== rows.length) {
      process.exitCode = 1;
    }
    return;
  }
  const sources = option('--source')
    ? inventory.filter(({ id }) => id === option('--source'))
    : inventory;
  if (!sources.length) {
    throw new Error('No matching source.');
  }
  await mkdir(application.store.directory, { mode: 0o700, recursive: true });
  const guard = await acquireQaStorageGuard(scope, {
    paths: [application.store.directory, output],
    signal,
  });
  signal = guard.signal;
  let collected = 0;
  let excluded = 0;
  for (const source of sources) {
    await guard.check();
    let observation;
    try {
      observation = await collectObservation(
        application,
        source,
        credentials,
        scope,
        signal
      );
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      observation = {
        sourceId: source.id,
        type: source.type,
        provenance: 'live',
        observedAt: new Date().toISOString(),
        materials: [],
        exclusion: 'collection-failed',
        fetchComplete: false,
        parseComplete: false,
        paginationComplete: false,
      };
    }
    const { reviewPack = [], ...safeObservation } = observation;
    const prefix = join(output, stableHash(source.id));
    await save(`${prefix}-observation.json`, safeObservation);
    await save(`${prefix}-review-pack.json`, reviewPack);
    await save(
      `${prefix}-labels-template.json`,
      reviewTemplate(safeObservation)
    );
    await save(
      `${prefix}-acceptance.json`,
      evaluateSourceAcceptance(safeObservation)
    );
    collected += 1;
    excluded += Boolean(observation.exclusion);
    console.log(
      JSON.stringify({
        collected,
        excluded,
        accepted: 0,
        reviewPending: true,
        globalOptimality: 'unverified',
      })
    );
  }
  await guard.check();
}

await withQaCleanup(main).catch(() => {
  console.error(
    'Source acceptance failed. Inspect the private evidence locally.'
  );
  process.exitCode = 1;
});
