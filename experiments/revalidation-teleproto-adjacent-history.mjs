// Installed-SDK exhausted-window control; no credentials or network requests.
import assert from 'node:assert/strict';
import { Api } from 'teleproto';
import { getMessages, iterMessages } from 'teleproto/client/messages.js';

const results = [];
for (const offsetId of [12, 11]) {
  let requests = 0;
  const client = {
    getInputEntity: () => Promise.resolve(new Api.InputPeerSelf()),
    invoke: () => {
      requests += 1;
      return Promise.resolve(
        new Api.messages.Messages({ messages: [], chats: [], users: [] })
      );
    },
    iterMessages(entity, options) {
      return iterMessages(this, entity, options);
    },
  };
  let error;
  let count;
  try {
    count = (
      await getMessages(client, 'self-authored', {
        limit: 100,
        minId: 10,
        offsetId,
      })
    ).length;
  } catch (caught) {
    error = caught.message;
  }
  results.push({ offsetId, requests, count, error });
}
console.log(
  JSON.stringify({
    positiveControl: results[0].count === 0,
    adjacentWindow: results[1],
    pass: results.every((x) => x.count === 0),
  })
);
assert.equal(results[0].count, 0, 'Non-adjacent empty history must work.');
assert.equal(
  results[1].count,
  0,
  'An exhausted adjacent history window must return empty.'
);
