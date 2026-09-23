#!/usr/bin/env node

/**
 * Manual, local-only durability probe. Run `seed` in one container and
 * `verify` in a new container with the same host directory mounted at /data.
 * The explicit confirmation keeps synthetic records out of production data.
 */

import { access } from 'node:fs/promises';

import {
  LinksStore,
  MediaCache,
  PresetService,
  UpdateDeduplicator,
} from '../src/index.js';

const CONFIRMATION = 'isolated-directory';
const USER_ID = 'persistence-audit-user';
const UPDATE_ID = 2_147_483_000;

function configuration() {
  if (process.env.CI) {
    throw new Error('The persistent-data audit must not run in CI.');
  }
  if (process.env.PERSISTENCE_AUDIT_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set PERSISTENCE_AUDIT_CONFIRM=${CONFIRMATION} for an isolated data directory.`
    );
  }
  const directory = process.env.DATA_DIRECTORY;
  const runId = process.env.PERSISTENCE_AUDIT_ID;
  if (!directory || !runId || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(runId)) {
    throw new Error(
      'DATA_DIRECTORY and a simple PERSISTENCE_AUDIT_ID are required.'
    );
  }
  return { directory, runId };
}

function identifiers(runId) {
  return {
    offerId: `persistence-audit-offer-${runId}`,
    presetName: `audit-${runId}`,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function seed({ directory, runId }) {
  const { offerId, presetName } = identifiers(runId);
  const store = new LinksStore({ binaryMirror: true, directory });
  const mediaCache = new MediaCache({
    directory,
    fetchImpl: () =>
      Promise.resolve(new globalThis.Response(Uint8Array.from([1, 2, 3, 4]))),
  });
  const [offer] = await mediaCache.cacheOffers([
    {
      collectedAt: new Date().toISOString(),
      id: offerId,
      photos: [`https://audit.invalid/${runId}.jpg`],
      priceVnd: 1,
      sourceId: 'persistence-audit',
      title: 'Synthetic persistence audit record',
    },
  ]);
  await store.saveOffers([offer]);

  const presets = new PresetService({ store });
  await presets.save(USER_ID, presetName, {
    maxTotalVnd: 1,
    query: 'Nha Trang',
  });
  await presets.use(USER_ID, presetName);
  await presets.subscribe(USER_ID, presetName);
  await presets.markDelivered(USER_ID, [offer]);

  const deduplicator = new UpdateDeduplicator({ store });
  assert(
    await deduplicator.accept({ update_id: UPDATE_ID }),
    'The isolated directory already contains the audit update.'
  );
  return { cachedMedia: offer.cachedPhotos.length, offerId, presetName };
}

async function verify({ directory, runId }) {
  const { offerId, presetName } = identifiers(runId);
  const store = new LinksStore({ binaryMirror: true, directory });
  const offer = (await store.listOffers()).find(({ id }) => id === offerId);
  assert(offer, 'The cached offer did not survive container replacement.');
  assert(
    offer.cachedPhotos?.length === 1,
    'The cached media relationship did not survive container replacement.'
  );
  await access(offer.cachedPhotos[0].path);

  const presets = new PresetService({ store });
  assert(
    (await presets.activeName(USER_ID)) === presetName,
    'The active preset did not survive container replacement.'
  );
  assert(
    (await presets.subscription(USER_ID))?.presetName === presetName,
    'The subscription did not survive container replacement.'
  );
  assert(
    (await presets.unseen(USER_ID, [offer])).length === 0,
    'The delivered-offer cursor did not survive container replacement.'
  );

  const deduplicator = new UpdateDeduplicator({ store });
  assert(
    !(await deduplicator.accept({ update_id: UPDATE_ID })),
    'The Telegram update cursor did not survive container replacement.'
  );
  return {
    binaryMirror: true,
    cachedMedia: offer.cachedPhotos.length,
    deliveredCursor: true,
    offerId,
    presetName,
    subscription: true,
    updateCursor: true,
  };
}

const [action] = process.argv.slice(2);
const config = configuration();
const result =
  action === 'seed'
    ? await seed(config)
    : action === 'verify'
      ? await verify(config)
      : (() => {
          throw new Error('Usage: audit-persistent-data.mjs seed|verify');
        })();

process.stdout.write(`${JSON.stringify({ action, ...result }, null, 2)}\n`);
