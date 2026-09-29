import { describe, expect, it } from 'test-anywhere';

import {
  assertDegradedToBotOnly,
  assertPinnedIdentity,
  countLeftovers,
  degradedRuntimeEnvironment,
  requireIdentityPins,
} from '../experiments/telegram-e2e-identities.mjs';
import { validateTelegramConfiguration } from '../src/telegram-auth.js';

function message(action) {
  try {
    action();
  } catch (error) {
    return error.message;
  }
  return undefined;
}

const bot = { TELEGRAM_E2E_EXPECTED_BOT_ID: '1000001' };
const driver = { TELEGRAM_E2E_EXPECTED_USER_ID: '2000002' };
const runtimeUser = { TELEGRAM_EXPECTED_USER_ID: '3000003' };

describe('manual Telegram E2E identity pins', () => {
  it('requires a distinct numeric pin for every role in the mode', () => {
    expect(requireIdentityPins({ bot, driver, mode: 'bot-only' })).toEqual({
      bot: '1000001',
      driver: '2000002',
    });
    expect(
      requireIdentityPins({ bot, driver, mode: 'both', runtimeUser })
    ).toEqual({
      bot: '1000001',
      driver: '2000002',
      'runtime user': '3000003',
    });
    expect(
      requireIdentityPins({
        bot: { TELEGRAM_EXPECTED_BOT_ID: '1000001' },
        driver: { TELEGRAM_EXPECTED_USER_ID: '2000002' },
        mode: 'degraded',
      })
    ).toEqual({ bot: '1000001', driver: '2000002' });
  });

  it('fails closed on an absent, malformed, or shared pin without printing it', () => {
    expect(message(() => requireIdentityPins({ driver, mode: 'both' }))).toBe(
      'The bot identity pin is required (TELEGRAM_E2E_EXPECTED_BOT_ID or TELEGRAM_EXPECTED_BOT_ID).'
    );
    expect(
      message(() => requireIdentityPins({ bot, driver, mode: 'both' }))
    ).toContain('The runtime user identity pin is required');
    expect(
      message(() =>
        requireIdentityPins({
          bot,
          driver: { TELEGRAM_E2E_EXPECTED_USER_ID: '@driver' },
          mode: 'bot-only',
        })
      )
    ).toBe('The driver identity pin must be a numeric Telegram ID.');
    const shared = message(() =>
      requireIdentityPins({
        bot,
        driver,
        mode: 'both',
        runtimeUser: { TELEGRAM_EXPECTED_USER_ID: '2000002' },
      })
    );
    expect(shared).toBe(
      'The runtime user and driver identity pins must name different accounts.'
    );
    expect(shared).not.toContain('2000002');
    expect(
      message(() => requireIdentityPins({ bot, driver, mode: 'user-only' }))
    ).toContain('--mode must be');
  });

  it('compares an observed identity with its pin', () => {
    expect(assertPinnedIdentity('bot', '1000001', 1000001)).toBe('1000001');
    expect(message(() => assertPinnedIdentity('bot', '1000001', '9'))).toBe(
      'Telegram bot identity pin mismatch.'
    );
    expect(
      message(() => assertPinnedIdentity('test-user', '2000002', undefined))
    ).toBe('Telegram test-user identity pin mismatch.');
  });

  it('configures a degraded runtime that the application runs bot-only', () => {
    const { TELEGRAM_API_HASH: apiHash, TELEGRAM_API_ID: apiId } =
      degradedRuntimeEnvironment();
    const configuration = validateTelegramConfiguration({
      apiHash,
      apiId,
      botToken: '1000001:synthetic',
    });
    expect(configuration.mode).toBe('bot-only');
    expect(configuration.userUnavailable).toContain('TELEGRAM_USER_SESSION');
    expect(
      assertDegradedToBotOnly(
        'stderr: Telegram user capability unavailable; continuing in bot-only mode: …'
      )
    ).toBe(true);
    expect(message(() => assertDegradedToBotOnly('stdout: ready'))).toContain(
      'did not report continuing bot-only'
    );
  });

  it('counts only messages newer than the run boundary as leftovers', () => {
    const messages = [{ id: 4 }, { id: 5 }, { id: 9 }];
    expect(countLeftovers(messages, 5, (item) => item.id)).toBe(1);
    expect(countLeftovers(messages, 9, (item) => item.id)).toBe(0);
  });
});
