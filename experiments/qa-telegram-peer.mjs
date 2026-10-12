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

// GetMe pins the bot independently. Prefer that exact existing owner dialog's
// native entity/access hash; a username RPC is unnecessary for a known peer.
// Callers must retain their ordinary bounded driver-operation deadline.
export async function resolveVerifiedQaBotPeer(client, identity, expectedId) {
  const username = verifiedQaBotPeer(identity, expectedId);
  for await (const dialog of client.iterDialogs({ archived: undefined })) {
    if (String(dialog.entity?.id) === String(expectedId)) {
      assert.equal(dialog.entity.bot, true, 'QA peer is not a bot');
      return dialog.entity;
    }
  }
  const entity = await client.getEntity(username);
  assert.equal(String(entity.id), String(expectedId), 'QA peer mismatch');
  assert.equal(entity.bot, true, 'QA peer is not a bot');
  return entity;
}

export async function resolveVerifiedNativeQaBotPeer(
  client,
  identity,
  expectedId
) {
  const username = verifiedQaBotPeer(identity, expectedId);
  for await (const dialog of client.iterDialogs({ archived: 'keep' })) {
    const peer = dialog.peer;
    if (String(peer?.id) === String(expectedId)) {
      assert.equal(peer.type, 'user', 'QA peer is not a user');
      assert.equal(peer.isBot, true, 'QA peer is not a bot');
      const input = peer.inputPeer;
      assert.equal(input._, 'inputPeerUser', 'QA peer is incomplete');
      assert.equal(
        String(input.userId),
        String(expectedId),
        'QA peer mismatch'
      );
      return input;
    }
  }
  const input = await client.resolvePeer(username, true);
  assert.equal(input._, 'inputPeerUser', 'QA peer is not a user');
  assert.equal(String(input.userId), String(expectedId), 'QA peer mismatch');
  return input;
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
