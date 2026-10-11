import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { durableWrite } from './link-cli-mirror.js';
import {
  resolveTelegramSecrets,
  TelegramAuthService,
} from './telegram-auth.js';

function approvedIds(value, owner) {
  const ids = String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.some((id) => !/^-?\d+$/u.test(id))) {
    throw new Error('Private allowlists must contain numeric identifiers.');
  }
  return [...new Set([...ids, owner])].join(',');
}

// Authenticate the already supplied session locally. Only the configuration
// file contains the derived identity; the returned status is safe to print.
export async function configurePrivateOwner({
  envFile,
  identityProvider = ({ credentials, environment }) =>
    new TelegramAuthService({
      ...credentials,
      expectedUserId: environment.TELEGRAM_EXPECTED_USER_ID,
    }).validate(),
} = {}) {
  if (!envFile) {
    throw new Error(
      'Choose the original private configuration with --env-file PATH.'
    );
  }
  const path = resolve(envFile);
  const original = await readFile(path, 'utf8');
  const environment = parseEnv(original);
  const secretEnvironment = Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      key.endsWith('_FILE') ? resolve(dirname(path), value) : value,
    ])
  );
  let identity;
  try {
    identity = await identityProvider({
      credentials: await resolveTelegramSecrets(secretEnvironment),
      environment,
    });
  } catch {
    throw new Error(
      'Authenticated owner validation failed. Private configuration was not changed.'
    );
  }
  const owner = String(identity?.id || '');
  if (
    !/^\d+$/u.test(owner) ||
    !Number.isSafeInteger(Number(owner)) ||
    Number(owner) < 1
  ) {
    throw new Error('The authenticated owner identity is invalid.');
  }
  if (
    environment.TELEGRAM_EXPECTED_USER_ID &&
    environment.TELEGRAM_EXPECTED_USER_ID !== owner
  ) {
    throw new Error(
      'The authenticated owner identity does not match the configured account.'
    );
  }
  const settings = {
    TELEGRAM_ACCESS_MODE: 'private',
    TELEGRAM_ALLOWED_USER_IDS: approvedIds(
      environment.TELEGRAM_ALLOWED_USER_IDS,
      owner
    ),
    // The owner's private chat is the same numeric peer, never a group.
    TELEGRAM_ALLOWED_CHAT_IDS: approvedIds(
      environment.TELEGRAM_ALLOWED_CHAT_IDS,
      owner
    ),
  };
  let next = original;
  for (const [key, value] of Object.entries(settings)) {
    const line = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, 'gmu');
    next = line.test(next)
      ? next.replace(line, `${key}=${value}`)
      : `${next.replace(/\n?$/u, '\n')}${key}=${value}\n`;
  }
  if ((await readFile(path, 'utf8')) !== original) {
    throw new Error(
      'Private configuration changed during validation; it was not overwritten.'
    );
  }
  await durableWrite(path, next);
  return {
    configured: true,
    accessMode: 'private',
    liveCommandVerified: false,
  };
}
