/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings:true}] -- Fixed dates are synthetic test inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installCombinedProbes } from '../experiments/qa-combined-probes.mjs';
import {
  nativeDriverAdapter,
  connectNativeDriver,
} from '../experiments/qa-native-driver.mjs';
it('records separate transport observations and stops the native subscription', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'vac-transports-'));
  const marker = 'qa-conversation-abcd1234';
  const path = join(directory, 'proof.json');
  let middleware;
  let stopped = false;
  let handler;
  const restore = installCombinedProbes({ marker, owner: 1, path });
  try {
    const bot = {
      api: { getMe: async () => ({ id: 2 }) },
      use: (fn) => {
        middleware = fn;
      },
    };
    const user = {
      identity: async () => ({ id: 1 }),
      liveUpdates: async (fn) => {
        handler = fn;
        return {
          stop: () => {
            stopped = true;
          },
        };
      },
      send: async (_peer, text) => {
        handler({ message: { text } });
        return { id: 12 };
      },
      history: async () =>
        (async function* () {
          yield { text: `native-probe:${marker}` };
        })(),
      destroy: async () => {},
    };
    globalThis[Symbol.for('vac.qa.capabilityBoundary')](bot, { user });
    await middleware(
      {
        chat: { id: 1 },
        message: { text: `/qa_transport_${marker}` },
        reply: async () => {},
      },
      () => assert.fail('Probe was not handled')
    );
    const proof = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(proof.nativeHistory, true);
    assert.equal(proof.botApiIngress, true);
    assert.equal(proof.nativeSelfUpdate, true);
    assert.equal(proof.crossAccountAcceptance, false);
    assert.equal(stopped, true);
  } finally {
    restore();
    await rm(directory, { recursive: true, force: true });
  }
});
it('adapts native pagination and message ownership without mixing Bot API IDs', async () => {
  let query;
  let removed;
  const driver = nativeDriverAdapter({
    getHistory: async (_peer, options) => {
      query = options;
      return [
        {
          id: 42,
          text: 'synthetic',
          date: new Date('2026-10-12'),
          isOutgoing: true,
          sender: { id: 1 },
        },
      ];
    },
    deleteMessagesById: async (_peer, ids) => {
      removed = ids;
    },
  });
  const messages = await driver.getMessages(2, { minId: 10, offsetId: 50 });
  assert.equal(query.offset.id, 50);
  assert.equal(messages[0].out, true);
  await driver.deleteMessages(2, [42], { revoke: true });
  assert.deepEqual(removed, [42]);
});

it('destroys a native connection that exceeds its deadline', async () => {
  let destroyed = false;
  let settle;
  await assert.rejects(
    connectNativeDriver(
      { session: 'synthetic', format: 'mtcute/session-string-v1' },
      {
        timeoutMs: 10,
        factory: async () => ({
          start: () =>
            new Promise((resolve) => {
              settle = resolve;
            }),
          destroy: async () => {
            destroyed = true;
            settle?.();
          },
          getMe: async () =>
            assert.fail('Cancelled startup must not authenticate'),
        }),
      }
    ),
    /timed out/u
  );
  assert.equal(destroyed, true);
});
