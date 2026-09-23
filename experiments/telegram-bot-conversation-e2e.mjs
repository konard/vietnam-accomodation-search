#!/usr/bin/env node

/**
 * Manual local-only Telegram conversation E2E. A real MTProto user drives the
 * production bot through Telegram while application state stays isolated.
 * No message text, identity, token, session, or raw runtime log is printed.
 */

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import {
  appendFile,
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

import {
  DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
  DEFAULT_TELEGRAM_SOURCES,
  DEFAULT_WEB_SOURCES,
  LinksStore,
  redactTelegramValue,
} from '../src/index.js';
import {
  assertManualLocalRun,
  parseDotEnv,
} from './telegram-accommodation-audit-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOT_ENTRY = join(ROOT, 'bin', 'vietnam-accomodation-search.js');
const CONFIRMATION = '1';
const DEFAULT_TIMEOUT_MS = 60_000;
const DRIVER_OPERATION_TIMEOUT_MS = 30_000;
const FAILURE_LOG_DIRECTORY = join(ROOT, 'experiments', 'logs');

function progress(stage) {
  process.stderr.write(`telegram-e2e stage=${stage}\n`);
}

export async function withDeadline(action, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((resolvePromise, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`Timed out during ${label}.`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function driverDeadline(timeoutMs) {
  return Math.min(timeoutMs, DRIVER_OPERATION_TIMEOUT_MS);
}

function usage() {
  return [
    'Usage: node experiments/telegram-bot-conversation-e2e.mjs [options]',
    '',
    'Required:',
    '  --bot-env PATH           Bot token environment file',
    '  --user-env PATH          MTProto test-user environment file',
    '',
    'Options:',
    '  --mode bot-only|both     Runtime capability mode (default: bot-only)',
    '  --runtime-user-env PATH  Native mtcute runtime credentials for both mode',
    '  --data-directory PATH    Empty isolated E2E state directory',
    '  --timeout-ms NUMBER      Per-operation timeout (default: 60000)',
    '  --keep-data              Preserve redacted logs and synthetic state',
    '  --cleanup-leftovers-only Log/delete recognized prior E2E leftovers',
    '  --help                   Show this help',
  ].join('\n');
}

// eslint-disable-next-line complexity -- CLI validation keeps every destructive/live boundary in one parser.
export function parseConversationArguments(values) {
  const options = {
    cleanupOnly: false,
    keepData: false,
    mode: 'bot-only',
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const valued = new Map([
    ['--bot-env', 'botEnv'],
    ['--data-directory', 'dataDirectory'],
    ['--mode', 'mode'],
    ['--runtime-user-env', 'runtimeUserEnv'],
    ['--timeout-ms', 'timeoutMs'],
    ['--user-env', 'userEnv'],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help') {
      options.help = true;
      continue;
    }
    if (value === '--keep-data') {
      options.keepData = true;
      continue;
    }
    if (value === '--cleanup-leftovers-only') {
      options.cleanupOnly = true;
      continue;
    }
    const property = valued.get(value);
    if (!property || values[index + 1] === undefined) {
      throw new TypeError(`Unknown or incomplete option: ${value}`);
    }
    options[property] = values[index + 1];
    index += 1;
  }
  options.timeoutMs = Number(options.timeoutMs);
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 5_000 ||
    options.timeoutMs > 10 * 60_000
  ) {
    throw new RangeError('--timeout-ms must be between 5000 and 600000.');
  }
  if (!['bot-only', 'both'].includes(options.mode)) {
    throw new TypeError('--mode must be bot-only or both.');
  }
  if (!options.help && (!options.botEnv || !options.userEnv)) {
    throw new TypeError('--bot-env and --user-env are required.');
  }
  if (!options.help && options.mode === 'both' && !options.runtimeUserEnv) {
    throw new TypeError('--runtime-user-env is required in both mode.');
  }
  return options;
}

export function assertConversationBoundary(
  environment = {},
  { nodeVersion = process.versions.node } = {}
) {
  assertManualLocalRun(environment);
  if (environment.TELEGRAM_CONVERSATION_E2E !== CONFIRMATION) {
    throw new Error(
      'Set TELEGRAM_CONVERSATION_E2E=1 to authorize the real conversation E2E.'
    );
  }
  if (environment.TELEGRAM_BOT_POLLER_ACTIVE === '1') {
    throw new Error('Stop the competing Telegram bot poller before E2E.');
  }
  const major = Number(nodeVersion.split('.')[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error('The conversation E2E requires Node.js 22 or newer.');
  }
}

async function environmentFile(path) {
  return parseDotEnv(await readFile(resolve(path), 'utf8'));
}

async function secretValue(environment, names) {
  for (const name of names) {
    if (environment[name] && environment[`${name}_FILE`]) {
      throw new Error(`${name} and ${name}_FILE cannot both be configured.`);
    }
    if (environment[`${name}_FILE`]) {
      return (
        await readFile(resolve(environment[`${name}_FILE`]), 'utf8')
      ).trim();
    }
    if (environment[name]) {
      return environment[name];
    }
  }
  return undefined;
}

async function botCredentials(environment) {
  const token = await secretValue(environment, ['TELEGRAM_BOT_TOKEN']);
  if (!token) {
    throw new Error('The bot environment does not contain a bot token.');
  }
  return {
    expectedId:
      environment.TELEGRAM_E2E_EXPECTED_BOT_ID ||
      environment.TELEGRAM_EXPECTED_BOT_ID,
    token,
  };
}

async function userCredentials(environment) {
  const apiId = Number(
    await secretValue(environment, [
      'TELEGRAM_API_ID',
      'TELEGRAM_USER_BOT_API_ID',
    ])
  );
  const apiHash = await secretValue(environment, [
    'TELEGRAM_API_HASH',
    'TELEGRAM_USER_BOT_API_HASH',
  ]);
  const session = await secretValue(environment, ['TELEGRAM_USER_SESSION']);
  if (!Number.isInteger(apiId) || apiId < 1 || !apiHash || !session) {
    throw new Error('The test-user environment is incomplete.');
  }
  return {
    apiHash,
    apiId,
    expectedId:
      environment.TELEGRAM_E2E_EXPECTED_USER_ID ||
      environment.TELEGRAM_EXPECTED_USER_ID,
    session,
  };
}

async function nativeRuntimeCredentials(environment) {
  const credentials = await userCredentials(environment);
  const format =
    environment.TELEGRAM_USER_SESSION_FORMAT || 'mtcute/session-string-v1';
  if (format !== 'mtcute/session-string-v1') {
    throw new Error('Both mode requires a native mtcute runtime session.');
  }
  if (!credentials.expectedId) {
    throw new Error('Both mode requires a pinned runtime user identity.');
  }
  return { ...credentials, format };
}

async function getBotIdentity(token, expectedId) {
  let response;
  let payload;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    payload = await response.json();
  } catch {
    throw new Error('Telegram Bot API identity check failed.');
  }
  if (!response.ok || !payload.ok || !payload.result?.id) {
    throw new Error('Telegram Bot API rejected the configured bot token.');
  }
  const id = String(payload.result.id);
  const tokenId = token.split(':', 1)[0];
  if (id !== tokenId || (expectedId && id !== String(expectedId))) {
    throw new Error('Telegram bot identity pin mismatch.');
  }
  if (!payload.result.username) {
    throw new Error('The configured Telegram bot has no public username.');
  }
  return { id, username: payload.result.username };
}

async function connectDriver(credentials, timeoutMs) {
  const client = new TelegramClient(
    new StringSession(credentials.session),
    credentials.apiId,
    credentials.apiHash,
    { autoReconnect: false, connectionRetries: 2, requestRetries: 2 }
  );
  client.setLogLevel?.('none');
  const deadline = driverDeadline(timeoutMs);
  try {
    await withDeadline(() => client.connect(), deadline, 'test-user connect');
    if (
      !(await withDeadline(
        () => client.checkAuthorization(),
        deadline,
        'test-user authorization check'
      ))
    ) {
      throw new Error('The Telegram test-user session is not authorized.');
    }
    const identity = await withDeadline(
      () => client.getMe(),
      deadline,
      'test-user identity check'
    );
    const id = identity.id?.toString();
    if (
      !id ||
      (credentials.expectedId && id !== String(credentials.expectedId))
    ) {
      throw new Error('Telegram test-user identity pin mismatch.');
    }
    return { client, id };
  } catch (error) {
    await withDeadline(
      () => client.disconnect(),
      deadline,
      'failed test-user disconnect'
    ).catch(() => {});
    throw error;
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  );
  return port;
}

function withoutTelegramSecrets(environment) {
  const child = { ...environment };
  for (const name of Object.keys(child)) {
    if (
      name.startsWith('TELEGRAM_') &&
      !['TELEGRAM_CONVERSATION_E2E'].includes(name)
    ) {
      delete child[name];
    }
  }
  return child;
}

async function appendRedacted(path, stream, chunk) {
  const redacted = redactTelegramValue(String(chunk));
  const safe =
    typeof redacted === 'string' ? redacted : redacted?.message || '[redacted]';
  await appendFile(path, `${stream}: ${safe}\n`, { encoding: 'utf8' });
}

async function waitForReady(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The bot exited before readiness (${child.exitCode}).`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Readiness is expected to refuse connections during startup.
    }
    await delay(250);
  }
  throw new Error('The bot did not become ready before the E2E deadline.');
}

async function stopBot(instance, timeoutMs) {
  if (!instance || instance.child.exitCode !== null) {
    return;
  }
  instance.child.kill('SIGTERM');
  const result = await Promise.race([
    instance.exited,
    delay(Math.min(timeoutMs, 20_000)).then(() => 'timeout'),
  ]);
  if (result === 'timeout') {
    instance.child.kill('SIGKILL');
    await instance.exited;
    throw new Error('The bot exceeded its graceful shutdown deadline.');
  }
}

async function startBot({ environment, logPath, port, timeoutMs }) {
  await writeFile(logPath, '', { mode: 0o600 });
  const child = spawn(process.execPath, [BOT_ENTRY, 'bot'], {
    cwd: ROOT,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    void appendRedacted(logPath, 'stdout', chunk).catch(() => {});
  });
  child.stderr.on('data', (chunk) => {
    void appendRedacted(logPath, 'stderr', chunk).catch(() => {});
  });
  const exited = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  const instance = { child, exited };
  try {
    await waitForReady(port, child, timeoutMs);
    return instance;
  } catch (error) {
    await stopBot(instance, timeoutMs).catch(() => {});
    throw error;
  }
}

function messageText(message) {
  return String(message?.message || message?.text || '');
}

function messageId(message) {
  return Number(message?.id || 0);
}

export function isFailureReply(text) {
  const value = String(text || '');
  return (
    /(?:^|\n)Usage: \/(?:check_availability|preset|search|subscribe)\b/iu.test(
      value
    ) ||
    /(?:failed|not authorized|not configured|permission denied)/iu.test(value)
  );
}

export function isE2ELeftoverMessage(text) {
  const value = String(text || '');
  return (
    /\be2e-[a-f\d]{10}\b/iu.test(value) ||
    value.includes('E2E synthetic offer ') ||
    (value.includes('clink export verification failed') &&
      value.includes('Usage: /search'))
  );
}

export function formatFailureTranscript(messages, reason) {
  const lines = [
    `recorded-at: ${new Date().toISOString()}`,
    `reason: ${redactTelegramValue(String(reason || 'unexpected bot reply'))}`,
  ];
  for (const message of [...messages].sort(
    (left, right) => messageId(left) - messageId(right)
  )) {
    lines.push(
      `${message.out ? 'test-user' : 'bot'}: ${redactTelegramValue(messageText(message))}`
    );
  }
  return `${lines.join('\n')}\n`;
}

async function persistFailureTranscript(messages, reason) {
  if (!messages.length) {
    return undefined;
  }
  await mkdir(FAILURE_LOG_DIRECTORY, { mode: 0o700, recursive: true });
  await chmod(FAILURE_LOG_DIRECTORY, 0o700);
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, '-');
  const path = join(
    FAILURE_LOG_DIRECTORY,
    `telegram-conversation-${timestamp}-${randomBytes(3).toString('hex')}.failure.log`
  );
  await writeFile(path, formatFailureTranscript(messages, reason), {
    flag: 'wx',
    mode: 0o600,
  });
  process.stderr.write(`telegram-e2e failure-log=${path}\n`);
  return path;
}

async function recentMessages(client, target, timeoutMs) {
  return [
    ...(await withDeadline(
      () => client.getMessages(target, { limit: 100 }),
      driverDeadline(timeoutMs),
      'conversation history read'
    )),
  ];
}

async function latestMessageId(client, target, timeoutMs) {
  return Math.max(
    0,
    ...(await recentMessages(client, target, timeoutMs)).map(messageId)
  );
}

async function waitForMessage(
  client,
  target,
  { afterId, predicate, timeoutMs }
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const replies = (
      await recentMessages(client, target, Math.max(1, remaining))
    )
      .filter((message) => !message.out && messageId(message) > afterId)
      .sort((left, right) => messageId(left) - messageId(right));
    if (replies.some((message) => isFailureReply(messageText(message)))) {
      throw new Error('The bot returned an error reply during E2E.');
    }
    const match = replies.find((message) => predicate(messageText(message)));
    if (match) {
      return match;
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for the expected bot response.');
}

async function sendAndExpect(state, command, predicate) {
  const sent = await withDeadline(
    () =>
      state.client.sendMessage(state.target, {
        message: command,
      }),
    driverDeadline(state.timeoutMs),
    'test command send'
  );
  state.messageIds.add(messageId(sent));
  const reply = await waitForMessage(state.client, state.target, {
    afterId: messageId(sent),
    predicate,
    timeoutMs: state.timeoutMs,
  });
  state.messageIds.add(messageId(reply));
  return { reply, sent };
}

async function seedSyntheticCache(directory, marker) {
  const store = new LinksStore({ binaryMirror: true, directory });
  const sourceIds = [
    ...DEFAULT_WEB_SOURCES,
    ...DEFAULT_TELEGRAM_SOURCES,
    ...DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
  ].map(({ id }) => id);
  const title = `E2E synthetic offer ${marker}`;
  await store.saveRecords('sources', [
    {
      access: 'synthetic-local',
      enabled: true,
      geographicFocus: 'nha-trang',
      id: 'e2e-cache',
      languages: ['en'],
      name: 'E2E cache seed',
      popularity: { metric: 'synthetic', value: 0 },
      searchUrl: 'https://audit.invalid/{query}',
      type: 'web',
      url: 'https://audit.invalid/',
    },
  ]);
  await store.saveOffers([
    {
      attributes: { beds: 2, rooms: 2 },
      collectedAt: new Date().toISOString(),
      id: `e2e-offer-${marker}`,
      kind: 'apartment',
      location: 'Nha Trang',
      price: { amount: 1_234_567, currency: 'VND', period: 'month' },
      priceVnd: 1_234_567,
      searchQueries: ['Nha Trang'],
      sourceId: 'e2e-cache',
      sourceIds: [...sourceIds, 'e2e-cache'],
      sourceType: 'web',
      title,
      url: `https://audit.invalid/${marker}`,
    },
  ]);
  return title;
}

function runtimeEnvironment({
  bot,
  dataDirectory,
  mode,
  port,
  runtimeUser,
  userId,
}) {
  const environment = {
    ...withoutTelegramSecrets(process.env),
    DATA_DIRECTORY: dataDirectory,
    HEALTH_HOST: '127.0.0.1',
    HEALTH_PORT: String(port),
    LINKS_BINARY_MIRROR: '1',
    TELEGRAM_ACCESS_MODE: 'private',
    TELEGRAM_ALLOWED_CHAT_IDS: userId,
    TELEGRAM_ALLOWED_USER_IDS: userId,
    TELEGRAM_BOT_TOKEN: bot.token,
    TELEGRAM_EXPECTED_BOT_ID: bot.identity.id,
  };
  if (mode === 'both') {
    Object.assign(environment, {
      TELEGRAM_API_HASH: runtimeUser.apiHash,
      TELEGRAM_API_ID: String(runtimeUser.apiId),
      TELEGRAM_EXPECTED_USER_ID: String(runtimeUser.expectedId || ''),
      TELEGRAM_USER_SESSION: runtimeUser.session,
      TELEGRAM_USER_SESSION_FORMAT: runtimeUser.format,
    });
  }
  return environment;
}

async function runScenario(state, marker, offerTitle, start) {
  const preset = `e2e-${marker}`;
  state.bot = await start('first');
  progress('first-bot-ready');
  await sendAndExpect(
    state,
    `/preset save ${preset} --max-total-vnd 12345678 Nha Trang`,
    (text) => text === `Saved preset ${preset}.`
  );
  progress('preset-saved');
  await sendAndExpect(state, `/preset use ${preset}`, (text) =>
    text.includes(`Active preset: ${preset}.`)
  );
  progress('preset-selected');
  const subscription = await sendAndExpect(
    state,
    `/subscribe ${preset}`,
    (text) => text === `Subscribed to preset ${preset}.`
  );
  progress('subscription-created');
  const delivered = await waitForMessage(state.client, state.target, {
    afterId: messageId(subscription.sent),
    predicate: (text) => text.includes(offerTitle),
    timeoutMs: state.timeoutMs,
  });
  state.messageIds.add(messageId(delivered));
  progress('fresh-offer-delivered');
  await sendAndExpect(state, '/subscription', (text) =>
    text.includes(`Subscribed to ${preset};`)
  );
  const beforeRestart = await latestMessageId(
    state.client,
    state.target,
    state.timeoutMs
  );
  await stopBot(state.bot, state.timeoutMs);
  state.bot = undefined;
  progress('first-bot-stopped');

  state.bot = await start('second');
  progress('second-bot-ready');
  await delay(3_000);
  const duplicate = (
    await recentMessages(state.client, state.target, state.timeoutMs)
  ).some(
    (message) =>
      !message.out &&
      messageId(message) > beforeRestart &&
      messageText(message).includes(offerTitle)
  );
  if (duplicate) {
    throw new Error('The subscription duplicated an offer after restart.');
  }
  await sendAndExpect(state, '/preset list', (text) =>
    text.includes(`${preset} (active)`)
  );
  await sendAndExpect(state, '/subscription', (text) =>
    text.includes(`Subscribed to ${preset};`)
  );
  await sendAndExpect(state, '/search --min-rooms 1 Nha Trang', (text) =>
    text.includes(offerTitle)
  );
  await sendAndExpect(
    state,
    `/preset show ${preset}`,
    (text) => text.includes(`"query":"Nha Trang"`) && !text.includes('minRooms')
  );
  await sendAndExpect(
    state,
    '/unsubscribe',
    (text) => text === 'Subscription disabled.'
  );
  await sendAndExpect(
    state,
    '/preset use default',
    (text) => text === 'Active preset: default.'
  );
  await sendAndExpect(state, `/preset delete ${preset}`, (text) =>
    text.includes(`Deleted preset ${preset}.`)
  );
  progress('cleanup-commands-complete');
  return { duplicateAfterRestart: false, preset };
}

async function deleteMessages(state, messages = []) {
  const identifiers = [
    ...new Set([...state.messageIds, ...messages.map(messageId)]),
  ].filter((value) => value > 0);
  if (!identifiers.length) {
    return true;
  }
  try {
    await withDeadline(
      () =>
        state.client.deleteMessages(state.target, identifiers, {
          revoke: true,
        }),
      driverDeadline(state.timeoutMs),
      'test-message cleanup'
    );
    return true;
  } catch {
    return false;
  }
}

async function messagesAfterBoundary(state) {
  return (await recentMessages(state.client, state.target, state.timeoutMs))
    .filter((message) => messageId(message) > state.baselineMessageId)
    .sort((left, right) => messageId(left) - messageId(right));
}

async function removeKnownLeftovers(state) {
  const leftovers = (
    await recentMessages(state.client, state.target, state.timeoutMs)
  ).filter((message) => isE2ELeftoverMessage(messageText(message)));
  if (!leftovers.length) {
    return 0;
  }
  await persistFailureTranscript(leftovers, 'stale unmatched E2E messages');
  if (!(await deleteMessages(state, leftovers))) {
    throw new Error('Failed to delete stale E2E conversation messages.');
  }
  return leftovers.length;
}

function safeDataDirectory(path) {
  const selected = resolve(path);
  const name = basename(selected).toLocaleLowerCase('en');
  if (selected === '/' || !name.includes('e2e')) {
    throw new Error('The explicit data directory name must contain "e2e".');
  }
  return selected;
}

async function prepareDataDirectory(path) {
  const selected = safeDataDirectory(path);
  try {
    await mkdir(selected, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
    const details = await lstat(selected);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error('The explicit E2E data path must be a real directory.');
    }
    if ((await readdir(selected)).length > 0) {
      throw new Error('The explicit E2E data directory must be empty.');
    }
  }
  await chmod(selected, 0o700);
  return selected;
}

// eslint-disable-next-line complexity, max-lines-per-function, max-statements -- One boundary owns live setup, transcript capture, Telegram cleanup, and resource teardown.
export async function runConversationE2E(options, environment = process.env) {
  assertConversationBoundary(environment);
  const botEnvironment = await environmentFile(options.botEnv);
  const driverEnvironment = await environmentFile(options.userEnv);
  const botSecret = await botCredentials(botEnvironment);
  const botIdentity = await getBotIdentity(
    botSecret.token,
    botSecret.expectedId
  );
  const driver = await connectDriver(
    await userCredentials(driverEnvironment),
    options.timeoutMs
  );
  progress('test-user-authorized');
  const temporary = !options.dataDirectory;
  let dataDirectory;
  let state;
  let scenario;
  let messagesDeleted = false;
  let staleMessagesDeleted = 0;
  let runError;
  try {
    if (options.cleanupOnly) {
      const target = await withDeadline(
        () => driver.client.getEntity(`@${botIdentity.username}`),
        driverDeadline(options.timeoutMs),
        'bot entity resolution'
      );
      state = {
        baselineMessageId: await latestMessageId(
          driver.client,
          target,
          options.timeoutMs
        ),
        bot: undefined,
        client: driver.client,
        messageIds: new Set(),
        target,
        timeoutMs: options.timeoutMs,
      };
      staleMessagesDeleted = await removeKnownLeftovers(state);
      messagesDeleted = true;
      return {
        cleanupOnly: true,
        messagesDeleted,
        staleMessagesDeleted,
      };
    }
    const runtimeUser = options.runtimeUserEnv
      ? await nativeRuntimeCredentials(
          await environmentFile(options.runtimeUserEnv)
        )
      : undefined;
    dataDirectory = temporary
      ? await mkdtemp(join(tmpdir(), 'vac-telegram-e2e-'))
      : await prepareDataDirectory(options.dataDirectory);
    if (options.keepData || !temporary) {
      process.stderr.write(`telegram-e2e data-directory=${dataDirectory}\n`);
    }
    await chmod(dataDirectory, 0o700);
    const marker = randomBytes(5).toString('hex');
    const offerTitle = await seedSyntheticCache(dataDirectory, marker);
    progress('synthetic-cache-ready');
    const target = await withDeadline(
      () => driver.client.getEntity(`@${botIdentity.username}`),
      driverDeadline(options.timeoutMs),
      'bot entity resolution'
    );
    progress('bot-entity-resolved');
    state = {
      baselineMessageId: 0,
      bot: undefined,
      client: driver.client,
      messageIds: new Set(),
      target,
      timeoutMs: options.timeoutMs,
    };
    state.baselineMessageId = await latestMessageId(
      state.client,
      state.target,
      state.timeoutMs
    );
    staleMessagesDeleted = await removeKnownLeftovers(state);
    const port = await availablePort();
    const childEnvironment = runtimeEnvironment({
      bot: { identity: botIdentity, token: botSecret.token },
      dataDirectory,
      mode: options.mode,
      port,
      runtimeUser,
      userId: driver.id,
    });
    const start = (phase) =>
      startBot({
        environment: childEnvironment,
        logPath: join(dataDirectory, `bot-${phase}.redacted.log`),
        port,
        timeoutMs: options.timeoutMs,
      });
    scenario = await runScenario(state, marker, offerTitle, start);
    const unexpected = (await messagesAfterBoundary(state)).filter(
      (message) => !message.out && isFailureReply(messageText(message))
    );
    if (unexpected.length) {
      throw new Error('The bot returned an error reply during E2E.');
    }
  } catch (error) {
    runError = error;
  } finally {
    await stopBot(state?.bot, options.timeoutMs).catch(() => {});
    if (state) {
      let createdMessages = [];
      try {
        createdMessages = await messagesAfterBoundary(state);
      } catch (error) {
        runError ||= error;
      }
      const failures = createdMessages.filter(
        (message) => !message.out && isFailureReply(messageText(message))
      );
      if ((runError || failures.length) && createdMessages.length) {
        await persistFailureTranscript(
          createdMessages,
          runError?.message || 'unexpected bot reply'
        ).catch((error) => {
          runError ||= error;
        });
      }
      messagesDeleted = await deleteMessages(state, createdMessages);
      if (!messagesDeleted) {
        runError ||= new Error(
          'Failed to delete every message created by the Telegram E2E.'
        );
      }
    }
    await withDeadline(
      () => driver.client.disconnect(),
      DRIVER_OPERATION_TIMEOUT_MS,
      'test-user disconnect'
    ).catch(() => {});
    await withDeadline(
      () => driver.client.destroy?.(),
      DRIVER_OPERATION_TIMEOUT_MS,
      'test-user destroy'
    ).catch(() => {});
    if (temporary && dataDirectory && !options.keepData) {
      await rm(dataDirectory, { force: true, recursive: true });
    }
  }
  if (runError) {
    throw runError;
  }
  return {
    botIdentityVerified: true,
    botRestarted: true,
    combinedRuntime: options.mode === 'both',
    duplicateAfterRestart: scenario.duplicateAfterRestart,
    messagesDeleted,
    persistedPreset: true,
    persistedSubscription: true,
    realTelegramConversation: true,
    staleMessagesDeleted,
    syntheticCacheUsed: true,
    testUserAuthorized: true,
    testUserIdentityPinned: Boolean(
      driverEnvironment.TELEGRAM_E2E_EXPECTED_USER_ID ||
      driverEnvironment.TELEGRAM_EXPECTED_USER_ID
    ),
  };
}

async function main() {
  const options = parseConversationArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await runConversationE2E(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const safe = redactTelegramValue(error);
    process.stderr.write(`${safe.message || 'Telegram E2E failed.'}\n`);
    process.exitCode = 1;
  });
}
