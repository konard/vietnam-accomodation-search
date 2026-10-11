import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  PresetService,
  SubscriptionScheduler,
  registerTelegramHandlers,
} from '../src/index.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error('Finite subscription control exceeded its deadline.')
            ),
          1000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function setup(search) {
  const records = new Map();
  const store = {
    loadRecords: async (kind) => records.get(kind) || [],
    saveRecords: async (kind, value) =>
      records.set(kind, globalThis.structuredClone(value)),
    updateRecords: async (kind, update) =>
      records.set(kind, await update(records.get(kind) || [])),
  };
  const presets = new PresetService({ store });
  const deliveries = [];
  const errors = [];
  const errorObserved = deferred();
  const logger = {
    error: (...args) => {
      errors.push(args);
      errorObserved.resolve();
    },
  };
  const scheduler = new SubscriptionScheduler({
    presets,
    store,
    search,
    logger,
    deliver: async (...args) => deliveries.push(args),
  });
  const commands = new Map();
  registerTelegramHandlers(
    { command: (name, handler) => commands.set(name, handler), on: () => {} },
    {
      presetService: presets,
      subscriptionScheduler: scheduler,
      logger,
    }
  );
  const replies = [];
  const context = {
    from: { id: 42 },
    reply: async (text) => replies.push(text),
  };
  return {
    commands,
    context,
    presets,
    replies,
    scheduler,
    deliveries,
    errors,
    errorObserved,
  };
}

describe('durable subscription acknowledgement and owned background search', () => {
  it('joins cancellation while subscription loading is still pending', async () => {
    const loaded = deferred();
    const scope = setup(async () => {
      throw new Error('search must not run');
    });
    scope.presets.listSubscriptions = () => loaded.promise;
    const running = scope.scheduler.tick();
    const stopped = scope.scheduler.stop();
    loaded.resolve([{ userId: '42', options: {} }]);
    await bounded(Promise.all([running, stopped]));
    assert.equal(scope.deliveries.length, 0);
  });

  it('stops between recipients of the same search group', async () => {
    const scope = setup(async () => []);
    await scope.presets.subscribe('42');
    await scope.presets.subscribe('43');
    const owners = [];
    let stopped;
    scope.presets.markSuccessfulRun = async (owner) => {
      owners.push(owner);
      stopped = scope.scheduler.stop();
    };
    await bounded(scope.scheduler.tick());
    await bounded(stopped);
    assert.deepEqual(owners, ['42']);
  });

  it('acknowledges before a slow search finishes and joins a single cancelled search', async () => {
    const started = deferred();
    const finish = deferred();
    let calls = 0;
    const fixture = setup(async ({ signal }) => {
      calls += 1;
      signal.addEventListener('abort', () => finish.reject(signal.reason), {
        once: true,
      });
      started.resolve();
      return finish.promise;
    });
    try {
      await bounded(fixture.commands.get('subscribe')(fixture.context));
      assert.equal(
        (await fixture.presets.subscription(42)).presetName,
        'default'
      );
      assert.deepEqual(fixture.replies, ['Subscribed to preset default.']);
      await bounded(started.promise);
      const running = fixture.scheduler.tick();
      assert.equal(fixture.scheduler.tick(), running);
      await bounded(fixture.scheduler.stop());
      await running;
      assert.equal(calls, 1);
      assert.equal(fixture.deliveries.length, 0);
      assert.equal(fixture.errors.length, 0);
      await fixture.scheduler.tick();
      assert.equal(calls, 1);
    } finally {
      finish.resolve([]);
      await fixture.scheduler.stop();
    }
  });

  it('keeps the successful acknowledgement and reports a later search failure', async () => {
    const finish = deferred();
    const fixture = setup(() => finish.promise);
    try {
      await bounded(fixture.commands.get('subscribe')(fixture.context));
      finish.reject(new Error('self-authored background failure'));
      await bounded(fixture.errorObserved.promise);
      assert.equal(fixture.errors[0][0], 'subscription search failed');
      assert.equal(fixture.replies.length, 1);
      assert.equal(
        (await fixture.presets.subscription(42)).presetName,
        'default'
      );
    } finally {
      finish.resolve([]);
      await fixture.scheduler.stop();
    }
  });

  it('suppresses delivery after shutdown even when a search ignores cancellation', async () => {
    const started = deferred();
    const finish = deferred();
    const fixture = setup(() => {
      started.resolve();
      return finish.promise;
    });
    try {
      await bounded(fixture.commands.get('subscribe')(fixture.context));
      await bounded(started.promise);
      let stopped = false;
      const shutdown = fixture.scheduler.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      assert.equal(stopped, false);
      finish.resolve([
        { id: 'self-authored', collectedAt: new Date().toISOString() },
      ]);
      await bounded(shutdown);
      assert.equal(fixture.deliveries.length, 0);
    } finally {
      finish.resolve([]);
      await fixture.scheduler.stop();
    }
  });
});
