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
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
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

function run(command, args, { env = process.env, log } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    const record = (chunk) =>
      log ? appendFile(log, chunk, { mode: 0o600 }) : undefined;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      record(chunk);
    });
    child.stderr.on('data', record);
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout }));
  });
}

function composeEnvironment(options) {
  // `down` interpolates the whole file, including the build arguments.
  return {
    ...process.env,
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
    ...(transition === 'unhealthy-candidate'
      ? ['--compose-file', options.unhealthyCompose]
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
      ['compose', '-f', BASE_COMPOSE, '-p', options.projectName, 'down'],
      { env, log: options.log }
    );
    if (down.code !== 0) {
      return down.code;
    }
  }
  const deploy = await run(
    process.execPath,
    [DEPLOY, ...deployArguments(options, transition)],
    { env, log: options.log }
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
  while (!stop.done) {
    const sequence = state.nextSequence;
    state.nextSequence += 1;
    const message = await withDeadline(
      () =>
        state.client.sendMessage(state.target, {
          message: markerCommand(state.run, sequence),
        }),
      driverDeadline(TIMEOUT_MS),
      'marker send'
    );
    state.messageIds.add(messageId(message));
    sent.push({ date: message.date, sequence });
    await delay(state.markerIntervalMs);
  }
}

async function messagesSince(state, minId) {
  const messages = [
    ...(await withDeadline(
      () => state.client.getMessages(state.target, { limit: 500, minId }),
      driverDeadline(TIMEOUT_MS),
      'conversation history read'
    )),
  ];
  for (const message of messages) {
    state.messageIds.add(messageId(message));
  }
  return messages;
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
  const message = await state.client.sendMessage(state.target, {
    message: text,
  });
  state.messageIds.add(messageId(message));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const replies = (await messagesSince(state, minId)).filter(
      (reply) => !reply.out
    );
    if (replies.some((reply) => messageText(reply).startsWith(expected))) {
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
  const background = Promise.all([
    sample(options, samples, stop),
    sendMarkers(state, sent, stop),
  ]);
  const started = Date.now();
  let exitCode;
  let mutationMs;
  try {
    exitCode = await mutate(options, transition);
  } finally {
    mutationMs = Date.now() - started;
    // Keep sending markers while the new poller settles.
    await delay(options.settleMs);
    stop.done = true;
    await background;
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
  try {
    await command(state, '/unsubscribe', 'Subscription disabled.');
    await command(state, `/preset delete drill-${state.run}`, 'Deleted');
    result.state = true;
  } catch {
    // Reported below; the message cleanup still runs.
  }
  // Stop the notification producer before taking the final history snapshot
  // and deleting messages. Compose failure must not skip conversation cleanup.
  try {
    const down = await run(
      'docker',
      [
        'compose',
        '-f',
        BASE_COMPOSE,
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
  try {
    await messagesSince(state, state.baselineMessageId);
  } catch {
    result.conversation = false;
  }
  const identifiers = [...state.messageIds].filter((value) => value > 0);
  try {
    if (identifiers.length) {
      await state.client.deleteMessages(state.target, identifiers, {
        revoke: true,
      });
    }
    const remaining = await messagesSince(state, state.baselineMessageId);
    result.leftoverMessages = remaining.filter(
      (message) => messageId(message) > state.baselineMessageId
    ).length;
    result.conversation = result.leftoverMessages === 0;
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

export async function runDeployDrill(options, environment = process.env) {
  assertDrillBoundary(environment);
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
  progress('identities-pinned');
  const run = randomBytes(4).toString('hex');
  const projectDirectory = join(ROOT, '.deploy', options.projectName);
  await mkdir(projectDirectory, { mode: 0o700, recursive: true });
  const unhealthyCompose = join(projectDirectory, 'compose.unhealthy.yaml');
  await writeFile(
    unhealthyCompose,
    unhealthyComposeFile(relative(dirname(unhealthyCompose), BASE_COMPOSE)),
    { mode: 0o600 }
  );
  const drill = {
    ...options,
    botEnv: resolve(options.botEnv),
    log: join(projectDirectory, `drill-${run}.log`),
    readyUrl: `http://127.0.0.1:${options.healthPort}/ready`,
    run,
    unhealthyCompose,
  };
  // A new drill directory; an existing one must already be a drill's.
  await validateDataDirectory(drill.dataDirectory);
  const target = await withDeadline(
    () => driver.client.getEntity(`@${botIdentity.username}`),
    driverDeadline(TIMEOUT_MS),
    'bot entity resolution'
  );
  const state = {
    client: driver.client,
    markerIntervalMs: options.markerIntervalMs,
    messageIds: new Set(),
    nextSequence: 1,
    run,
    target,
  };
  state.baselineMessageId = await latestId(state);
  const baseline = {};
  const transitions = [];
  let cleanupResult;
  let runError;
  try {
    for (const transition of options.transitions) {
      const result = await runTransition(state, drill, transition, baseline);
      transitions.push(result);
      if (transition === 'first-deploy') {
        if (result.exitCode !== 0) {
          break;
        }
        baseline.firstDeployImage = result.image.after;
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
    cleanupResult = await cleanup(state, drill);
    await withDeadline(
      () => driver.client.disconnect(),
      driverDeadline(TIMEOUT_MS),
      'test-user disconnect'
    ).catch(() => {});
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
