#!/usr/bin/env node
// Local operator workflow. Reuse an existing native or legacy authenticated
// session only to derive its owner; never export or convert that session.
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  resolveTelegramSecrets,
  TelegramAuthService,
} from '../src/telegram-auth.js';
import { configurePrivateOwner } from '../src/telegram-operator.js';
import {
  SESSION_FORMAT,
  inspectSessionEnvelope,
} from '../src/session-envelope.js';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';
import { withQaCleanup } from './qa-cleanup.mjs';
import { withDeadline } from './telegram-bot-conversation-e2e.mjs';

export async function resolveOwnerCredentials(
  credentials,
  environment,
  userEnvironment
) {
  if (
    userEnvironment?.TELEGRAM_EXPECTED_USER_ID &&
    environment.TELEGRAM_EXPECTED_USER_ID &&
    userEnvironment.TELEGRAM_EXPECTED_USER_ID !==
      environment.TELEGRAM_EXPECTED_USER_ID
  ) {
    throw new Error('Configured owner pins conflict.');
  }
  return {
    ...(userEnvironment
      ? await resolveTelegramSecrets(userEnvironment)
      : credentials),
    expectedUserId:
      userEnvironment?.TELEGRAM_EXPECTED_USER_ID ||
      environment.TELEGRAM_EXPECTED_USER_ID,
  };
}

async function legacyClient(credentials) {
  const [{ TelegramClient }, { StringSession }] = await Promise.all([
    import('teleproto'),
    import('teleproto/sessions/index.js'),
  ]);
  return new TelegramClient(
    new StringSession(credentials.session),
    Number(credentials.apiId),
    credentials.apiHash,
    {
      connectionRetries: 1,
      requestRetries: 1,
      timeout: 10,
      autoReconnect: false,
    }
  );
}

export async function deriveSuppliedOwner(
  credentials,
  scope,
  {
    authFactory = (options) => new TelegramAuthService(options),
    legacyFactory = legacyClient,
  } = {}
) {
  if (
    credentials.sessionFormat === SESSION_FORMAT ||
    inspectSessionEnvelope(credentials.session).state === 'active-unverified'
  ) {
    return authFactory(credentials).validate();
  }
  if (!credentials.apiId || !credentials.apiHash || !credentials.session) {
    throw new Error('The existing authenticated user session is unavailable.');
  }
  const client = await legacyFactory(credentials);
  client.setLogLevel('none');
  scope.defer('supplied owner session', () => client.destroy());
  return withDeadline(
    async () => {
      await client.connect();
      if (!(await client.checkAuthorization())) {
        throw new Error('The supplied session is not authenticated.');
      }
      const me = await client.getMe();
      if (
        credentials.expectedUserId &&
        String(me.id) !== String(credentials.expectedUserId)
      ) {
        throw new Error('The supplied session owner pin does not match.');
      }
      return { id: String(me.id) };
    },
    30_000,
    'private owner derivation'
  );
}

export async function main(args = process.argv.slice(2)) {
  assertManualLocalRun(process.env);
  const option = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const envFile = option('--env-file');
  if (!envFile) {
    throw new Error(
      'Usage: node experiments/configure-private-owner.mjs --env-file ORIGINAL.env [--user-env EXISTING_USER.env]'
    );
  }
  return await withQaCleanup(async (scope, signal) => {
    const userFile = option('--user-env');
    const parsed = userFile
      ? parseEnv(await readFile(userFile, 'utf8'))
      : undefined;
    const userEnvironment = parsed
      ? Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            key,
            key.endsWith('_FILE')
              ? resolve(dirname(resolve(userFile)), value)
              : value,
          ])
        )
      : undefined;
    const result = await configurePrivateOwner({
      envFile,
      identityProvider: async ({ credentials, environment }) => {
        signal.throwIfAborted();
        return deriveSuppliedOwner(
          await resolveOwnerCredentials(
            credentials,
            environment,
            userEnvironment
          ),
          scope
        );
      },
    });
    console.log(JSON.stringify(result));
    return result;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main().catch(() => {
    console.error(
      'Private owner setup failed; inspect the protected configuration locally.'
    );
    process.exitCode = 1;
  });
}
