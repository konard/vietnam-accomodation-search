#!/usr/bin/env node

/**
 * Manual local-only native mtcute capability E2E (#56). Real providers run
 * behind the production TelegramCapabilityRouter in user-only, healthy
 * combined, degraded combined, bot-unsupported fallback, and ambiguous-send
 * scenarios. An independent MTProto driver account observes every delivery
 * and deletes every test message. The report holds transports, error
 * categories, and counts only.
 */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { Api, InputFile } from 'grammy';

import {
  BotApiTelegramProvider,
  classifyTelegramError,
  LinksStore,
  MtcuteTelegramProvider,
  TelegramAvailabilityService,
  TelegramCapabilityRouter,
} from '../src/index.js';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';
import {
  botCredentials,
  connectDriver,
  driverDeadline,
  environmentFile,
  formatFailureTranscript,
  getBotIdentity,
  messageId,
  messageText,
  userCredentials,
  withDeadline,
} from './telegram-bot-conversation-e2e.mjs';
import {
  evaluateCapabilityScenario,
  lostResponseError,
  parseCapabilityArguments,
  publicUsername,
  recordingProvider,
  requireNativeSessionFormat,
  SCENARIO_STEPS,
  summarizeCalls,
} from './telegram-capability-e2e-lib.mjs';
import {
  assertPinnedIdentity,
  requireIdentityPins,
} from './telegram-e2e-identities.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAILURE_LOG_DIRECTORY = join(ROOT, 'experiments', 'logs');
const DELIVERED_STEPS = [
  'availability',
  'liveUpdates',
  'media',
  'restartIdempotency',
  'send',
];
const silent = { error() {}, info() {}, warn() {} };

function usage() {
  return [
    'Usage: TELEGRAM_CAPABILITY_E2E=1 node experiments/telegram-capability-e2e.mjs \\',
    '  --bot-env PATH --user-env PATH --driver-env PATH --source @public_channel \\',
    '  [--scenarios user-only,combined,degraded,fallback,ambiguous-send] \\',
    '  [--timeout-ms 60000]',
    '',
    '--user-env holds the native mtcute runtime session',
    '(TELEGRAM_USER_SESSION_FORMAT=mtcute/session-string-v1) and',
    'TELEGRAM_EXPECTED_USER_ID. --driver-env is the separate observer account',
    '(TELEGRAM_E2E_EXPECTED_USER_ID); it needs a public username and must have',
    'started the bot. --source is a public channel with recent media.',
  ].join('\n');
}

async function readConversation(context, peer) {
  return [
    ...(await withDeadline(
      () => context.driver.client.getMessages(peer, { limit: 100 }),
      driverDeadline(context.timeoutMs),
      'driver history read'
    )),
  ];
}

async function runMessages(context, run) {
  const messages = [];
  for (const peer of [context.botPeer, context.runtimePeer]) {
    for (const message of await readConversation(context, peer)) {
      if (messageText(message).includes(`cap-${run}-`)) {
        messages.push({ message, peer });
      }
    }
  }
  return messages;
}

async function deleteRunMessages(context, found) {
  const byPeer = new Map();
  for (const { message, peer } of found) {
    byPeer.set(peer, [...(byPeer.get(peer) || []), messageId(message)]);
  }
  for (const [peer, identifiers] of byPeer) {
    await withDeadline(
      () =>
        context.driver.client.deleteMessages(peer, identifiers, {
          revoke: true,
        }),
      driverDeadline(context.timeoutMs),
      'test-message cleanup'
    ).catch(() => {});
  }
}

async function persistTranscript(found, name, failures) {
  if (!found.length) {
    return undefined;
  }
  await mkdir(FAILURE_LOG_DIRECTORY, { mode: 0o700, recursive: true });
  await chmod(FAILURE_LOG_DIRECTORY, 0o700);
  const path = join(
    FAILURE_LOG_DIRECTORY,
    `telegram-capability-${name}-${Date.now()}.failure.log`
  );
  await writeFile(
    path,
    formatFailureTranscript(
      found.map(({ message }) => message),
      failures.join('; ')
    ),
    { flag: 'wx', mode: 0o600 }
  );
  return path;
}

function createRouter(name, context, { calls, clients, storeDirectory }) {
  const user = new MtcuteTelegramProvider({
    apiHash: context.runtime.apiHash,
    apiId: context.runtime.apiId,
    expectedUserId: context.pins['runtime user'],
    logger: silent,
    // A degraded combined runtime has no usable user session.
    session: name === 'degraded' ? undefined : context.runtime.session,
    sessionFormat: context.sessionFormat,
  });
  const recordedUser = recordingProvider(user, { calls });
  clients.user.push(recordedUser);
  let recordedBot;
  if (name !== 'user-only') {
    recordedBot = recordingProvider(
      new BotApiTelegramProvider(context.botApi, { token: context.token }),
      {
        afterSend: name === 'ambiguous-send' ? lostResponseError : undefined,
        calls,
      }
    );
    clients.bot.push(recordedBot);
  }
  const router = new TelegramCapabilityRouter({
    bot: recordedBot,
    logger: silent,
    mode: name === 'user-only' ? 'user-only' : 'both',
    retryOptions: { maxAttempts: 2, maxElapsedMs: context.timeoutMs },
    store: new LinksStore({ directory: storeDirectory }),
    user: recordedUser,
  });
  return { router, user };
}

async function waitForUpdate(router, context, marker) {
  let resolveUpdate;
  const received = new Promise((resolve) => {
    resolveUpdate = resolve;
  });
  const subscription = await router.liveUpdates(
    (event) => {
      if (String(event.message?.text || '').includes(marker)) {
        resolveUpdate();
      }
    },
    { sources: [{ id: 'capability-driver', username: context.driverUsername }] }
  );
  try {
    await context.driver.client.sendMessage(context.runtimePeer, {
      message: marker,
    });
    await received;
  } finally {
    subscription.stop();
  }
}

async function readMedia(name, current, context, marker) {
  if (name === 'user-only') {
    await current.router.identity();
    const messages = await current.user.client.getHistory(context.source, {
      limit: 50,
    });
    const fileId = messages.find((message) => message.media?.fileId)?.media
      .fileId;
    if (!fileId) {
      throw new Error('The source has no recent downloadable media.');
    }
    const bytes = await current.router.media(fileId);
    if (!bytes?.length) {
      throw new Error('The media download was empty.');
    }
    return;
  }
  const sent = await context.botApi.sendDocument(
    context.driverId,
    new InputFile(Buffer.from(marker), 'capability-e2e.txt'),
    { caption: marker }
  );
  const bytes = await current.router.media(sent.document.file_id);
  if (Buffer.from(bytes).toString('utf8') !== marker) {
    throw new Error('The downloaded media differs from the sent file.');
  }
}

// eslint-disable-next-line max-lines-per-function -- One scenario owns its steps, observation, and cleanup.
async function runScenario(name, context) {
  const run = randomBytes(5).toString('hex');
  const marker = (step) => `cap-${run}-${step}`;
  const wanted = new Set([
    ...SCENARIO_STEPS[name].pass,
    ...SCENARIO_STEPS[name].fail,
  ]);
  const calls = [];
  const clients = { bot: [], user: [] };
  const steps = [];
  const storeDirectory = await mkdtemp(join(tmpdir(), 'capability-e2e-'));
  const routers = [];
  const build = () => {
    const built = createRouter(name, context, {
      calls,
      clients,
      storeDirectory,
    });
    routers.push(built.router);
    return built;
  };
  let current = build();
  const step = async (stepName, action) => {
    if (!wanted.has(stepName)) {
      return;
    }
    try {
      await withDeadline(action, context.timeoutMs, stepName);
      steps.push({ name: stepName, ok: true });
    } catch (error) {
      steps.push({
        category: classifyTelegramError(error).category,
        name: stepName,
        ok: false,
      });
    }
  };
  const userOnly = name === 'user-only';
  try {
    await step('identity', async () => {
      const identity = await current.router.identity();
      assertPinnedIdentity(
        userOnly ? 'runtime user' : 'bot',
        userOnly ? context.pins['runtime user'] : context.pins.bot,
        identity.id
      );
    });
    await step('resolveEntity', () =>
      current.router.resolveEntity(context.source)
    );
    await step('popularity', async () => {
      const { members } = await current.router.popularity(context.source);
      if (!Number.isInteger(members) && members !== null) {
        throw new Error('The popularity result has no member count.');
      }
    });
    await step('membership', () => current.router.membership(context.source));
    await step('history', async () => {
      let count = 0;
      for await (const message of await current.router.history({
        id: 'capability-source',
        username: context.source,
      })) {
        count += message ? 1 : 0;
        if (count >= 5) {
          break;
        }
      }
      if (!count) {
        throw new Error('The source history is empty.');
      }
    });
    await step('media', () =>
      readMedia(name, current, context, marker('media'))
    );
    await step('liveUpdates', () =>
      waitForUpdate(current.router, context, marker('liveUpdates'))
    );
    await step('send', () =>
      current.router.send(
        // Bot API reaches the driver by numeric ID; only a user client can
        // address the driver's @username.
        userOnly || name === 'fallback'
          ? context.driverUsername
          : context.driverId,
        marker('send')
      )
    );
    await step('availability', () => {
      const offer = {
        contacts: { telegram: [context.driverUsername] },
        id: `capability-${run}`,
        title: marker('availability'),
      };
      return new TelegramAvailabilityService({
        router: current.router,
        store: { listOffers: () => Promise.resolve([offer]) },
      }).check(offer.id);
    });
    await step('restartIdempotency', async () => {
      const key = `capability:${run}`;
      await current.router.send(
        context.driverId,
        marker('restartIdempotency'),
        {
          idempotencyKey: key,
        }
      );
      await current.router.destroy();
      current = build();
      await current.router.send(
        context.driverId,
        marker('restartIdempotency'),
        {
          idempotencyKey: key,
        }
      );
    });
  } finally {
    for (const router of routers) {
      await router.destroy().catch(() => {});
    }
    await rm(storeDirectory, { force: true, recursive: true });
  }

  const found = await runMessages(context, run);
  const deliveries = {};
  for (const { name: stepName, ok } of steps) {
    if (
      DELIVERED_STEPS.includes(stepName) &&
      (ok || name === 'ambiguous-send')
    ) {
      deliveries[stepName] = found.filter(({ message }) =>
        messageText(message).includes(marker(stepName))
      ).length;
    }
  }
  const botCapabilities = new Set(
    Object.keys(clients.bot[0] || {}).filter(
      (key) => typeof clients.bot[0][key] === 'function'
    )
  );
  const count = (list) => ({
    created: list.length,
    destroyed: list.filter((client) => client.destroyed > 0).length,
  });
  const cleanup = {
    clients: { bot: count(clients.bot), user: count(clients.user) },
  };
  const preliminary = evaluateCapabilityScenario({
    botCapabilities,
    calls,
    cleanup,
    deliveries,
    name,
    steps,
  });
  const transcript = preliminary.length
    ? await persistTranscript(found, name, preliminary)
    : undefined;
  await deleteRunMessages(context, found);
  cleanup.leftovers = (await runMessages(context, run)).length;
  const failures = evaluateCapabilityScenario({
    botCapabilities,
    calls,
    cleanup,
    deliveries,
    name,
    steps,
  });
  return {
    calls: summarizeCalls(calls),
    cleanup,
    deliveries,
    failures,
    steps,
    transcript: transcript ? 'experiments/logs (private)' : undefined,
  };
}

async function runtimeIdentity(context) {
  const provider = new MtcuteTelegramProvider({
    apiHash: context.runtime.apiHash,
    apiId: context.runtime.apiId,
    expectedUserId: context.pins['runtime user'],
    logger: silent,
    session: context.runtime.session,
    sessionFormat: context.sessionFormat,
  });
  try {
    return await withDeadline(
      () => provider.identity(),
      context.timeoutMs,
      'runtime-user identity check'
    );
  } finally {
    await provider.destroy();
  }
}

export async function runCapabilityE2E(options, environment = process.env) {
  assertManualLocalRun(environment);
  if (environment.TELEGRAM_CAPABILITY_E2E !== '1') {
    throw new Error('Set TELEGRAM_CAPABILITY_E2E=1 to confirm this live run.');
  }
  const [botEnvironment, runtimeEnvironment, driverEnvironment] =
    await Promise.all(
      [options.botEnv, options.userEnv, options.driverEnv].map(environmentFile)
    );
  const pins = requireIdentityPins({
    bot: botEnvironment,
    driver: driverEnvironment,
    mode: 'both',
    runtimeUser: runtimeEnvironment,
  });
  const sessionFormat = requireNativeSessionFormat(runtimeEnvironment);
  const { token } = await botCredentials(botEnvironment, pins.bot);
  const bot = await getBotIdentity(token, pins.bot);
  const runtime = await userCredentials(
    runtimeEnvironment,
    pins['runtime user']
  );
  const context = {
    botApi: new Api(token),
    botPeer: bot.username,
    pins,
    runtime,
    sessionFormat,
    source: options.source,
    timeoutMs: options.timeoutMs,
    token,
  };
  const runtimeUser = await runtimeIdentity(context);
  context.driver = await connectDriver(
    await userCredentials(driverEnvironment, pins.driver),
    options.timeoutMs
  );
  const report = {
    identityPins: { bot: 'matched', driver: 'matched', runtimeUser: 'matched' },
    scenarios: {},
  };
  try {
    const driver = await context.driver.client.getMe();
    context.driverId = context.driver.id;
    context.driverUsername = publicUsername(driver.username);
    if (!context.driverUsername) {
      throw new Error('The driver account needs a public username.');
    }
    if (runtimeUser.username) {
      context.runtimePeer = runtimeUser.username;
    } else {
      await context.driver.client.getDialogs({ limit: 100 });
      context.runtimePeer = BigInt(String(runtimeUser.id));
    }
    for (const name of options.scenarios) {
      report.scenarios[name] = await runScenario(name, context);
    }
  } finally {
    await context.driver.client.disconnect().catch(() => {});
  }
  report.ok = Object.values(report.scenarios).every(
    (scenario) => !scenario.failures.length
  );
  return report;
}

async function main() {
  const options = parseCapabilityArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await runCapabilityE2E(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`telegram-capability-e2e: ${error.message}\n`);
    process.exitCode = 1;
  });
}
