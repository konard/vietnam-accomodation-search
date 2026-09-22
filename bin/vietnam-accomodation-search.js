#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import {
  LinkCliMirror,
  TelegramAuthService,
  TelegramRuntime,
  createApplication,
  formatSearchResults,
  parseSearchCommand,
  preflightTelegram,
  redactTelegramValue,
  resolveTelegramSecrets,
  validateTelegramConfiguration,
} from '../src/index.js';
import { secretPrompt } from '../src/secret-prompt.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

function usage() {
  return [
    'Usage: vietnam-accomodation-search <command> [options]',
    '',
    'Commands:',
    '  bot                         Start the Telegram bot',
    '  search [--cheapest [N]] Q  Search and cache accommodation offers',
    '  update-sources              Refresh all ranked source cohorts',
    '  check-availability ID [@U] Send an availability inquiry as a user',
    '  telegram preflight          Validate storage and Telegram identities',
    '  telegram ingest             Backfill and monitor configured Telegram sources',
    '  telegram auth login|status|validate|rotate|logout',
    '',
    'Options:',
    '  -h, --help                  Show this help',
    '  -v, --version               Show the package version',
  ].join('\n');
}

// eslint-disable-next-line complexity, max-lines-per-function, max-statements -- Command dispatch centralizes validation before dependency construction.
export async function runCli(
  argv,
  {
    application,
    authFactory = (options) => new TelegramAuthService(options),
    env = process.env,
    prompt = secretPrompt,
    stderr = console.error,
    stdout = console.log,
  } = {}
) {
  const [command, ...rest] = argv;
  try {
    if (!command || command === '--help' || command === '-h') {
      stdout(usage());
      return 0;
    }
    if (command === '--version' || command === '-v') {
      stdout(packageVersion);
      return 0;
    }
    if (command === 'telegram' && rest[0] === 'auth') {
      const [, action, ...authArguments] = rest;
      const option = (name) => {
        const index = authArguments.indexOf(name);
        return index < 0 ? undefined : authArguments[index + 1];
      };
      const stdoutSession = authArguments.includes('--session-stdout');
      const qr = authArguments.includes('--qr');
      const sessionFile =
        option('--session-file') || env.TELEGRAM_USER_SESSION_FILE;
      if (
        authArguments.includes('--code') ||
        authArguments.includes('--password')
      ) {
        throw new Error(
          'Login codes and 2FA passwords are never accepted as command-line arguments.'
        );
      }
      if (
        (action === 'login' || action === 'rotate') &&
        !stdoutSession &&
        !sessionFile
      ) {
        throw new Error(
          'Choose --session-file PATH, TELEGRAM_USER_SESSION_FILE, or --session-stdout.'
        );
      }
      const authSecrets = await resolveTelegramSecrets({
        ...env,
        TELEGRAM_BOT_TOKEN: undefined,
        TELEGRAM_BOT_TOKEN_FILE: undefined,
        TELEGRAM_USER_SESSION_FILE: undefined,
      });
      const auth = authFactory({
        apiHash: authSecrets.apiHash,
        apiId: authSecrets.apiId,
        expectedUserId: env.TELEGRAM_EXPECTED_USER_ID,
        onSession: stdoutSession
          ? (session) => stdout(`TELEGRAM_USER_SESSION=${session}`)
          : undefined,
        onSessionEnvelope: stdoutSession
          ? (session) => stdout(`TELEGRAM_USER_SESSION=${session}`)
          : undefined,
        prompt,
        qrCodeHandler: qr
          ? (url) => stdout(`Scan this Telegram login URL: ${url}`)
          : undefined,
        session: authSecrets.session,
        sessionFormat: authSecrets.sessionFormat,
        sessionFile: stdoutSession ? undefined : sessionFile,
      });
      if (action === 'login' || action === 'rotate') {
        const identity = await auth[action]({
          code: env.TELEGRAM_LOGIN_CODE,
          password: env.TELEGRAM_2FA_PASSWORD,
          phone: option('--phone') || env.TELEGRAM_PHONE,
          qr,
        });
        stdout(
          `Authenticated Telegram user ${identity.id}${identity.username ? ` (@${identity.username})` : ''}.`
        );
        return 0;
      }
      if (action === 'status') {
        stdout(JSON.stringify(await auth.status()));
        return 0;
      }
      if (action === 'validate') {
        const identity = await auth.validate();
        stdout(`Telegram session is valid for ${identity.id}.`);
        return 0;
      }
      if (action === 'logout') {
        await auth.logout({ revoke: !authArguments.includes('--local-only') });
        stdout('Telegram session removed.');
        return 0;
      }
      throw new Error(
        'Usage: telegram auth login|status|validate|rotate|logout'
      );
    }
    if (command === 'telegram' && rest[0] === 'preflight') {
      const result = await preflightTelegram({
        authFactory,
        directory: env.DATA_DIRECTORY || '.vietnam-accomodation-search',
        env,
        mirror: new LinkCliMirror(),
      });
      stdout(JSON.stringify(result));
      return 0;
    }
    if (command === 'bot' || (command === 'telegram' && rest[0] === 'ingest')) {
      const credentials = await resolveTelegramSecrets(env);
      const configuration = validateTelegramConfiguration(credentials);
      const ingestOnly = command === 'telegram';
      if (ingestOnly && configuration.mode === 'bot-only') {
        throw new Error(
          configuration.userUnavailable ||
            'TELEGRAM_USER_SESSION is required for ingestion.'
        );
      }
      const effectiveCredentials = configuration.userUnavailable
        ? {
            ...credentials,
            apiHash: undefined,
            apiId: undefined,
            session: undefined,
          }
        : credentials;
      if (configuration.userUnavailable) {
        stderr(
          `Telegram user capability unavailable; continuing in bot-only mode: ${configuration.userUnavailable}`
        );
      }
      application ||= createApplication({
        environment: env,
        telegramCredentials: effectiveCredentials,
      });
      if (
        !ingestOnly &&
        !effectiveCredentials.botToken &&
        !effectiveCredentials.session
      ) {
        throw new Error(
          'Configure TELEGRAM_BOT_TOKEN, TELEGRAM_USER_SESSION, or both.'
        );
      }
      const bot =
        !ingestOnly && effectiveCredentials.botToken
          ? await application.createBot(effectiveCredentials.botToken, {
              apiHash: effectiveCredentials.apiHash,
              apiId: effectiveCredentials.apiId,
              session: effectiveCredentials.session,
              sessionFormat: effectiveCredentials.sessionFormat,
            })
          : undefined;
      const { apiHash, apiId, session, sessionFormat } = effectiveCredentials;
      let userAuth =
        apiHash && apiId && session
          ? new TelegramAuthService({
              apiHash,
              apiId,
              expectedUserId: env.TELEGRAM_EXPECTED_USER_ID,
              session,
              sessionFormat,
            })
          : undefined;
      if (bot) {
        const originalGetMe = bot.api.getMe.bind(bot.api);
        bot.api.getMe = async () => {
          const me = await originalGetMe();
          if (
            env.TELEGRAM_EXPECTED_BOT_ID &&
            String(me.id) !== String(env.TELEGRAM_EXPECTED_BOT_ID)
          ) {
            throw new Error(
              `Telegram bot identity mismatch: expected ${env.TELEGRAM_EXPECTED_BOT_ID}, received ${me.id}.`
            );
          }
          return me;
        };
      }
      let ingestion = session
        ? application.createTelegramIngestionService({
            apiHash,
            apiId,
            session,
            sessionFormat,
          })
        : undefined;
      if (ingestion) {
        try {
          await ingestion.start(await application.registry.list('telegram'));
        } catch (error) {
          if (!bot) {
            throw error;
          }
          stderr(
            `Telegram user ingestion unavailable; continuing in bot-only mode: ${redactTelegramValue(error).message}`
          );
          try {
            await ingestion.destroy();
          } catch (destroyError) {
            stderr(
              `Telegram user ingestion cleanup failed: ${redactTelegramValue(destroyError).message}`
            );
          }
          ingestion = undefined;
          userAuth = undefined;
        }
      }
      let stopUserOnly;
      const userOnlyRuntimeBot = !bot
        ? {
            start: ({ onStart }) => {
              onStart();
              return new Promise((resolve) => {
                stopUserOnly = resolve;
              });
            },
            stop: () => stopUserOnly?.(),
          }
        : undefined;
      const runtime = new TelegramRuntime({
        bot: bot || userOnlyRuntimeBot,
        healthHost: env.HEALTH_HOST || '127.0.0.1',
        healthPort: Number(env.HEALTH_PORT || 8080),
        resources: [ingestion, ...(bot?.resources || [])].filter(Boolean),
        scheduler: bot?.subscriptionScheduler,
        userAuth,
        userAuthOptional: Boolean(bot),
      });
      if (bot) {
        bot.runtime = runtime;
      }
      const removeSignals = runtime.installSignalHandlers();
      try {
        await runtime.start();
        await runtime.polling;
        return runtime.exitCode;
      } finally {
        removeSignals();
      }
    }
    if (command === 'search') {
      application ||= createApplication({ environment: env });
      const options = parseSearchCommand(`/search ${rest.join(' ')}`);
      stdout(formatSearchResults(await application.service.search(options)));
      return 0;
    }
    if (command === 'update-sources') {
      const credentials = await resolveTelegramSecrets(env);
      application ||= createApplication({
        environment: env,
        telegramCredentials: credentials,
      });
      const updated = await application.registry.update();
      stdout(
        `Updated ${updated.web.length} web and ${updated.telegram.length} Telegram sources.`
      );
      return 0;
    }
    if (command === 'check-availability') {
      application ||= createApplication({ environment: env });
      const [offerId, recipient] = rest;
      if (!offerId) {
        throw new Error('An offer ID is required.');
      }
      const { apiHash, apiId, session, sessionFormat } =
        await resolveTelegramSecrets(env);
      const availabilityService = application.createAvailabilityService({
        apiHash,
        apiId,
        session,
        sessionFormat,
      });
      const result = await availabilityService.check(offerId, { recipient });
      stdout(
        `Availability inquiry sent to ${result.recipient} for ${result.offerId}.`
      );
      return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr(error.message);
    return error.exitCode || 1;
  }
}

function isCliEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
