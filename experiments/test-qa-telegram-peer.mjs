import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  resolveVerifiedQaBotPeer,
  resolveVerifiedNativeQaBotPeer,
} from './qa-telegram-peer.mjs';

const identity = { id: '12345', username: 'self_authored_qa_bot' };

function driver(entities, resolved) {
  return {
    async *iterDialogs() {
      for (const entity of entities) {
        yield { entity };
      }
    },
    getEntity() {
      assert(resolved, 'Unexpected username lookup');
      return Promise.resolve(resolved);
    },
  };
}

describe('independently pinned existing QA bot peer', () => {
  it('uses only the exact pinned native bot entity without username lookup', async () => {
    const bot = { id: 12345, bot: true, accessHash: 'self-authored' };
    assert.equal(
      await resolveVerifiedQaBotPeer(
        driver([{ id: 67890, bot: true }, bot]),
        identity,
        '12345'
      ),
      bot
    );
  });

  it('checks GetMe before accessing any dialogs', async () => {
    await assert.rejects(
      resolveVerifiedQaBotPeer({}, identity, '67890'),
      /identity mismatch/u
    );
  });

  it('refuses a matching non-bot peer', async () => {
    await assert.rejects(
      resolveVerifiedQaBotPeer(
        driver([{ id: 12345, bot: false }]),
        identity,
        '12345'
      ),
      /not a bot/u
    );
  });

  it('requires the pinned identity for username fallback', async () => {
    await assert.rejects(
      resolveVerifiedQaBotPeer(
        driver([], { id: 67890, bot: true }),
        identity,
        '12345'
      ),
      /peer mismatch/u
    );
    const bot = { id: 12345, bot: true };
    assert.equal(
      await resolveVerifiedQaBotPeer(driver([], bot), identity, '12345'),
      bot
    );
  });

  it('uses the actual native input peer without resolving a username', async () => {
    const input = { _: 'inputPeerUser', userId: 12345, accessHash: 'fixture' };
    const client = {
      async *iterDialogs() {
        yield {
          peer: { id: 12345, type: 'user', isBot: true, inputPeer: input },
        };
      },
    };
    assert.equal(
      await resolveVerifiedNativeQaBotPeer(client, identity, '12345'),
      input
    );
  });

  it('rejects an incomplete native peer before sending', async () => {
    const client = {
      async *iterDialogs() {
        yield {
          peer: {
            id: 12345,
            type: 'user',
            isBot: true,
            inputPeer: { _: 'mtcute.dummyInputPeerMinUser', userId: 12345 },
          },
        };
      },
    };
    await assert.rejects(
      resolveVerifiedNativeQaBotPeer(client, identity, '12345'),
      /incomplete/u
    );
  });
});
