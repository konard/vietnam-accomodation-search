import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { assertQaDriverAccess } from '../experiments/qa-telegram-peer.mjs';

it('uses configured access settings for privileged owner commands', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const { runtimeEnvironment } =
    await import('../experiments/telegram-bot-conversation-e2e.mjs');
  const originalEnvironment = {
    TELEGRAM_ACCESS_MODE: 'private',
    TELEGRAM_ALLOWED_USER_IDS: '1',
    TELEGRAM_ALLOWED_CHAT_IDS: '1',
  };
  const environment = runtimeEnvironment({
    bot: { token: '2:synthetic', identity: { id: 2 } },
    originalEnvironment,
    mode: 'bot-only',
    dataDirectory: 'synthetic',
    port: 1234,
  });
  assert.equal(environment.TELEGRAM_ALLOWED_USER_IDS, '1');
  assertQaDriverAccess(environment, 1);
  assert.throws(() => assertQaDriverAccess(environment, 3));
  const empty = runtimeEnvironment({
    bot: { token: '2:synthetic', identity: { id: 2 } },
    originalEnvironment: {},
    mode: 'bot-only',
    dataDirectory: 'synthetic',
    port: 1234,
  });
  assert.throws(() => assertQaDriverAccess(empty, 1));
});
