import { describe, expect, it } from 'test-anywhere';

import {
  CAPABILITY_SCENARIOS,
  evaluateCapabilityScenario,
  lostResponseError,
  parseCapabilityArguments,
  publicUsername,
  recordingProvider,
  requireNativeSessionFormat,
  summarizeCalls,
} from '../experiments/telegram-capability-e2e-lib.mjs';
import {
  BotApiTelegramProvider,
  TelegramCapabilityRouter,
} from '../src/index.js';

function message(action) {
  try {
    action();
  } catch (error) {
    return error.message;
  }
  return undefined;
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

const required = [
  '--bot-env',
  'bot.env',
  '--user-env',
  'user.env',
  '--driver-env',
  'driver.env',
  '--source',
  't.me_is_not_a_name',
];

function fakeBot(sent) {
  return new BotApiTelegramProvider({
    getChatMemberCount: async () => 3,
    getMe: async () => ({ id: 1 }),
    sendMessage: async (destination) => {
      if (String(destination).startsWith('@')) {
        throw { description: 'Bad Request: chat not found', error_code: 400 };
      }
      sent.push(['bot', destination]);
      return { message_id: 7 };
    },
  });
}

function fakeUser(sent) {
  return {
    capabilities: new Set(['history', 'identity', 'send']),
    history: async () => [],
    identity: async () => ({ id: 2 }),
    send: async (destination) => {
      sent.push(['user', destination]);
      return { id: 8 };
    },
    transport: 'mtproto',
  };
}

describe('native mtcute capability E2E (#56)', () => {
  it('parses a bounded manual run against one public source', () => {
    const values = [...required];
    values[7] = '@public_source';
    const options = parseCapabilityArguments(values);
    expect(options.source).toBe('@public_source');
    expect(options.scenarios).toEqual(CAPABILITY_SCENARIOS);
    expect(options.timeoutMs).toBe(60_000);
    expect(
      parseCapabilityArguments([...values, '--scenarios', 'fallback']).scenarios
    ).toEqual(['fallback']);
    expect(parseCapabilityArguments(['--help']).help).toBe(true);
    expect(message(() => parseCapabilityArguments(required))).toBe(
      '--source must be a public channel @username.'
    );
    expect(message(() => parseCapabilityArguments(values.slice(2)))).toContain(
      'are required'
    );
    expect(
      message(() => parseCapabilityArguments([...values, '--scenarios', 'x']))
    ).toContain('--scenarios must list');
    expect(
      message(() => parseCapabilityArguments([...values, '--timeout-ms', '1']))
    ).toContain('--timeout-ms must be between');
    expect(message(() => parseCapabilityArguments(['--source']))).toBe(
      'Unknown or incomplete option: --source'
    );
    expect(publicUsername('owner_name')).toBe('@owner_name');
    expect(publicUsername('')).toBe(undefined);
  });

  it('refuses a runtime session that is not declared native', () => {
    expect(
      requireNativeSessionFormat({
        TELEGRAM_USER_SESSION_FORMAT: 'mtcute/session-string-v1',
      })
    ).toBe('mtcute/session-string-v1');
    for (const format of ['', 'gramjs/string-session-v1']) {
      expect(
        message(() =>
          requireNativeSessionFormat({ TELEGRAM_USER_SESSION_FORMAT: format })
        )
      ).toContain('not converted');
    }
  });

  it('passes bot-first routing with a fallback only before a send', async () => {
    const calls = [];
    const sent = [];
    const bot = recordingProvider(fakeBot(sent), { calls });
    const user = recordingProvider(fakeUser(sent), { calls });
    const router = new TelegramCapabilityRouter({ bot, mode: 'both', user });
    await router.identity();
    await router.history({ username: '@public_source' });
    await router.send(5, 'hello');
    await router.send('@owner_name', 'still free?');
    await router.destroy();
    expect(sent).toEqual([
      ['bot', 5],
      ['user', '@owner_name'],
    ]);
    expect(summarizeCalls(calls)).toEqual({
      history: ['mtproto:ok'],
      identity: ['bot-api:ok'],
      send: ['bot-api:ok', 'bot-api:entity', 'mtproto:ok'],
    });
    expect(
      evaluateCapabilityScenario({
        botCapabilities: new Set(['identity', 'popularity', 'send']),
        calls,
        cleanup: {
          clients: {
            bot: { created: 1, destroyed: bot.destroyed },
            user: { created: 1, destroyed: user.destroyed },
          },
          leftovers: 0,
        },
        deliveries: { send: 1 },
        name: 'combined',
        steps: [
          { name: 'identity', ok: true },
          { name: 'history', ok: true },
        ],
      })
    ).toEqual([
      'resolveEntity failed or did not run',
      'popularity failed or did not run',
      'membership failed or did not run',
      'media failed or did not run',
      'liveUpdates failed or did not run',
      'send failed or did not run',
      'availability failed or did not run',
      'restartIdempotency failed or did not run',
    ]);
    expect(
      evaluateCapabilityScenario({
        calls: calls.slice(3),
        name: 'fallback',
        steps: [{ name: 'send', ok: true }],
      })
    ).toEqual([]);
  });

  it('never reroutes a send whose response was lost', async () => {
    const calls = [];
    const sent = [];
    const router = new TelegramCapabilityRouter({
      bot: recordingProvider(fakeBot(sent), {
        afterSend: lostResponseError,
        calls,
      }),
      mode: 'both',
      retryOptions: { sleep: async () => {} },
      user: recordingProvider(fakeUser(sent), { calls }),
    });
    const error = await rejection(router.send(5, 'hello'));
    expect(error.code).toBe('ETIMEDOUT');
    expect(sent).toEqual([['bot', 5]]);
    expect(summarizeCalls(calls)).toEqual({
      send: ['bot-api:transport:injected'],
    });
    expect(
      evaluateCapabilityScenario({
        calls,
        deliveries: { 'ambiguous-send': 1 },
        name: 'ambiguous-send',
        steps: [{ category: 'transport', name: 'send', ok: false }],
      })
    ).toEqual([]);
  });

  it('reports every broken routing, delivery, and cleanup invariant', () => {
    const botCapabilities = new Set(['send']);
    expect(
      evaluateCapabilityScenario({
        botCapabilities,
        calls: [
          { capability: 'send', outcome: 'malformed', transport: 'bot-api' },
          { capability: 'send', outcome: 'ok', transport: 'mtproto' },
          {
            capability: 'send',
            injected: true,
            outcome: 'transport',
            transport: 'bot-api',
          },
          { capability: 'send', outcome: 'ok', transport: 'mtproto' },
        ],
        cleanup: {
          clients: { user: { created: 2, destroyed: 1 } },
          leftovers: 3,
        },
        deliveries: { send: 2 },
        name: 'ambiguous-send',
        steps: [{ name: 'send', ok: true }],
      })
    ).toEqual([
      'send did not fail closed',
      'send reached the user client without a pre-send bot failure',
      'send reached the user client without a pre-send bot failure',
      'an ambiguous send fell back to the user client',
      'the ambiguous send was retried or rerouted',
      'send arrived 2 times',
      'the user client was not destroyed',
      '3 test messages were left behind',
    ]);
    expect(
      evaluateCapabilityScenario({
        calls: [
          { capability: 'identity', outcome: 'ok', transport: 'bot-api' },
        ],
        name: 'user-only',
        steps: [{ category: 'auth', name: 'identity', ok: false }],
      }).slice(0, 2)
    ).toEqual([
      'identity failed (auth)',
      'resolveEntity failed or did not run',
    ]);
    expect(
      evaluateCapabilityScenario({
        calls: [
          { capability: 'identity', outcome: 'ok', transport: 'bot-api' },
        ],
        name: 'user-only',
        steps: [],
      }).at(-1)
    ).toBe('identity used the bot in user-only mode');
    expect(
      evaluateCapabilityScenario({
        calls: [{ capability: 'send', outcome: 'ok', transport: 'bot-api' }],
        name: 'fallback',
        steps: [{ name: 'send', ok: true }],
      })
    ).toEqual(['the send did not fall back from the bot to the user']);
    expect(
      evaluateCapabilityScenario({
        name: 'degraded',
        steps: [
          { name: 'identity', ok: true },
          { name: 'resolveEntity', ok: true },
          { name: 'popularity', ok: true },
          { name: 'send', ok: true },
          { category: 'unknown', name: 'history', ok: false },
          { name: 'liveUpdates', ok: true },
        ],
      })
    ).toEqual(['liveUpdates did not fail closed']);
  });
});
