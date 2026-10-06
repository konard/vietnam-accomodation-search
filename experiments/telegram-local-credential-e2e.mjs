#!/usr/bin/env node

// Local/manual POSIX wrapper for the existing conversation harness. Resolves
// identity pins from explicitly supplied, authorized credentials, verifies any
// supplied pins, and passes only the required secrets over inherited pipes.
// This wrapper writes no credential files and prints no numeric identities.
// The child harness owns its isolated test state and message cleanup.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

import {
  assertConversationBoundary,
  botCredentials,
  driverDeadline,
  environmentFile,
  getBotIdentity,
  userCredentials,
  withDeadline,
} from './telegram-bot-conversation-e2e.mjs';
import { assertPinnedIdentity } from './telegram-e2e-identities.mjs';

const USAGE =
  'TELEGRAM_CONVERSATION_E2E=1 node experiments/telegram-local-credential-e2e.mjs ' +
  '--bot-env PATH --user-env PATH [--mode bot-only|degraded] ' +
  '[--data-directory EMPTY_E2E_DIRECTORY] [--output REPORT_JSON]';

export function parseLocalCredentialArguments(values) {
  const options = { mode: 'bot-only', timeoutMs: 60_000 };
  const names = {
    '--bot-env': 'botEnv',
    '--user-env': 'userEnv',
    '--mode': 'mode',
    '--data-directory': 'dataDirectory',
    '--output': 'output',
  };
  for (let index = 0; index < values.length; index++) {
    if (values[index] === '--help') {
      return { help: true };
    }
    const name = names[values[index]];
    if (!name || !values[index + 1]) {
      throw new TypeError(`Unknown or incomplete option: ${values[index]}`);
    }
    options[name] = values[++index];
  }
  if (!options.botEnv || !options.userEnv) {
    throw new TypeError('--bot-env and --user-env are required.');
  }
  if (!['bot-only', 'degraded'].includes(options.mode)) {
    throw new TypeError('--mode must be bot-only or degraded.');
  }
  return options;
}

async function credentialEnvironments(options) {
  const botEnvironment = await environmentFile(options.botEnv);
  const driverEnvironment = await environmentFile(options.userEnv);
  const botSecret = await botCredentials(botEnvironment);
  const expectedBot =
    botEnvironment.TELEGRAM_E2E_EXPECTED_BOT_ID ||
    botEnvironment.TELEGRAM_EXPECTED_BOT_ID ||
    botSecret.token.split(':', 1)[0];
  const bot = await getBotIdentity(botSecret.token, expectedBot);
  const user = await userCredentials(driverEnvironment);
  const client = new TelegramClient(
    new StringSession(user.session),
    user.apiId,
    user.apiHash,
    { autoReconnect: false, connectionRetries: 2, requestRetries: 2 }
  );
  client.setLogLevel?.('none');
  const deadline = driverDeadline(options.timeoutMs);
  try {
    await withDeadline(() => client.connect(), deadline, 'user connect');
    const authorized = await withDeadline(
      () => client.checkAuthorization(),
      deadline,
      'user authorization'
    );
    if (!authorized) {
      throw new Error('The user session is not authorized.');
    }
    const identity = await withDeadline(
      () => client.getMe(),
      deadline,
      'user identity'
    );
    const userId = identity.id.toString();
    const suppliedPin =
      driverEnvironment.TELEGRAM_E2E_EXPECTED_USER_ID ||
      driverEnvironment.TELEGRAM_EXPECTED_USER_ID;
    if (suppliedPin) {
      assertPinnedIdentity('driver', suppliedPin, userId);
    }
    if (userId === bot.id) {
      throw new Error('Bot and user must be distinct.');
    }
    return [
      {
        TELEGRAM_BOT_TOKEN: botSecret.token,
        TELEGRAM_E2E_EXPECTED_BOT_ID: bot.id,
      },
      {
        TELEGRAM_API_ID: String(user.apiId),
        TELEGRAM_API_HASH: user.apiHash,
        TELEGRAM_USER_SESSION: user.session,
        TELEGRAM_E2E_EXPECTED_USER_ID: userId,
      },
    ];
  } finally {
    await withDeadline(
      () => client.disconnect(),
      deadline,
      'user disconnect'
    ).catch(() => {});
    await withDeadline(
      () => client.destroy?.(),
      deadline,
      'user destroy'
    ).catch(() => {});
  }
}

export async function runLocalCredentialE2E(options) {
  assertConversationBoundary(process.env);
  if (process.platform === 'win32') {
    throw new Error('This manual wrapper requires POSIX /dev/fd pipes.');
  }
  const environments = await credentialEnvironments(options);
  const arguments_ = [
    'experiments/telegram-bot-conversation-e2e.mjs',
    '--bot-env',
    '/dev/fd/3',
    '--user-env',
    '/dev/fd/4',
    '--mode',
    options.mode,
  ];
  if (options.dataDirectory) {
    arguments_.push('--data-directory', resolve(options.dataDirectory));
  }
  const child = spawn(process.execPath, arguments_, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit', 'pipe', 'pipe'],
  });
  for (const [index, environment] of environments.entries()) {
    const pipe = child.stdio[index + 3];
    pipe.on('error', () => {});
    pipe.end(
      Object.entries(environment)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('\n')
    );
  }
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  const code = await new Promise((fulfill, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) =>
      fulfill(status ?? (signal ? 1 : 0))
    );
  });
  const result = { code, mode: options.mode, stdout };
  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = parseLocalCredentialArguments(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
    } else {
      process.exitCode = (await runLocalCredentialE2E(options)).code;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
