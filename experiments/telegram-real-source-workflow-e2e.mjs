#!/usr/bin/env node

// Manual real-source acceptance. No synthetic offer cache is seeded. The only
// writes to Telegram are marked notifications to the credential owner's chat.
// Private bodies/identities stay in the explicitly supplied local directory.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { writeStringSession } from '@mtcute/core/utils.js';
import {
  createApplication,
  LinkCliMirror,
  LinksStore,
  MtcuteTelegramProvider,
} from '../src/index.js';
import { runClink } from '../src/link-cli-mirror.js';
import { createMtcuteClient } from '../src/telegram-user.js';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';

import { withQaCleanup } from './qa-cleanup.mjs';
import { QaOwnedMessages } from './qa-owned-messages.mjs';

function options(values) {
  const names = new Map([
    ['--bot-env', 'botEnv'],
    ['--user-env', 'userEnv'],
    ['--cohort-directory', 'cohortDirectory'],
    ['--source-ordinal', 'sourceOrdinal'],
    ['--data-directory', 'dataDirectory'],
    ['--converter-module', 'converterModule'],
    ['--output', 'output'],
    ['--require-ocr', 'requireOcr'],
    ['--keep-data', 'keepData'],
  ]);
  const result = { requireOcr: '1', keepData: '0' };
  for (let index = 0; index < values.length; index += 2) {
    const name = names.get(values[index]);
    if (!name || !values[index + 1]) {
      throw new TypeError('Unknown or incomplete manual workflow option.');
    }
    result[name] = values[index + 1];
  }
  assert([...names.values()].every((name) => result[name]));
  assert(['0', '1'].includes(result.requireOcr));
  result.requireOcr = result.requireOcr === '1';
  assert(['0', '1'].includes(result.keepData));
  result.keepData = result.keepData === '1';
  result.sourceOrdinal = Number(result.sourceOrdinal);
  assert(Number.isInteger(result.sourceOrdinal) && result.sourceOrdinal > 0);
  result.dataDirectory = resolve(result.dataDirectory);
  assert(result.dataDirectory.includes('e2e'));
  assert(result.output.endsWith('.json'));
  return result;
}

async function credentials(paths) {
  const user = parseEnv(await readFile(paths.userEnv, 'utf8'));
  const bot = parseEnv(await readFile(paths.botEnv, 'utf8'));
  const converter = await import(
    pathToFileURL(resolve(paths.converterModule)).href
  );
  assert(
    user.TELEGRAM_EXPECTED_USER_ID && bot.TELEGRAM_EXPECTED_BOT_ID,
    'Explicit runtime and bot identity pins required.'
  );
  assert.equal(
    bot.TELEGRAM_BOT_TOKEN.split(':')[0],
    bot.TELEGRAM_EXPECTED_BOT_ID
  );
  return {
    token: bot.TELEGRAM_BOT_TOKEN,
    user: {
      apiId: user.TELEGRAM_API_ID || user.TELEGRAM_USER_BOT_API_ID,
      apiHash: user.TELEGRAM_API_HASH || user.TELEGRAM_USER_BOT_API_HASH,
      session: writeStringSession(
        converter.convertFromGramjsSession(user.TELEGRAM_USER_SESSION)
      ),
      sessionFormat: 'mtcute/session-string-v1',
      expectedUserId: user.TELEGRAM_EXPECTED_USER_ID,
    },
  };
}

function guardedStore(directory, result, started) {
  return new LinksStore({
    directory,
    binaryMirror: true,
    mirror: new LinkCliMirror({
      run: async (...arguments_) => {
        const space = await statfs(directory);
        assert(space.bavail * space.bsize >= 2 * 1024 ** 3, 'QA_DISK_FLOOR');
        assert(performance.now() - started < 60 * 60_000, 'QA_TIME_BUDGET');
        await runClink(...arguments_);
        result.imports += 1;
      },
    }),
  });
}

function observeIngestion(ingestion, result, observed) {
  const history = ingestion.provider.history.bind(ingestion.provider);
  ingestion.provider.history = async (...arguments_) => {
    const iterator = await history(...arguments_);
    return (async function* () {
      for await (const message of iterator) {
        observed.set(String(message.id), message);
        result.messages += 1;
        yield message;
      }
    })();
  };
  const ocr = ingestion.ocr;
  ingestion.ocr = async (...arguments_) => {
    result.ocrCalls += 1;
    try {
      const extracted = await ocr(...arguments_);
      result.ocrCompleted += 1;
      return extracted;
    } catch (error) {
      result.ocrFailures += 1;
      throw error;
    }
  };
}

async function observedClient(credentials, nativeMedia, result) {
  const client = await createMtcuteClient(credentials);
  const history = client.iterHistory.bind(client);
  client.iterHistory = (...arguments_) =>
    (async function* () {
      for await (const message of history(...arguments_)) {
        const identity = message.media?.id ?? message.media?.raw?.id;
        if (identity !== undefined) {
          nativeMedia.set(String(message.id), String(identity));
          result.nativeMediaMessages += 1;
        }
        yield message;
      }
    })();
  return client;
}

function verifyMedia(observed, nativeMedia, result) {
  const media = [...observed.entries()].filter(([id]) => nativeMedia.has(id));
  result.retainedNativeMedia = media.length;
  result.missingMediaIdentities = media.filter(
    ([id, message]) => message.media?.id !== nativeMedia.get(id)
  ).length;
  assert.equal(result.missingMediaIdentities, 0, 'NATIVE_MEDIA_IDENTITY_LOSS');
  result.nativeMediaPreserved = true;
}

async function verifyReadback(store, source, observed, result) {
  const fresh = new LinksStore({
    directory: store.directory,
    binaryMirror: true,
  });
  const snapshot = {};
  for (const kind of [
    'telegram-events',
    'domain-records',
    'telegram-reviews',
    'telegram-ingestion-checkpoints',
    'traces',
    'offers',
  ]) {
    const expected = await store.loadRecords(kind);
    snapshot[kind] = await fresh.loadRecords(kind);
    assert.deepEqual(snapshot[kind], expected);
  }
  const events = snapshot['telegram-events'].filter(
    (event) => event.sourceId === source.id && event.type === 'backfill'
  );
  assert.equal(events.length, observed.size);
  for (const event of events) {
    assert.deepEqual(
      event.message,
      JSON.parse(JSON.stringify(observed.get(String(event.message.id))))
    );
  }
  const raw = new Set(
    snapshot['domain-records']
      .filter((record) => record.type === 'raw-material')
      .map((record) => record.id)
  );
  assert(
    [...observed.keys()].every((id) =>
      raw.has(`raw-material:${source.id}:${id}`)
    )
  );
  result.records = snapshot['domain-records'].length;
  result.storedOffers = snapshot.offers.length;
  result.reviewReasons = snapshot['telegram-reviews'].reduce((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {});
  result.checkpoint = snapshot['telegram-ingestion-checkpoints'].map(
    (item) => ({
      complete: item.complete,
      state: item.state,
      messages: item.messages,
    })
  );
  result.freshReadback = true;
  result.rawBodiesPreserved = true;
  result.rawGraphCoverage = true;
  const entities = new Set(
    snapshot['domain-records']
      .filter((record) => record.type !== 'semantic-link')
      .map((record) => record.id)
  );
  result.danglingGraphSubjects = snapshot['domain-records'].filter(
    (record) => record.type === 'semantic-link' && !entities.has(record.subject)
  ).length;
  assert.equal(result.danglingGraphSubjects, 0, 'NATIVE_GRAPH_REFERENCE_LOSS');
  return fresh;
}

async function notify(application, token, owner, ledger, result, bots) {
  const bot = await application.createBot(token);
  bots.push(bot);
  const identity = await bot.api.getMe();
  assert.equal(String(identity.id), token.split(':', 1)[0]);
  assert.notEqual(owner, String(identity.id));
  ledger.install(bot.api, owner);
  bot.api.config.use(async (previous, method, payload, signal) => {
    const response = await previous(method, payload, signal);
    if (response.ok && method.startsWith('send')) {
      const messages = Array.isArray(response.result)
        ? response.result
        : [response.result];
      result.notificationPhotoDelivered ||= messages.some(
        (message) => message.photo?.length
      );
    }
    return response;
  });
  const candidate = (await application.store.listOffers()).find(
    (offer) =>
      offer.photos?.length &&
      offer.cachedPhotos?.length &&
      offer.attributes?.reviewRequired !== true
  );
  assert(
    candidate,
    'No eligible native photo offer is available for notification acceptance.'
  );
  await application.presetService.save(owner, 'qa-real-source', {
    query: '',
    refresh: false,
    limit: 1,
    filters: { id: candidate.id },
  });
  await application.presetService.subscribe(owner, 'qa-real-source');
  await bot.subscriptionScheduler.tick();
  assert(ledger.botIds.size > 0, 'No actual notification was sent.');
  assert(
    result.notificationPhotoDelivered,
    'Real notification must include an accepted photo, not only text.'
  );
  assert(
    (await application.presetService.subscription(owner)).lastSuccessfulRunAt
  );
  const shown = await application.store.loadRecords('shown-offers');
  assert(shown.some((item) => item.userId === owner && item.deliveredAt));
  result.notificationDelivered = true;
  const beforeRestart = ledger.botIds.size;
  const restarted = createApplication({
    directory: application.store.directory,
    binaryMirror: true,
  });
  const second = await restarted.createBot(token);
  bots.push(second);
  ledger.install(second.api, owner);
  await second.subscriptionScheduler.tick();
  assert.equal(ledger.botIds.size, beforeRestart);
  result.noDuplicateAfterRestart = true;
  return bot;
}

async function cleanup({ ingestion, observer, peer, ledger, bots, result }) {
  const failures = [];
  const attempt = async (name, action) => {
    try {
      await action();
    } catch {
      failures.push(name);
    }
  };
  for (const bot of bots) {
    await attempt('notification producer', () =>
      bot.subscriptionScheduler.stop()
    );
  }
  await attempt('ingestion producer', async () => {
    await ingestion.destroy();
    result.providerDestroyed = true;
  });
  if (ledger && observer?.client && peer) {
    await attempt('owned messages', async () => {
      const verified = await ledger.cleanup({
        read: async () => {
          const messages = [];
          for await (const message of observer.client.iterHistory(peer, {
            minId: ledger.baseline,
          })) {
            if (Number(message.id) <= ledger.baseline) {
              break;
            }
            messages.push(message);
          }
          return messages;
        },
        remove: (ids) =>
          observer.client.deleteMessagesById(peer, ids, { revoke: true }),
      });
      result.cleanup = verified;
      assert(verified.pass, 'Owned messages survived independent cleanup.');
    });
  }
  if (observer) {
    await attempt('independent observer', () => observer.destroy());
  }
  result.cleanup ||= { pass: failures.length === 0, leftovers: 0 };
  if (failures.length) {
    result.pass = false;
    throw new Error(`QA cleanup failed: ${failures.join(', ')}`);
  }
}

async function run(paths) {
  let result;
  try {
    await withQaCleanup(async (scope, signal) => {
      result = await runOwned(paths, scope, signal);
    });
  } catch (error) {
    if (!result) {
      throw error;
    }
    result.pass = false;
    result.cleanup = { ...result.cleanup, pass: false };
  }
  if (result) {
    await writeFile(paths.output, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(JSON.stringify(result));
  }
  return result;
}

// eslint-disable-next-line max-statements -- Native replay and owner acceptance share one failure-safe resource transaction.
async function runOwned(paths, scope, signal) {
  assertManualLocalRun(process.env);
  assert.equal(process.env.TELEGRAM_REAL_WORKFLOW_E2E, '1');
  const started = performance.now();
  const initial = await statfs(resolve(paths.dataDirectory, '..'));
  assert(initial.bavail * initial.bsize >= 8 * 1024 ** 3, 'QA_DISK_PREFLIGHT');
  await mkdir(paths.dataDirectory, { mode: 0o700 });
  if (!paths.keepData) {
    scope.defer('private QA data', () =>
      result.cleanup?.pass === false
        ? undefined
        : rm(paths.dataDirectory, { recursive: true, force: true })
    );
  }
  const result = {
    mode: 'real-source-native-workflow',
    startedAt: new Date().toISOString(),
    historyDays: 90,
    syntheticCacheUsed: false,
    requireOcr: paths.requireOcr,
    messages: 0,
    ocrCalls: 0,
    ocrCompleted: 0,
    ocrFailures: 0,
    imports: 0,
    nativeMediaMessages: 0,
    pass: false,
  };
  const privateCohort = new LinksStore({ directory: paths.cohortDirectory });
  const cohort = (await privateCohort.loadRecords('audit-cohorts'))[0];
  const entry = cohort.sources[paths.sourceOrdinal - 1];
  assert(entry?.username);
  const source = {
    ...entry,
    id: `telegram:${entry.username}`,
    type: 'telegram',
    public: true,
    enabled: true,
  };
  const secret = await credentials(paths);
  const store = guardedStore(paths.dataDirectory, result, started);
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const nativeMedia = new Map();
  const application = createApplication({
    directory: paths.dataDirectory,
    store,
    logger: silent,
    mtcuteClientFactory: (credentials) =>
      observedClient(credentials, nativeMedia, result),
  });
  const ingestion = application.createTelegramIngestionService(secret.user);
  const observed = new Map();
  observeIngestion(ingestion, result, observed);
  const marker = `qa-real-source-${randomBytes(8).toString('hex')}`;
  const bots = [];
  let observer;
  let peer;
  let ledger;
  scope.defer('real-source resources and conversation', () =>
    cleanup({ ingestion, observer, peer, ledger, bots, result })
  );
  let owner;
  try {
    signal.throwIfAborted();
    result.phase = 'preflight';
    await store.mirror.preflight();
    owner = String((await ingestion.provider.identity()).id);
    assert.equal(owner, String(secret.user.expectedUserId));
    observer = new MtcuteTelegramProvider({ ...secret.user, logger: silent });
    assert.equal(String((await observer.identity()).id), owner);
    peer = await observer.resolveEntity(Number(secret.token.split(':')[0]));
    const latest = await observer.client.getHistory(peer, { limit: 1 });
    ledger = new QaOwnedMessages({
      marker,
      baseline: latest[0]?.id || 0,
      journal: resolve(paths.dataDirectory, 'message-ownership.json'),
    });
    await ledger.save();
    result.phase = 'native-ingestion';
    result.ingestion = await ingestion.start([source], { signal });
    ingestion.subscription.stop();
    await ingestion.pending;
    assert(result.messages > 0);
    result.phase = 'fresh-storage-readback';
    const fresh = await verifyReadback(store, source, observed, result);
    result.phase = 'native-media-preservation';
    verifyMedia(observed, nativeMedia, result);
    if (paths.requireOcr) {
      assert(
        result.ocrCalls > 0 && result.ocrCompleted > 0,
        'Actual native OCR must execute and complete in this acceptance source.'
      );
    }
    assert(result.storedOffers > 0);
    const restored = createApplication({
      directory: paths.dataDirectory,
      store: fresh,
      logger: silent,
    });
    result.phase = 'notification';
    signal.throwIfAborted();
    await notify(restored, secret.token, owner, ledger, result, bots);
    result.phase = 'complete';
    result.pass = true;
  } catch (error) {
    result.error = {
      type: error.constructor.name,
      code: error.code,
      assertion:
        error instanceof assert.AssertionError ? error.message : undefined,
    };
  } finally {
    result.elapsedMs = Math.round(performance.now() - started);
  }
  return result;
}

try {
  const result = await run(options(process.argv.slice(2)));
  process.exitCode = result.pass ? 0 : 1;
} catch (error) {
  console.error(
    JSON.stringify({ type: error.constructor.name, code: error.code })
  );
  process.exitCode = 1;
}
