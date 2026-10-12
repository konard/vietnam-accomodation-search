import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  QaOwnedMessages,
  isKnownQaMessage,
} from '../experiments/qa-owned-messages.mjs';

it('recognizes unmarked replies for audit, but deletes only exact sender/run/time/sequence evidence', async () => {
  const text =
    'Preset drill-abcd1234-2 does not exist.\nUsage: /preset show NAME';
  assert.equal(isKnownQaMessage(text), true);
  const ledger = new QaOwnedMessages({
    marker: 'qa-drill-abcd1234',
    baseline: 10,
    replyProof: {
      run: 'abcd1234',
      senderId: 123,
      startedAt: 100,
      endedAt: 200,
      sequences: [2],
    },
  });
  const valid = { id: 11, message: text, date: 150, fromId: { userId: 123 } };
  assert.equal(ledger.owns(valid), true);
  for (const message of [
    { ...valid, date: 99 },
    { ...valid, fromId: { userId: 124 } },
    { ...valid, message: text.replace('-2 ', '-3 ') },
    { ...valid, message: text.replace('abcd1234', 'abcd1235') },
  ]) {
    assert.equal(ledger.owns(message), false);
  }
  let messages = [valid, { id: 12, message: 'unrelated chat' }];
  assert.equal(
    (
      await ledger.cleanup({
        read: async () => messages,
        remove: async (ids) => {
          messages = messages.filter((message) => !ids.includes(message.id));
        },
      })
    ).pass,
    true
  );
  assert.equal(messages[0].message, 'unrelated chat');
  const audit = new QaOwnedMessages({
    marker: 'qa-drill-abcd1234',
    baseline: 10,
  });
  assert.equal(
    (
      await audit.cleanup({
        read: async () => [valid],
        remove: async () => assert.fail('No regex-only deletion'),
      })
    ).pass,
    false
  );
});

it('attaches the boundary to an actual API class field and a context API', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const { installQaApiBoundary } =
    await import('../experiments/qa-bot-preload.mjs');
  const restore = installQaApiBoundary({
    marker: 'qa-conversation-abcd1234',
    owner: 123,
  });
  try {
    const transforms = [];
    class Api {
      config = { use: (transform) => transforms.push(transform) };
    }
    const middleware = [];
    const bot = { api: new Api(), use: (fn) => middleware.push(fn) };
    globalThis[Symbol.for('vac.qa.botBoundary')](bot);
    assert.equal(bot.qaBoundaryInstalled, true);
    let payload;
    await transforms[0](
      async (_method, value) => {
        payload = value;
        return { ok: true, result: { message_id: 1 } };
      },
      'sendMessage',
      { chat_id: 123, text: 'real response' }
    );
    assert.equal(payload.text, 'qa-conversation-abcd1234\nreal response');
    const context = {
      api: new Api(),
      chat: { id: 123 },
      message: { text: '/start\nqa-conversation-abcd1234' },
    };
    await middleware[0](context, async () => {});
    assert.equal(context.message.text, '/start');
    assert.equal(transforms.length, 2);
  } finally {
    restore();
  }
});

it('marks sends from the installed ESM API and rejects an unrelated recipient', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const { Api } = await import('grammy');
  const { installQaApiBoundary } =
    await import('../experiments/qa-bot-preload.mjs');
  const payloads = [];
  const options = {
    fetch: async (_url, request) => {
      payloads.push(JSON.parse(request.body));
      return new globalThis.Response(
        JSON.stringify({ ok: true, result: { message_id: payloads.length } })
      );
    },
  };
  const restore = installQaApiBoundary({
    marker: 'qa-conversation-abcd1234',
    owner: 123,
  });
  try {
    const middleware = [];
    const api = new Api('2:synthetic', options);
    globalThis[Symbol.for('vac.qa.botBoundary')]({
      api,
      use: (fn) => middleware.push(fn),
    });
    await api.sendMessage(123, 'direct response');
    const context = {
      api: new Api('2:synthetic', options),
      chat: { id: 123 },
      message: { text: '/start\nqa-conversation-abcd1234' },
    };
    await middleware[0](context, async () => {});
    await context.api.sendMessage(123, 'context response');
    assert.equal(context.message.text, '/start');
    assert.deepEqual(
      payloads.map((payload) => payload.text),
      [
        'qa-conversation-abcd1234\ndirect response',
        'qa-conversation-abcd1234\ncontext response',
      ]
    );
    await assert.rejects(
      api.sendMessage(124, 'unrelated'),
      /QA owner-only send/u
    );
    assert.equal(payloads.length, 2);
  } finally {
    restore();
  }
});
