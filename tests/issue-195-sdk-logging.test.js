import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { createMtcuteClient } from '../src/telegram-user.js';
import { installTelegramSdkLogging } from '../src/telegram-sdk-logging.js';

describe('SDK log privacy and shutdown', () => {
  it('captures real installed SDK logs and destroys without connecting', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const calls = [];
    const logger = {
      warn: (...args) => calls.push(['warn', ...args]),
      debug: (...args) => calls.push(['debug', ...args]),
    };
    const client = await createMtcuteClient({
      apiId: 1,
      apiHash: '0'.repeat(32),
      logger,
    });
    try {
      client.log.prefix = '[USER 987654321] ';
      client.log
        .create('updates')
        .warn(
          'error fetching common difference: %e',
          new Error('Session is reset')
        );
      assert.equal(calls[0][0], 'warn');
      assert.equal(calls[0][2].category, 'session-loss');
      assert(!JSON.stringify(calls).includes('987654321'));
    } finally {
      await client.destroy();
    }
  });

  it('downgrades only expected shutdown cancellation and retains revoked sessions', async () => {
    const calls = [];
    const logger = Object.fromEntries(
      ['warn', 'error', 'debug'].map((level) => [
        level,
        (_message, data) => calls.push({ level, ...data }),
      ])
    );
    const client = {
      log: {},
      destroy: async () => {
        client.log.handler(
          0,
          2,
          'updates',
          '[USER 987654321] Session is reset',
          []
        );
        client.log.handler(0, 1, 'updates', 'SESSION_REVOKED', []);
      },
    };
    installTelegramSdkLogging(client, logger);
    await client.destroy();
    assert.deepEqual(calls, [
      { level: 'debug', category: 'shutdown-cancellation', stage: 'updates' },
      { level: 'error', category: 'session-loss', stage: 'updates' },
    ]);
  });
});
