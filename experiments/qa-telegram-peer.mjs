// A verified bot username can resolve in a fresh native entity cache;
// a bare numeric user ID cannot provide its missing access hash.
import assert from 'node:assert/strict';
import { TelegramAccessPolicy } from '../src/telegram-access.js';

export function verifiedQaBotPeer(identity, expectedId) {
  assert.equal(
    String(identity.id),
    String(expectedId),
    'QA bot identity mismatch'
  );
  assert(/^[A-Za-z][A-Za-z\d_]{4,31}$/u.test(identity.username || ''));
  return `@${identity.username}`;
}

export function assertQaDriverAccess(environment, owner) {
  const policy = new TelegramAccessPolicy({
    allowedChatIds: [environment.TELEGRAM_ALLOWED_CHAT_IDS],
    allowedUserIds: [environment.TELEGRAM_ALLOWED_USER_IDS],
    mode: environment.TELEGRAM_ACCESS_MODE || 'private',
  });
  policy.authorize(
    { from: { id: owner }, chat: { id: owner } },
    { privileged: true }
  );
}
