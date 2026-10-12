#!/usr/bin/env node

/**
 * Manual local-only deploy cutover drill (#57). A real MTProto user sends
 * read-only marker commands to the bot while scripts/deploy.mjs moves an
 * isolated Compose project through every transition. The report holds
 * counts, digests, image IDs, and durations only; deploy output goes to a
 * private log under .deploy/PROJECT/.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { redactTelegramValue } from '../src/index.js';
import { validateDataDirectory } from '../scripts/data-directory.mjs';
import {
  analyzeMarkers,
  compareFingerprints,
  countDuplicateDeliveries,
  countRunningContainers,
  DRILL_TRANSITIONS,
  markerCommand,
  markerSequence,
  parseDrillArguments,
  stateFingerprint,
  summarizePollerSamples,
  transitionExpectation,
  transitionFailures,
  unhealthyComposeFile,
} from './deploy-cutover-drill-lib.mjs';
import { longestObservedOutage } from './measure-deploy-handoff.mjs';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';
import {
  botCredentials,
  connectDriver,
  driverDeadline,
  environmentFile,
  getBotIdentity,
  messageId,
  messageText,
  userCredentials,
  withDeadline,
} from './telegram-bot-conversation-e2e.mjs';
import { requireIdentityPins } from './telegram-e2e-identities.mjs';

import { withQaCleanup, onceQaCleanup } from './qa-cleanup.mjs';
import { acquireDrillStorageGuard } from './qa-cutover-preflight.mjs';
import { QaOwnedMessages, readQaHistory } from './qa-owned-messages.mjs';
import {
  assertQaDriverAccess,
  resolveVerifiedQaBotPeer,
} from './qa-telegram-peer.mjs';
import {
  QaDockerCleanup,
  dockerInventory,
  dockerCommand,
} from './qa-docker-cleanup.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEPLOY = join(ROOT, 'scripts', 'deploy.mjs');
const BASE_COMPOSE = join(ROOT, 'compose.yaml');
const TIMEOUT_MS = 60_000;
const SAMPLE_INTERVAL_MS = 500;

function usage() {
  return [
    'Usage: TELEGRAM_DEPLOY_DRILL=1 node experiments/deploy-cutover-drill.mjs \\',
    '  --bot-env PATH --user-env PATH --project-name NAME-drill \\',
    '  --data-directory PATH/drill [--image IMAGE] [--candidate-image IMAGE] \\',
    '  [--health-port 18080] [--marker-interval-ms 2000] [--settle-ms 20000] \\',
    '  [--allow-shared-token] (requires an empty local container inventory) \\',
    `  [--transitions ${DRILL_TRANSITIONS.join(',')}] [--restore-snapshot]`,
    '',
    'The bot and driver pins must be distinct numeric Telegram IDs. The bot',
    'environment file is the Compose env_file; it must allowlist the driver.',
  ].join('\n');
}

function progress(stage) {
  process.stderr.write(`deploy-drill stage=${stage}\n`);
}

export function assertDrillBoundary(environment = {}) {
  assertManualLocalRun(environment);
  if (environment.TELEGRAM_DEPLOY_DRILL !== '1') {
    throw new Error(
      'Set TELEGRAM_DEPLOY_DRILL=1 to authorize the real deploy cutover drill.'
    );
  }
}

function run(command, args, { env = process.env, log, signal } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let escalation;
    const abort = () => {
      escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const record = (chunk) =>
      log ? appendFile(log, chunk, { mode: 0o600 }) : undefined;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      record(chunk);
    });
    child.stderr.on('data', record);
    let failure;
    child.on('error', (error) => {
      failure = error;
    });
    child.on('close', (code) => {
      clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted || failure) {
        reject(signal?.reason || failure);
      } else {
        resolvePromise({ code, stdout });
      }
    });
  });
}

function composeEnvironment(options) {
  // `down` interpolates the whole file, including the build arguments.
  return {
    ...process.env,
    BUILDX_BUILDER: options.builder,
    BUILD_DATE: 'drill',
    DATA_DIRECTORY_HOST: options.dataDirectory,
    ENV_FILE: options.botEnv,
    HEALTH_PORT: String(options.healthPort),
    NPM_PACKAGE_VERSION: 'drill',
    VCS_REF: 'drill',
  };
}

async function appContainer(options) {
  const { stdout } = await run('docker', [
    'ps',
    '--filter',
    `label=com.docker.compose.project=${options.projectName}`,
    '--filter',
    'label=com.docker.compose.service=app',
    '--filter',
    'label=com.docker.compose.oneoff=False',
    '--format',
    '{{.ID}}',
  ]);
  return stdout;
}

async function runningImage(options) {
  const [container] = (await appContainer(options)).split('\n');
  if (!container) {
    return undefined;
  }
  const { stdout } = await run('docker', [
    'inspect',
    '--format',
    '{{.Image}}',
    container.trim(),
  ]);
  return stdout.trim() || undefined;
}

function deployArguments(options, transition) {
  const common = [
    '--project-name',
    options.projectName,
    '--data-directory',
    options.dataDirectory,
    ...(options.allowSharedToken ? ['--allow-shared-token'] : []),
  ];
  if (transition === 'rollback') {
    return [
      'rollback',
      ...common,
      ...(options.restoreSnapshot ? ['--restore-snapshot'] : []),
    ];
  }
  const image =
    {
      'failed-preflight': `${options.projectName}-missing:preflight-${options.run}`,
      redeploy: options.candidateImage || options.image,
    }[transition] ?? options.image;
  return [
    'deploy',
    ...common,
    '--compose-file',
    transition === 'unhealthy-candidate'
      ? options.unhealthyCompose
      : options.composeFile,
    ...(transition === 'unhealthy-candidate'
      ? ['--recovery-compose-file', options.composeFile]
      : []),
    ...(image ? ['--image', image] : []),
  ];
}

async function mutate(options, transition) {
  const env = composeEnvironment(options);
  if (transition === 'docker-restart') {
    // The operator's privileges restart the daemon; unless-stopped restarts
    // the same container, which must become ready again.
    const restart = await run(
      'sudo',
      ['-n', 'systemctl', 'restart', 'docker'],
      {
        env,
        log: options.log,
        signal: options.signal,
      }
    );
    for (let attempt = 0; attempt < 90 && restart.code === 0; attempt += 1) {
      const ready = await fetch(options.readyUrl)
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) {
        return 0;
      }
      await delay(1_000);
    }
    return restart.code || 1;
  }
  if (transition === 'recreate') {
    const down = await run(
      'docker',
      ['compose', '-f', options.composeFile, '-p', options.projectName, 'down'],
      { env, log: options.log, signal: options.signal }
    );
    if (down.code !== 0) {
      return down.code;
    }
  }
  const deploy = await run(
    process.execPath,
    [DEPLOY, ...deployArguments(options, transition)],
    { env, log: options.log, signal: options.signal }
  );
  return deploy.code;
}

async function sample(options, samples, stop) {
  const started = Date.now();
  while (!stop.done) {
    const [containers, ready] = await Promise.all([
      appContainer(options),
      fetch(options.readyUrl, { signal: AbortSignal.timeout(2_000) })
        .then((response) => response.ok)
        .catch(() => false),
    ]);
    samples.push({
      atMs: Date.now() - started,
      ready,
      running: countRunningContainers(containers),
    });
    await delay(SAMPLE_INTERVAL_MS);
  }
}

async function sendMarkers(state, sent, stop) {
  while (!stop.done && !state.signal.aborted) {
    await state.ledger.save();
    const sequence = state.nextSequence;
    state.nextSequence += 1;
    state.ledger.replyProof.sequences.push(sequence);
    await state.ledger.save();
    const message = await withDeadline(
      () =>
        state.client.sendMessage(state.target, {
          message: markerCommand(state.run, sequence),
        }),
      driverDeadline(TIMEOUT_MS),
      'marker send'
    );
    await state.ledger.record(message);
    sent.push({ date: message.date, sequence });
    await delay(state.markerIntervalMs);
  }
}

function messagesSince(state, minId) {
  return withDeadline(
    () => readQaHistory(state.client, state.target, minId),
    driverDeadline(TIMEOUT_MS),
    'paged conversation history'
  );
}

async function latestId(state) {
  const [latest] = await withDeadline(
    () => state.client.getMessages(state.target, { limit: 1 }),
    driverDeadline(TIMEOUT_MS),
    'conversation history read'
  );
  return messageId(latest);
}

async function command(state, text, expected) {
  const minId = await latestId(state);
  await state.ledger.save();
  const message = await state.client.sendMessage(state.target, {
    message: `${text}\n${state.ledger.marker}`,
  });
  await state.ledger.record(message);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const replies = (await messagesSince(state, minId)).filter(
      (reply) => !reply.out
    );
    if (
      replies.some((reply) =>
        messageText(reply)
          .replace(`${state.ledger.marker}\n`, '')
          .startsWith(expected)
      )
    ) {
      return;
    }
    await delay(1_000);
  }
  throw new Error(`The bot did not answer a drill ${text.split(' ')[0]}.`);
}

async function runTransition(state, options, transition, baseline) {
  progress(`transition=${transition}`);
  const before = await stateFingerprint(options.dataDirectory);
  const imageBefore = await runningImage(options);
  const minId = await latestId(state);
  const stop = { done: false };
  const samples = [];
  const sent = [];
  const background = Promise.allSettled([
    sample(options, samples, stop),
    sendMarkers(state, sent, stop),
  ]);
  const started = Date.now();
  let exitCode;
  let mutationMs;
  let producerFailures;
  try {
    exitCode = await mutate(options, transition);
  } finally {
    mutationMs = Date.now() - started;
    // Keep sending markers while the new poller settles.
    await delay(options.settleMs);
    stop.done = true;
    const settled = await background;
    producerFailures = settled.filter(({ status }) => status === 'rejected');
  }
  if (producerFailures.length) {
    throw new AggregateError(
      producerFailures.map(({ reason }) => reason),
      'QA producers failed.'
    );
  }
  // Let the bot answer the final markers before reading the replies.
  await delay(options.settleMs);
  const replies = (await messagesSince(state, minId)).filter(
    (message) => !message.out
  );
  const markers = analyzeMarkers({
    replies: replies.map((reply) => ({
      date: reply.date,
      text: messageText(reply),
    })),
    run: state.run,
    sent,
  });
  const deliveries = countDuplicateDeliveries(
    replies
      .map(messageText)
      .filter((text) => markerSequence(text, state.run) === undefined)
  );
  const pollers = summarizePollerSamples(samples.map(({ running }) => running));
  const after = await stateFingerprint(options.dataDirectory);
  const imageAfter = await runningImage(options);
  const expectation = transitionExpectation(transition);
  const images = {
    after: imageAfter,
    expected:
      expectation.image === 'first-deploy'
        ? baseline.firstDeployImage
        : imageBefore,
  };
  const comparison =
    transition === 'first-deploy'
      ? undefined
      : compareFingerprints(before, after);
  return {
    binaryFiles: after.binaryFiles,
    comparison,
    dataSchema: { after: after.dataSchema, before: before.dataSchema },
    exitCode,
    failures: transitionFailures({
      comparison,
      deliveries,
      exitCode,
      expectation,
      images,
      markers,
      pollers,
    }),
    image: { after: imageAfter, before: imageBefore },
    markers,
    mediaFiles: after.mediaFiles,
    mutationMs,
    pollers,
    readyOutageMs: longestObservedOutage(samples, 'ready'),
    transition,
  };
}

async function cleanup(state, options) {
  const result = { conversation: false, project: false, state: false };
  if (!state.hasOwnedState) {
    result.state = true;
  } else {
    try {
      await command(state, '/unsubscribe', 'Subscription disabled.');
      await command(state, `/preset delete drill-${state.run}`, 'Deleted');
      result.state = true;
    } catch {
      // Reported below; the message cleanup still runs.
    }
  }
  // Stop the notification producer before taking the final history snapshot
  // and deleting messages. Compose failure must not skip conversation cleanup.
  try {
    const down = await run(
      'docker',
      [
        'compose',
        '-f',
        options.composeFile,
        '-p',
        options.projectName,
        'down',
        '--remove-orphans',
      ],
      { env: composeEnvironment(options), log: options.log }
    );
    result.project = down.code === 0;
  } catch {
    result.project = false;
  }
  if (!result.project) {
    const rescued = await options.owned.cleanup();
    result.project = rescued.pass;
  }
  state.ledger.replyProof.endedAt = Math.floor(Date.now() / 1000);
  await state.ledger.save();
  try {
    const verified = await state.ledger.cleanup({
      read: () => messagesSince(state, state.ledger.baseline),
      remove: (ids) =>
        state.client.deleteMessages(state.target, ids, { revoke: true }),
    });
    result.leftoverMessages = verified.leftovers;
    result.conversation = verified.pass;
  } catch {
    result.conversation = false;
  }
  if (result.project) {
    // The next drill starts with first-deploy on a new data directory, which
    // a kept record would refuse as a data-directory move.
    const record = join(ROOT, '.deploy', options.projectName);
    await rm(join(record, 'state.json'), { force: true });
    await rm(join(record, 'snapshots'), { force: true, recursive: true });
  }
  return result;
}

export function runDeployDrill(options, environment = process.env) {
  return withQaCleanup(
    (scope, signal) => runOwnedDrill(options, environment, scope, signal),
    { cleanupTimeoutMs: 90_000 }
  );
}

// eslint-disable-next-line max-lines-per-function, max-statements -- The drill owns one deployment and teardown transaction across setup and every transition.
async function runOwnedDrill(options, environment, scope, signal) {
  assertDrillBoundary(environment);
  const { guard } = await acquireDrillStorageGuard(options, scope, signal);
  signal = guard.signal;
  const botEnvironment = await environmentFile(options.botEnv);
  const driverEnvironment = await environmentFile(options.userEnv);
  const pins = requireIdentityPins({
    bot: botEnvironment,
    driver: driverEnvironment,
    mode: 'bot-only',
  });
  if (!options.transitions.includes('first-deploy')) {
    throw new Error('The drill starts with first-deploy on a new directory.');
  }
  const bot = await botCredentials(botEnvironment, pins.bot);
  const botIdentity = await getBotIdentity(bot.token, bot.expectedId);
  const driver = await connectDriver(
    await userCredentials(driverEnvironment, pins.driver),
    TIMEOUT_MS
  );
  scope.defer('driver disconnect', () =>
    withDeadline(
      () => driver.client.disconnect(),
      driverDeadline(TIMEOUT_MS),
      'driver disconnect'
    )
  );
  assertQaDriverAccess(botEnvironment, driver.id);
  progress('identities-pinned');
  const run = randomBytes(4).toString('hex');
  options = { ...options, projectName: `${options.projectName}-${run}` };
  const projectDirectory = join(ROOT, '.deploy', options.projectName);
  await mkdir(dirname(projectDirectory), { mode: 0o700, recursive: true });
  await mkdir(projectDirectory, { mode: 0o700 });
  let dockerClean = true;
  let conversationClean = true;
  let ownedDataDirectory;
  scope.defer('private drill project directory', async () => {
    if (dockerClean && conversationClean) {
      await rm(projectDirectory, { recursive: true, force: true });
      if (ownedDataDirectory) {
        await rm(ownedDataDirectory, { recursive: true, force: true });
      }
    }
  });
  const runId = `vac-qa-drill-${run}`;
  const owned = new QaDockerCleanup({
    runId,
    projectName: options.projectName,
    baseline: await dockerInventory(),
    journal: join(projectDirectory, 'docker-ownership.json'),
  });
  const builder = `${runId}-builder`;
  owned.ownBuilder(builder);
  if (
    !owned.baseline.images.some((row) =>
      row.endsWith(' moby/buildkit:buildx-stable-1')
    )
  ) {
    owned.ownImage('moby/buildkit:buildx-stable-1');
  }
  scope.defer('Docker ownership', async () => {
    const report = await owned.cleanup();
    dockerClean = report.pass;
    if (!report.pass) {
      throw new Error('Owned Docker cleanup failed.');
    }
  });
  dockerClean = false;
  await owned.save();
  const composeFile = join(projectDirectory, 'compose.qa.yaml');
  const marker = `qa-drill-${run}`;
  await writeFile(
    composeFile,
    `services:\n  app:\n    extends:\n      file: ${JSON.stringify(BASE_COMPOSE)}\n      service: app\n    environment:\n      TELEGRAM_CONVERSATION_E2E: '1'\n      VAC_QA_MARKER: ${marker}\n      VAC_QA_OWNER: '${driver.id}'\n      VAC_QA_JOURNAL: /app/qa-journals/bot.json\n      NODE_OPTIONS: '--import /app/experiments/qa-bot-preload.mjs'\n    volumes:\n      - ${JSON.stringify(`${join(ROOT, 'experiments')}:/app/experiments:ro`)}\n      - ${JSON.stringify(`${projectDirectory}:/app/qa-journals`)}\n`,
    { mode: 0o600 }
  );
  await dockerCommand([
    'buildx',
    'create',
    '--name',
    builder,
    '--driver',
    'docker-container',
  ]);
  const unhealthyCompose = join(projectDirectory, 'compose.unhealthy.yaml');
  await writeFile(
    unhealthyCompose,
    unhealthyComposeFile(relative(dirname(unhealthyCompose), composeFile)),
    { mode: 0o600 }
  );
  const drill = {
    ...options,
    builder,
    composeFile,
    botEnv: resolve(options.botEnv),
    log: join(projectDirectory, `drill-${run}.log`),
    readyUrl: `http://127.0.0.1:${options.healthPort}/ready`,
    run,
    owned,
    signal,
    unhealthyCompose,
  };
  // A new drill directory; an existing one must already be a drill's.
  const preexistingData = await stat(drill.dataDirectory).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return false;
    }
  );
  await validateDataDirectory(drill.dataDirectory);
  if (!preexistingData) {
    ownedDataDirectory = drill.dataDirectory;
  }
  const target = await withDeadline(
    () => resolveVerifiedQaBotPeer(driver.client, botIdentity, pins.bot),
    driverDeadline(TIMEOUT_MS),
    'bot entity resolution'
  );
  const state = {
    client: driver.client,
    markerIntervalMs: options.markerIntervalMs,
    signal,
    nextSequence: 1,
    run,
    target,
  };
  state.baselineMessageId = await latestId(state);
  state.ledger = new QaOwnedMessages({
    marker,
    baseline: state.baselineMessageId,
    journal: join(projectDirectory, 'driver-ownership.json'),
    replyProof: {
      run,
      senderId: botIdentity.id,
      startedAt: Math.floor(Date.now() / 1000),
      endedAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      sequences: [],
    },
  });
  await state.ledger.save();
  state.cleanup = onceQaCleanup(() => cleanup(state, drill));
  scope.defer('drill conversation and producer', async () => {
    const result = await state.cleanup();
    conversationClean = result.conversation && result.project;
    if (!result.conversation || !result.project) {
      throw new Error('Drill cleanup failed.');
    }
  });
  conversationClean = false;
  const baseline = {};
  const transitions = [];
  let cleanupResult;
  let runError;
  try {
    for (const transition of options.transitions) {
      signal.throwIfAborted();
      const result = await runTransition(state, drill, transition, baseline);
      transitions.push(result);
      if (transition === 'first-deploy') {
        if (result.exitCode !== 0) {
          break;
        }
        baseline.firstDeployImage = result.image.after;
        // Reserve application-state cleanup before a potentially ambiguous
        // preset command. A rejected first deploy never initializes this state.
        state.hasOwnedState = true;
        // State every later transition must preserve: a preset and a
        // subscription to it (a delivery, if any, is checked for duplicates).
        await command(
          state,
          `/preset save drill-${run} Nha Trang`,
          'Saved preset'
        );
        await command(state, `/subscribe drill-${run}`, 'Subscribed');
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    cleanupResult = await state.cleanup();
  }
  if (runError) {
    throw runError;
  }
  const failures = transitions.flatMap(({ failures: list, transition }) =>
    list.map((failure) => `${transition}: ${failure}`)
  );
  if (!cleanupResult.conversation) {
    failures.push('cleanup: drill messages remain in the conversation');
  }
  if (!cleanupResult.project) {
    failures.push('cleanup: drill Docker project remains');
  }
  if (!cleanupResult.state) {
    failures.push('cleanup: drill subscription or preset remains');
  }
  return {
    cleanup: cleanupResult,
    failures,
    identityPins: Object.keys(pins),
    ok: failures.length === 0,
    transitions,
  };
}

async function main() {
  const options = parseDrillArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await runDeployDrill(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const safe = redactTelegramValue(error);
    process.stderr.write(`${safe.message || 'Deploy drill failed.'}\n`);
    process.exitCode = 1;
  });
}
