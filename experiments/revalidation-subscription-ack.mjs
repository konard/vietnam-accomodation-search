// Finite, self-authored control: persisting a subscription must not leave
// its acknowledgement waiting for a blocked scheduled search. No network.
import assert from 'node:assert/strict';
import { registerTelegramHandlers } from '../src/index.js';
import { withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope) => {
  const commands = new Map();
  const replies = [];
  let subscribed = false;
  let releaseSearch;
  let searchEntered;
  const search = new Promise((resolve) => {
    releaseSearch = resolve;
  });
  const entered = new Promise((resolve) => {
    searchEntered = resolve;
  });
  registerTelegramHandlers(
    {
      command: (name, handler) => commands.set(name, handler),
      on() {},
    },
    {
      presetService: {
        subscribe: () => {
          subscribed = true;
          return Promise.resolve({ presetName: 'self-authored-qa' });
        },
      },
      subscriptionScheduler: {
        tick: () => {
          searchEntered();
          return search;
        },
      },
    }
  );
  const handled = commands.get('subscribe')({
    from: { id: 123 },
    match: 'self-authored-qa',
    reply: (text) => {
      replies.push(text);
      return Promise.resolve();
    },
  });
  scope.defer('subscription handler', () => handled);
  scope.defer('blocked search', () => releaseSearch());
  await entered;
  const acknowledgementDuringSearch = replies.some((text) =>
    text.startsWith('Subscribed to preset')
  );
  releaseSearch();
  await handled;
  const positiveControl = replies.some((text) =>
    text.startsWith('Subscribed to preset self-authored-qa.')
  );
  console.log(
    JSON.stringify({
      subscriptionPersisted: subscribed,
      acknowledgementDuringSearch,
      positiveControl,
      pass: subscribed && acknowledgementDuringSearch && positiveControl,
    })
  );
  assert(subscribed && positiveControl, 'Completed-search control must work.');
  assert(
    acknowledgementDuringSearch,
    'Subscription acknowledgement waits for the scheduled search to finish.'
  );
});
