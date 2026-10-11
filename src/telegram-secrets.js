import { readFile } from 'node:fs/promises';

const ALIASES = {
  TELEGRAM_API_ID: ['TELEGRAM_USER_BOT_API_ID'],
  TELEGRAM_API_HASH: ['TELEGRAM_USER_BOT_API_HASH'],
};

function secretKey(env, name) {
  const names = [name, ...(ALIASES[name] || [])];
  const configured = names.flatMap((key) =>
    [key, `${key}_FILE`].filter((candidate) => env[candidate])
  );
  if (configured.length > 1) {
    // Validate all aliases before reading files. Credential values and paths
    // never belong in a conflict diagnostic.
    throw new Error(
      `${name} credential conflict: names and secret files cannot both be configured.`
    );
  }
  return configured[0];
}

export async function telegramSecretValue(env, name) {
  const key = secretKey(env, name);
  return key?.endsWith('_FILE')
    ? (await readFile(env[key], 'utf8')).trim()
    : env[key];
}

// The synchronous composition root supports inline credentials. Secret files
// are resolved by the async CLI/preflight and passed as telegramCredentials.
export function inlineTelegramCredentials(env) {
  return Object.fromEntries(
    Object.entries({
      apiId: 'TELEGRAM_API_ID',
      apiHash: 'TELEGRAM_API_HASH',
      session: 'TELEGRAM_USER_SESSION',
      sessionFormat: 'TELEGRAM_USER_SESSION_FORMAT',
    }).map(([field, name]) => {
      const key = secretKey(env, name);
      return [field, key?.endsWith('_FILE') ? undefined : env[key]];
    })
  );
}
