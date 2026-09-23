import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  BotApiTelegramProvider,
  TelegramAuthService,
  TelegramAccessPolicy,
  TelegramCapabilityRouter,
  classifyTelegramError,
  preflightTelegram,
  redactTelegramValue,
  retryTelegramOperation,
  sessionPayload,
  validateTelegramConfiguration,
} from '../src/index.js';
import { runCli } from '../bin/vietnam-accomodation-search.js';

async function capturedFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

describe('Telegram error policy', () => {
  it('classifies Bot API, transport, MTProto, flood, auth, entity, and conflict errors', () => {
    const limited = classifyTelegramError({
      error_code: 429,
      parameters: { retry_after: 7 },
    });
    expect(limited.category).toBe('rate-limit');
    expect(limited.delayMs).toBe(7000);
    expect(limited.retryable).toBe(true);
    expect(classifyTelegramError({ code: 'ECONNRESET' }).category).toBe(
      'transport'
    );
    expect(
      classifyTelegramError({
        code: 'ECONNRESET',
        message: 'identity transport failure',
      }).category
    ).toBe('transport');
    expect(
      classifyTelegramError({ errorMessage: 'FLOOD_WAIT_12' }).delayMs
    ).toBe(12_000);
    expect(
      classifyTelegramError({ errorMessage: 'AUTH_KEY_UNREGISTERED' }).fatal
    ).toBe(true);
    expect(classifyTelegramError({ error_code: 409 }).category).toBe(
      'conflict'
    );
    expect(
      classifyTelegramError({ errorMessage: 'USERNAME_INVALID' }).category
    ).toBe('entity');
    expect(
      classifyTelegramError({ error_code: 403, description: 'bot was blocked' })
        .category
    ).toBe('blocked');
    expect(classifyTelegramError(new SyntaxError('bad update')).category).toBe(
      'malformed'
    );
  });

  it('retries only safe operations with bounded server delay and cancellation', async () => {
    let attempts = 0;
    const sleeps = [];
    const logs = [];
    const result = await retryTelegramOperation(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw { error_code: 429, parameters: { retry_after: 60 } };
        }
        return 'ok';
      },
      {
        idempotent: true,
        jitter: () => 0,
        logger: { warn: (message, fields) => logs.push([message, fields]) },
        maxDelayMs: 1000,
        operationName: 'history',
        sleep: async (milliseconds) => sleeps.push(milliseconds),
        sourceId: 'telegram:rentals',
        correlationId: 'request-7',
        transport: 'mtproto',
      }
    );
    expect(result).toBe('ok');
    expect(sleeps).toEqual([1000, 1000]);
    expect(logs[0]).toEqual([
      'telegram operation retry',
      {
        attempt: 1,
        category: 'rate-limit',
        correlationId: 'request-7',
        delayMs: 1000,
        operation: 'history',
        sourceId: 'telegram:rentals',
        transport: 'mtproto',
      },
    ]);

    attempts = 0;
    let error;
    try {
      await retryTelegramOperation(
        async () => {
          attempts += 1;
          throw Object.assign(new Error('socket lost'), { code: 'ECONNRESET' });
        },
        { idempotent: false, sleep: async () => {} }
      );
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('socket lost');
    expect(attempts).toBe(1);

    const controller = new AbortController();
    controller.abort();
    try {
      await retryTelegramOperation(async () => 'never', {
        idempotent: true,
        signal: controller.signal,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error.name).toBe('AbortError');

    for (const clock of [
      [0, 0, 0, 100],
      [0, 0, 100],
    ]) {
      let tick = 0;
      const timedOut = await (async () => {
        try {
          await retryTelegramOperation(
            async () => {
              throw Object.assign(new Error('timed out'), {
                code: 'ECONNRESET',
              });
            },
            {
              idempotent: true,
              maxElapsedMs: 50,
              now: () => clock[tick++] ?? clock.at(-1),
              sleep: async () => {},
            }
          );
        } catch (caught) {
          return caught;
        }
      })();
      expect(timedOut.message).toBe('timed out');
    }
  });

  it('redacts nested causes and Telegram credential patterns', () => {
    const redacted = redactTelegramValue({
      apiHash: 'hash',
      cause: { authorization: 'Bearer abc', session: 'secret-session' },
      message: 'request token=123456789:abcdefghijklmnopqrstuvwxyzABCDE failed',
      update: { text: 'private message' },
    });
    expect(JSON.stringify(redacted)).not.toContain('secret-session');
    expect(JSON.stringify(redacted)).not.toContain(
      'abcdefghijklmnopqrstuvwxyz'
    );
    expect(redacted.update).toBe('[REDACTED]');
    const aggregate = redactTelegramValue(
      new AggregateError(
        [new Error('token=private-value'), new Error('cleanup failed')],
        'both failed'
      )
    );
    expect(aggregate.errors.length).toBe(2);
    expect(JSON.stringify(aggregate)).not.toContain('private-value');
  });
});

describe('Telegram capability routing', () => {
  it('maps concrete Bot API identity, entity, media, membership, popularity, and send capabilities', async () => {
    const calls = [];
    const provider = new BotApiTelegramProvider(
      {
        getChat: async (chatId) => ({ id: chatId }),
        getChatMember: async (chatId, userId) => ({ chatId, userId }),
        getChatMemberCount: async () => 27,
        getFile: async () => ({ file_path: 'photos/one.jpg' }),
        getMe: async () => ({ id: 42, username: 'search_bot' }),
        sendMessage: async (...arguments_) => {
          calls.push(arguments_);
          return { message_id: 9 };
        },
      },
      {
        fetchImpl: async (url) => {
          expect(url).toContain('/file/botsecret/photos/one.jpg');
          return {
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            ok: true,
          };
        },
        token: 'secret',
      }
    );

    expect((await provider.identity()).id).toBe(42);
    expect((await provider.resolveEntity(-100)).id).toBe(-100);
    expect((await provider.membership(-100)).userId).toBe(42);
    expect((await provider.popularity(-100)).members).toBe(27);
    expect([...(await provider.media('file-1'))]).toEqual([1, 2, 3]);
    expect((await provider.send(-100, 'hello')).message_id).toBe(9);
    expect(calls.length).toBe(1);
  });

  it('reports Bot API media and pre-send capability failures', async () => {
    const withoutPath = new BotApiTelegramProvider({
      getFile: async () => ({}),
    });
    expect(
      (await capturedFailure(() => withoutPath.media('missing'))).code
    ).toBe('TELEGRAM_CAPABILITY_UNAVAILABLE');

    const failedDownload = new BotApiTelegramProvider(
      { getFile: async () => ({ file_path: 'missing.jpg' }) },
      {
        fetchImpl: async () => ({ ok: false, status: 404 }),
        token: 'secret',
      }
    );
    expect(
      (await capturedFailure(() => failedDownload.media('missing'))).message
    ).toContain('HTTP 404');

    const forbidden = { error_code: 403 };
    const failedSend = new BotApiTelegramProvider({
      sendMessage: async () => {
        throw forbidden;
      },
    });
    expect(await capturedFailure(() => failedSend.send('chat', 'hello'))).toBe(
      forbidden
    );
    expect(forbidden.preSend).toBe(true);
  });

  it('enforces bot-only, user-only, and bot-first combined capability matrices', async () => {
    const calls = [];
    const bot = {
      capabilities: new Set(['identity', 'liveUpdates', 'send']),
      identity: async () => ({ id: 1 }),
      send: async () => {
        calls.push('bot');
        return { id: 10 };
      },
    };
    const user = {
      capabilities: new Set(['history', 'send']),
      history: async () => ['old'],
      send: async () => {
        calls.push('user');
        return { id: 11 };
      },
    };
    expect(
      (await new TelegramCapabilityRouter({ bot, mode: 'bot-only' }).identity())
        .id
    ).toBe(1);
    expect(
      await new TelegramCapabilityRouter({ mode: 'user-only', user }).history()
    ).toEqual(['old']);
    const combined = new TelegramCapabilityRouter({ bot, mode: 'both', user });
    await combined.send('chat', 'hello', { idempotencyKey: 'one' });
    expect(calls).toEqual(['bot']);
    expect(await combined.history()).toEqual(['old']);
    bot.destroy = async () => calls.push('destroy-bot');
    user.destroy = async () => calls.push('destroy-user');
    await combined.destroy();
    expect(calls).toEqual(['bot', 'destroy-bot', 'destroy-user']);
  });

  it('applies the bounded retry policy only to idempotent or known pre-send operations', async () => {
    const sleeps = [];
    let identityAttempts = 0;
    let sendAttempts = 0;
    const router = new TelegramCapabilityRouter({
      bot: {
        capabilities: new Set(['identity', 'send']),
        identity: async () => {
          identityAttempts += 1;
          if (identityAttempts === 1) {
            throw Object.assign(new Error('identity transport failure'), {
              code: 'ECONNRESET',
            });
          }
          return { id: 1 };
        },
        send: async () => {
          sendAttempts += 1;
          if (sendAttempts === 1) {
            throw Object.assign(new Error('rejected before send'), {
              code: 'ECONNRESET',
              preSend: true,
            });
          }
          return { id: 2 };
        },
        transport: 'bot-api',
      },
      mode: 'bot-only',
      retryOptions: {
        jitter: () => 0,
        sleep: async (delay) => sleeps.push(delay),
      },
    });

    expect((await router.identity()).id).toBe(1);
    expect((await router.send('chat', 'hello')).id).toBe(2);
    expect(identityAttempts).toBe(2);
    expect(sendAttempts).toBe(2);
    expect(sleeps).toEqual([250, 250]);
  });

  it('does not fall back after an ambiguous non-idempotent send outcome', async () => {
    const calls = [];
    const bot = {
      capabilities: new Set(['send']),
      send: async () => {
        calls.push('bot');
        throw Object.assign(new Error('forbidden after request'), {
          error_code: 403,
        });
      },
    };
    const user = {
      capabilities: new Set(['send']),
      send: async () => calls.push('user'),
    };
    let error;
    try {
      await new TelegramCapabilityRouter({ bot, mode: 'both', user }).send(
        'chat',
        'hello'
      );
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('forbidden');
    expect(calls).toEqual(['bot']);
  });

  it('falls back only for a known pre-send capability rejection and reports degraded modes', async () => {
    const calls = [];
    const capabilityFailure = Object.assign(
      new Error('bot cannot reach peer'),
      {
        error_code: 403,
        preSend: true,
      }
    );
    const combined = new TelegramCapabilityRouter({
      bot: {
        capabilities: new Set(['send']),
        send: async () => {
          calls.push('bot');
          throw capabilityFailure;
        },
        transport: 'bot-api',
      },
      mode: 'both',
      user: {
        capabilities: new Set(['send']),
        send: async () => {
          calls.push('user');
          return { id: 12 };
        },
        transport: 'mtproto',
      },
    });
    expect((await combined.send('chat', 'hello')).id).toBe(12);
    expect(calls).toEqual(['bot', 'user']);
    expect(
      combined
        .diagnostics()
        .capabilities.find(({ capability }) => capability === 'send').transports
    ).toEqual(['bot-api', 'mtproto']);

    const unavailable = new TelegramCapabilityRouter({ mode: 'bot-only' });
    let error;
    try {
      await unavailable.history('source');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('TELEGRAM_CAPABILITY_UNAVAILABLE');
  });

  it('persists successful idempotency outcomes and reuses them after restart', async () => {
    const records = [];
    const store = {
      loadRecords: async () => records,
      saveRecords: async (_kind, next) =>
        records.splice(0, records.length, ...next),
    };
    let sends = 0;
    const provider = {
      capabilities: new Set(['send']),
      send: async () => ({ id: BigInt(++sends) }),
    };
    await new TelegramCapabilityRouter({
      bot: provider,
      mode: 'bot-only',
      store,
    }).send('chat', 'hello', { idempotencyKey: 'delivery-1' });
    const result = await new TelegramCapabilityRouter({
      bot: provider,
      mode: 'bot-only',
      store,
    }).send('chat', 'hello', { idempotencyKey: 'delivery-1' });
    expect(result.id).toBe('1');
    expect(sends).toBe(1);
  });

  it('persists idempotent delivery outcomes with an atomic store transaction', async () => {
    const records = [];
    let transactions = 0;
    const store = {
      loadRecords: async () => records,
      updateRecords: async (_kind, update) => {
        transactions += 1;
        records.splice(0, records.length, ...(await update([...records])));
      },
    };
    const result = await new TelegramCapabilityRouter({
      bot: {
        capabilities: new Set(['send']),
        send: async () => ({ id: 7 }),
      },
      mode: 'bot-only',
      store,
    }).send('chat', 'hello', { idempotencyKey: 'atomic-send' });
    expect(result.id).toBe(7);
    expect(transactions).toBe(1);
    expect(records[0].id).toBe('atomic-send');
  });

  it('persists primitive delivery receipts without changing their value', async () => {
    const records = [];
    const store = {
      loadRecords: async () => records,
      saveRecords: async (_kind, next) =>
        records.splice(0, records.length, ...next),
    };
    const result = await new TelegramCapabilityRouter({
      bot: {
        capabilities: new Set(['send']),
        send: async () => 'sent',
      },
      mode: 'bot-only',
      store,
    }).send('chat', 'hello', { idempotencyKey: 'primitive-send' });

    expect(result).toBe('sent');
    expect(records[0].result).toBe('sent');
  });

  it('coalesces concurrent sends that use the same idempotency key', async () => {
    const records = [];
    const store = {
      loadRecords: async () => records,
      saveRecords: async (_kind, next) =>
        records.splice(0, records.length, ...next),
    };
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let sends = 0;
    const router = new TelegramCapabilityRouter({
      bot: {
        capabilities: new Set(['send']),
        send: async () => {
          sends += 1;
          await gate;
          return { id: sends };
        },
      },
      mode: 'bot-only',
      store,
    });

    const first = router.send('chat', 'hello', {
      idempotencyKey: 'delivery-concurrent',
    });
    const second = router.send('chat', 'hello', {
      idempotencyKey: 'delivery-concurrent',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sends).toBe(1);
    release();
    expect(await Promise.all([first, second])).toEqual([{ id: 1 }, { id: 1 }]);
  });

  it('attempts all provider cleanup and aggregates failures', async () => {
    let userDestroyed = false;
    const router = new TelegramCapabilityRouter({
      bot: {
        destroy: async () => {
          throw new Error('bot cleanup failed');
        },
      },
      mode: 'both',
      user: {
        destroy: async () => {
          userDestroyed = true;
          throw new Error('user cleanup failed');
        },
      },
    });
    const error = await capturedFailure(() => router.destroy());
    expect(error instanceof AggregateError).toBe(true);
    expect(error.errors.length).toBe(2);
    expect(userDestroyed).toBe(true);
  });
});

describe('Telegram user authentication', () => {
  it('validates partial credentials without network access', () => {
    let error;
    try {
      validateTelegramConfiguration({ apiHash: 'hash' });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('TELEGRAM_API_ID');
    expect(() =>
      validateTelegramConfiguration({ apiHash: 'hash', apiId: '1' })
    ).toThrow();
    expect(validateTelegramConfiguration({})).toEqual({ mode: 'bot-only' });
    expect(
      validateTelegramConfiguration({ apiId: '1', botToken: 'bot-token' })
    ).toEqual({
      mode: 'bot-only',
      userUnavailable:
        'Incomplete Telegram user credentials; missing TELEGRAM_API_HASH, TELEGRAM_USER_SESSION.',
    });
    expect(
      validateTelegramConfiguration({
        apiHash: 'hash',
        apiId: '1',
        botToken: 'bot-token',
        session: 'foreign',
        sessionFormat: 'gramjs/string-session-v1',
      })
    ).toEqual({
      mode: 'bot-only',
      userUnavailable:
        'Telegram session format gramjs/string-session-v1 cannot be converted losslessly. Re-login explicitly with mtcute, validate the pinned account, then revoke the old session.',
    });
    expect(
      validateTelegramConfiguration({
        apiHash: 'hash',
        apiId: '1',
        session: 's',
        sessionFormat: 'mtcute/session-string-v1',
      }).mode
    ).toBe('user-only');
  });

  it('logs in with hidden callbacks, pins identity, and saves a 0600 session outside LiNo', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'telegram-auth-'));
    const sessionFile = join(directory, 'secrets', 'telegram.session');
    const requested = [];
    let destroyed = 0;
    const client = {
      destroy: async () => {
        destroyed += 1;
      },
      exportSession: async () => 'exported-secret-session',
      getMe: async () => ({ id: 42, username: 'rental_bot' }),
      start: async (callbacks) => {
        requested.push(
          await callbacks.phone(),
          await callbacks.code(),
          await callbacks.password()
        );
      },
    };
    const service = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => client,
      expectedUserId: '42',
      prompt: async ({ label, secret }) => {
        expect(secret).toBe(true);
        return label === 'Phone'
          ? '+84123456789'
          : label === 'Code'
            ? '12345'
            : '2fa';
      },
      sessionFile,
    });
    try {
      const identity = await service.login();
      expect(identity).toEqual({ id: 42, username: 'rental_bot' });
      expect(requested).toEqual(['+84123456789', '12345', '2fa']);
      expect(sessionPayload(await readFile(sessionFile, 'utf8'))).toBe(
        'exported-secret-session'
      );
      if (process.platform !== 'win32') {
        expect((await stat(sessionFile)).mode & 0o777).toBe(0o600);
      }
      expect(destroyed).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects an unexpected identity and always destroys the client', async () => {
    let destroyed = false;
    const service = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => {
          destroyed = true;
        },
        getMe: async () => ({ id: 9 }),
        importSession: async () => {},
      }),
      expectedUserId: '10',
      session: 'existing',
    });
    let error;
    try {
      await service.validate();
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('identity mismatch');
    expect(destroyed).toBe(true);
  });

  it('routes auth CLI actions without constructing the application or accepting argv secrets', async () => {
    const calls = [];
    const output = [];
    const authFactory = (options) => ({
      login: async (input) => {
        calls.push({ input, options });
        await options.onSession?.('explicit-secret');
        return { id: 42, username: 'owner' };
      },
    });
    expect(
      await runCli(
        ['telegram', 'auth', 'login', '--phone', '+84123', '--session-stdout'],
        {
          authFactory,
          env: {
            TELEGRAM_API_HASH: 'hash',
            TELEGRAM_API_ID: '1',
            TELEGRAM_LOGIN_CODE: '12345',
          },
          stdout: (line) => output.push(line),
        }
      )
    ).toBe(0);
    expect(calls[0].input.code).toBe('12345');
    expect(calls[0].input.password).toBe(undefined);
    expect(output[0]).toContain('TELEGRAM_USER_SESSION=explicit-secret');

    const errors = [];
    expect(
      await runCli(['telegram', 'auth', 'login', '--password', 'leaked'], {
        authFactory,
        env: {},
        stderr: (line) => errors.push(line),
      })
    ).toBe(1);
    expect(errors[0]).toContain('never accepted');
    expect(
      await runCli(['telegram', 'auth', 'login', '--code', '12345'], {
        authFactory,
        env: {},
        stderr: (line) => errors.push(line),
      })
    ).toBe(1);
    expect(errors[1]).toContain('never accepted');

    let constructed = 0;
    expect(
      await runCli(['telegram', 'auth', 'login'], {
        authFactory: () => {
          constructed += 1;
          return {};
        },
        env: { TELEGRAM_API_HASH: 'hash', TELEGRAM_API_ID: '1' },
        stderr: (line) => errors.push(line),
      })
    ).toBe(1);
    expect(constructed).toBe(0);
    expect(errors.at(-1)).toContain('Choose --session-file');

    let statusOptions;
    expect(
      await runCli(['telegram', 'auth', 'status'], {
        authFactory: (options) => {
          statusOptions = options;
          return { status: async () => ({ configured: true }) };
        },
        env: {
          TELEGRAM_API_HASH: 'hash',
          TELEGRAM_API_ID: '1',
          TELEGRAM_USER_SESSION_FILE: '/run/secrets/telegram-session',
        },
        stdout: () => {},
      })
    ).toBe(0);
    expect(statusOptions.sessionFile).toBe('/run/secrets/telegram-session');
  });

  it('resolves mounted user secrets for auth and availability CLI paths', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'telegram-cli-secrets-'));
    const apiHashFile = join(directory, 'api-hash');
    const apiIdFile = join(directory, 'api-id');
    const sessionFile = join(directory, 'session');
    await writeFile(apiHashFile, 'hash-from-file\n');
    await writeFile(apiIdFile, '71\n');
    await writeFile(sessionFile, 'session-from-file\n');
    try {
      let authOptions;
      expect(
        await runCli(['telegram', 'auth', 'status'], {
          authFactory: (options) => {
            authOptions = options;
            return { status: async () => ({ configured: true }) };
          },
          env: {
            TELEGRAM_API_HASH_FILE: apiHashFile,
            TELEGRAM_API_ID_FILE: apiIdFile,
            TELEGRAM_USER_SESSION_FILE: sessionFile,
            TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
          },
          stdout: () => {},
        })
      ).toBe(0);
      expect(authOptions.apiHash).toBe('hash-from-file');
      expect(authOptions.apiId).toBe('71');
      expect(authOptions.sessionFile).toBe(sessionFile);

      let availabilityCredentials;
      expect(
        await runCli(['check-availability', 'offer-1', '@owner'], {
          application: {
            createAvailabilityService: (credentials) => {
              availabilityCredentials = credentials;
              return {
                check: async () => ({
                  offerId: 'offer-1',
                  recipient: '@owner',
                }),
              };
            },
          },
          env: {
            TELEGRAM_API_HASH_FILE: apiHashFile,
            TELEGRAM_API_ID_FILE: apiIdFile,
            TELEGRAM_USER_SESSION_FILE: sessionFile,
            TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
          },
          stdout: () => {},
        })
      ).toBe(0);
      expect(availabilityCredentials).toEqual({
        apiHash: 'hash-from-file',
        apiId: '71',
        session: 'session-from-file',
        sessionFormat: 'mtcute/session-string-v1',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('preflights identities with getMe only and checks storage and clink', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'telegram-preflight-'));
    const requests = [];
    let mirrorChecks = 0;
    try {
      const result = await preflightTelegram({
        authFactory: (options) => ({
          validate: async () => {
            expect(options.session).toBe('user-session');
            return { id: 7, username: 'owner' };
          },
        }),
        directory,
        env: {
          TELEGRAM_API_HASH: 'hash',
          TELEGRAM_API_ID: '1',
          TELEGRAM_BOT_TOKEN: 'bot-secret',
          TELEGRAM_EXPECTED_BOT_ID: '42',
          TELEGRAM_USER_SESSION: 'user-session',
          TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
        },
        fetchImpl: async (url) => {
          requests.push(url);
          return {
            json: async () => ({
              ok: true,
              result: { id: 42, username: 'search_bot' },
            }),
            ok: true,
            status: 200,
          };
        },
        mirror: {
          preflight: async () => {
            mirrorChecks += 1;
          },
        },
      });
      expect(result.mode).toBe('both');
      expect(result.identities.bot.id).toBe(42);
      expect(result.identities.user.id).toBe(7);
      expect(result.capabilities.effectiveMode).toBe('both');
      expect(result.capabilities.user.state).toBe('ready');
      expect(requests).toEqual([
        'https://api.telegram.org/botbot-secret/getMe',
      ]);
      expect(requests[0]).not.toContain('getUpdates');
      expect(mirrorChecks).toBe(1);

      const userOnly = await preflightTelegram({
        authFactory: () => ({
          validate: async () => ({ id: 7, username: 'owner' }),
        }),
        directory,
        env: {
          TELEGRAM_API_HASH: 'hash',
          TELEGRAM_API_ID: '1',
          TELEGRAM_USER_SESSION: 'user-session',
          TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
        },
        fetchImpl: async () => {
          throw new Error('user-only preflight must not call the Bot API');
        },
      });
      expect(userOnly.mode).toBe('user-only');
      expect(userOnly.capabilities).toEqual({
        bot: { available: false, state: 'not-configured' },
        effectiveMode: 'user-only',
        user: { available: true, state: 'ready' },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('degrades combined preflight without trial-importing foreign or revoked sessions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-degraded-'));
    const fetchImpl = async () => ({
      json: async () => ({ ok: true, result: { id: 42 } }),
      ok: true,
      status: 200,
    });
    try {
      let foreignClients = 0;
      const foreign = await preflightTelegram({
        authFactory: () => {
          foreignClients += 1;
          return { validate: async () => ({ id: 7 }) };
        },
        directory,
        env: {
          TELEGRAM_API_HASH: 'hash',
          TELEGRAM_API_ID: '1',
          TELEGRAM_BOT_TOKEN: 'bot-secret',
          TELEGRAM_USER_SESSION: 'foreign-session',
          TELEGRAM_USER_SESSION_FORMAT: 'teleproto/string-session-v1',
        },
        fetchImpl,
      });
      expect(foreignClients).toBe(0);
      expect(foreign.mode).toBe('bot-only');
      expect(foreign.capabilities.user).toEqual({
        available: false,
        reason: 'foreign-session-format',
        state: 'relogin-required',
      });

      const revoked = new Error('the private session must never be echoed');
      revoked.code = 'SESSION_REVOKED';
      const expired = await preflightTelegram({
        authFactory: () => ({
          validate: async () => {
            throw revoked;
          },
        }),
        directory,
        env: {
          TELEGRAM_API_HASH: 'hash',
          TELEGRAM_API_ID: '1',
          TELEGRAM_BOT_TOKEN: 'bot-secret',
          TELEGRAM_USER_SESSION: 'native-secret',
          TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
        },
        fetchImpl,
      });
      expect(expired.mode).toBe('bot-only');
      expect(expired.capabilities.user).toEqual({
        available: false,
        reason: 'SESSION_REVOKED',
        state: 'expired-or-revoked',
      });
      expect(JSON.stringify(expired)).not.toContain('native-secret');
      expect(JSON.stringify(expired)).not.toContain('must never be echoed');

      const mismatch = await capturedFailure(() =>
        preflightTelegram({
          authFactory: () => ({
            validate: async () => {
              throw new Error(
                'Telegram identity mismatch: expected 7, received 8.'
              );
            },
          }),
          directory,
          env: {
            TELEGRAM_API_HASH: 'hash',
            TELEGRAM_API_ID: '1',
            TELEGRAM_BOT_TOKEN: 'bot-secret',
            TELEGRAM_USER_SESSION: 'native-secret',
            TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
          },
          fetchImpl,
        })
      );
      expect(mismatch.message).toContain('identity mismatch');
      expect(mismatch.message).not.toContain('expected 7');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('requires a declared format for raw sessions and keeps user-only fail-closed', async () => {
    let constructed = 0;
    const directory = await mkdtemp(join(tmpdir(), 'telegram-format-'));
    const fetchImpl = async () => ({
      json: async () => ({ ok: true, result: { id: 42 } }),
      ok: true,
      status: 200,
    });
    try {
      const degraded = await preflightTelegram({
        authFactory: () => {
          constructed += 1;
          return { validate: async () => ({ id: 7 }) };
        },
        directory,
        env: {
          TELEGRAM_API_HASH: 'hash',
          TELEGRAM_API_ID: '1',
          TELEGRAM_BOT_TOKEN: 'bot-secret',
          TELEGRAM_USER_SESSION: 'undeclared-raw-session',
        },
        fetchImpl,
      });
      expect(constructed).toBe(0);
      expect(degraded.capabilities.user.state).toBe('format-required');

      const missingFormat = await capturedFailure(() =>
        preflightTelegram({
          authFactory: () => {
            constructed += 1;
            return { validate: async () => ({ id: 7 }) };
          },
          directory,
          env: {
            TELEGRAM_API_HASH: 'hash',
            TELEGRAM_API_ID: '1',
            TELEGRAM_USER_SESSION: 'undeclared-raw-session',
          },
          fetchImpl,
        })
      );
      expect(missingFormat.message).toContain('format');

      const revoked = new Error('secret-bearing remote failure');
      revoked.code = 'SESSION_REVOKED';
      const revokedFailure = await capturedFailure(() =>
        preflightTelegram({
          authFactory: () => ({
            validate: async () => Promise.reject(revoked),
          }),
          directory,
          env: {
            TELEGRAM_API_HASH: 'hash',
            TELEGRAM_API_ID: '1',
            TELEGRAM_USER_SESSION: 'native-secret',
            TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
          },
          fetchImpl,
        })
      );
      expect(revokedFailure.message).toContain('SESSION_REVOKED');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps Bot API capability available when user credentials are partial', async () => {
    let constructed = 0;
    const errors = [];
    expect(
      await runCli(['bot'], {
        application: {
          createBot: async (_token, credentials) => {
            constructed += 1;
            expect(credentials).toEqual({
              apiHash: undefined,
              apiId: undefined,
              session: undefined,
              sessionFormat: 'mtcute/session-string-v1',
            });
            throw new Error('stop after bot construction');
          },
        },
        env: {
          TELEGRAM_API_ID: '1',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        stderr: (line) => errors.push(line),
      })
    ).toBe(1);
    expect(constructed).toBe(1);
    expect(errors[0]).toContain('continuing in bot-only mode');
    expect(errors[0]).toContain('TELEGRAM_API_HASH');
    expect(errors[1]).toBe('stop after bot construction');
  });

  it('still rejects broken user credentials for ingest-only mode', async () => {
    const errors = [];
    expect(
      await runCli(['telegram', 'ingest'], {
        application: {},
        env: {
          TELEGRAM_API_ID: '1',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        stderr: (line) => errors.push(line),
      })
    ).toBe(1);
    expect(errors[0]).toContain('TELEGRAM_API_HASH');
  });

  it('degrades a combined runtime to bot-only after MTProto startup fails', async () => {
    // The runtime health probe binds a local port. Deno CI deliberately omits
    // --allow-net, while Node and Bun exercise this integration path.
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const errors = [];
    let resolvePolling;
    let destroyed = 0;
    const bot = {
      api: { getMe: async () => ({ id: 1 }) },
      start: ({ onStart }) => {
        onStart();
        return new Promise((resolve) => {
          resolvePolling = resolve;
        });
      },
      stop: () => resolvePolling?.(),
    };
    const running = runCli(['bot'], {
      application: {
        createBot: async () => bot,
        createTelegramIngestionService: () => ({
          destroy: async () => {
            destroyed += 1;
            throw new Error('session=cleanup-secret failed');
          },
          start: async () => {
            throw new Error('session=startup-secret expired');
          },
        }),
        registry: { list: async () => [] },
      },
      env: {
        HEALTH_PORT: '0',
        TELEGRAM_API_HASH: 'hash',
        TELEGRAM_API_ID: '1',
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_USER_SESSION: 'session',
        TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
      },
      stderr: (line) => errors.push(line),
    });
    while (!bot.runtime || bot.runtime.health().status !== 'ready') {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await bot.runtime.stop('test');

    expect(await running).toBe(0);
    expect(destroyed).toBe(1);
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain('continuing in bot-only mode');
    expect(errors[0]).not.toContain('startup-secret');
    expect(errors[1]).toContain('cleanup failed');
    expect(errors[1]).not.toContain('cleanup-secret');
  });
});

describe('Telegram numeric access policy', () => {
  it('fails privileged commands closed and rate-limits public search per identity', () => {
    let now = 0;
    const policy = new TelegramAccessPolicy({
      allowedUserIds: ['7', '@name', 'not-a-number'],
      mode: 'public',
      now: () => now,
      publicLimit: 1,
      publicWindowMs: 1000,
    });
    const context = {
      chat: { id: -100 },
      from: { id: 8, username: 'allowed-looking' },
    };
    let error;
    try {
      policy.authorize(context, { privileged: true });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('not authorized');
    policy.authorize(context, { action: 'search' });
    try {
      policy.authorize(context, { action: 'search' });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('rate limit');
    now = 1000;
    expect(policy.authorize(context, { action: 'search' }).userId).toBe('8');
    expect(
      policy.authorize({ from: { id: 7 } }, { privileged: true }).userId
    ).toBe('7');
  });

  it('requires an allowlist for all commands in private mode', () => {
    const policy = new TelegramAccessPolicy({ mode: 'private' });
    let error;
    try {
      policy.authorize({ from: { id: 1 } });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('private');
  });
});
