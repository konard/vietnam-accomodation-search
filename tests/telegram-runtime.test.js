import { describe, expect, it } from 'test-anywhere';

import {
  TelegramHistoryCollector,
  TelegramRuntime,
  UpdateDeduplicator,
} from '../src/index.js';

describe('Telegram service lifecycle', () => {
  it('becomes ready only after credential preflight and stops every resource', async () => {
    const calls = [];
    let catchHandler;
    const bot = {
      api: {
        getMe: async () => {
          calls.push('bot:getMe');
          return { id: 1 };
        },
      },
      catch: (handler) => {
        catchHandler = handler;
      },
      start: async ({ onStart }) => {
        calls.push('bot:start');
        onStart();
      },
      stop: async () => calls.push('bot:stop'),
    };
    const scheduler = {
      start: () => calls.push('scheduler:start'),
      stop: async () => calls.push('scheduler:stop'),
    };
    const resource = {
      close: async () => calls.push('resource:close'),
      destroy: () => {
        calls.push('resource:destroy');
      },
    };
    const runtime = new TelegramRuntime({
      bot,
      healthPort: null,
      resources: [resource],
      scheduler,
      userAuth: { validate: async () => calls.push('user:validate') },
    });

    expect(runtime.health('ready').status).toBe('not-ready');
    await runtime.start();
    expect(calls.slice(0, 4)).toEqual([
      'bot:getMe',
      'user:validate',
      'bot:start',
      'scheduler:start',
    ]);
    expect(runtime.health('ready').status).toBe('ready');
    expect(typeof catchHandler).toBe('function');
    await runtime.stop('test');
    expect(runtime.health('ready').status).toBe('not-ready');
    expect(calls).toContain('scheduler:stop');
    expect(calls).toContain('bot:stop');
    expect(calls).toContain('resource:destroy');
    expect(calls).not.toContain('resource:close');
  });

  it('continues bot-only when optional user authentication fails', async () => {
    const warnings = [];
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: async ({ onStart }) => onStart(),
        stop: async () => {},
      },
      healthPort: null,
      logger: {
        info: () => {},
        warn: (...values) => warnings.push(values),
      },
      userAuth: {
        validate: async () => {
          throw new Error('session=super-secret is no longer authorized');
        },
      },
      userAuthOptional: true,
    });

    await runtime.start();
    expect(runtime.health()).toEqual({ status: 'ready' });
    expect(warnings[0][0]).toContain('continuing bot-only');
    expect(warnings[0][1].message).toContain('session=[REDACTED]');
    expect(warnings[0][1].message).not.toContain('super-secret');
    await runtime.stop('test');
  });

  it('fails closed when user authentication is not optional', async () => {
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        stop: async () => {},
      },
      healthPort: null,
      logger: { error: () => {}, info: () => {} },
      userAuth: {
        validate: async () => {
          throw new Error('AUTH_KEY_UNREGISTERED');
        },
      },
    });

    let failure;
    try {
      await runtime.start();
    } catch (error) {
      failure = error;
    }
    expect(failure.message).toContain('AUTH_KEY_UNREGISTERED');
    expect(runtime.exitCode).toBe(20);
  });

  it('drains tracked middleware and maps fatal auth failures to a distinct exit code', async () => {
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    let catchHandler;
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        catch: (handler) => {
          catchHandler = handler;
        },
        start: async ({ onStart }) => onStart(),
        stop: async () => {},
      },
      healthPort: null,
    });
    await runtime.start();
    const update = runtime.middleware({}, async () => blocked);
    const stopping = runtime.stop('signal');
    await Promise.resolve();
    expect(runtime.health('ready').status).toBe('not-ready');
    release();
    await update;
    await stopping;

    const second = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        catch: (handler) => {
          catchHandler = handler;
        },
        start: async ({ onStart }) => onStart(),
        stop: async () => {},
      },
      healthPort: null,
    });
    await second.start();
    await catchHandler({ error: { errorMessage: 'AUTH_KEY_UNREGISTERED' } });
    expect(second.exitCode).toBe(20);
    expect(second.health('ready').status).toBe('not-ready');
  });

  it('never becomes ready when polling exits before its onStart hook', async () => {
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: async () => {},
        stop: async () => {},
      },
      healthPort: null,
      logger: { error: () => {}, info: () => {} },
    });

    let error;
    try {
      await runtime.start();
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('before readiness');
    expect(runtime.health()).toEqual({ status: 'not-ready' });
  });

  it('bounds resource cleanup within the shutdown deadline', async () => {
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: async ({ onStart }) => onStart(),
        stop: async () => {},
      },
      drainDeadlineMs: 10,
      healthPort: null,
      logger: { info: () => {} },
      resources: [{ destroy: () => new Promise(() => {}) }],
    });
    await runtime.start();

    const startedAt = Date.now();
    let error;
    try {
      await runtime.stop('signal');
    } catch (caught) {
      error = caught;
    }

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(error instanceof AggregateError).toBe(true);
    expect(error.errors[0].message).toContain('resource cleanup');
    expect(runtime.exitCode).toBe(22);
    expect(runtime.health('live').status).toBe('stopped');
  });

  it('bounds polling and scheduler stop operations within the same deadline', async () => {
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: async ({ onStart }) => onStart(),
        stop: () => new Promise(() => {}),
      },
      drainDeadlineMs: 10,
      healthPort: null,
      logger: { info: () => {} },
      scheduler: { start: () => {}, stop: () => new Promise(() => {}) },
    });
    await runtime.start();

    const error = await (async () => {
      try {
        await runtime.stop('signal');
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error instanceof AggregateError).toBe(true);
    expect(error.errors[0].message).toContain('polling or subscription');
    expect(runtime.exitCode).toBe(22);
  });
});

describe('persisted update deduplication', () => {
  it('deduplicates updates and edits across process restarts with a bounded window', async () => {
    const records = [];
    const store = {
      loadRecords: async () => [...records],
      saveRecords: async (_kind, next) =>
        records.splice(0, records.length, ...next),
    };
    const first = new UpdateDeduplicator({ maxEntries: 2, store });
    expect(await first.accept({ update_id: 1 })).toBe(true);
    expect(await first.accept({ update_id: 1 })).toBe(false);
    const restarted = new UpdateDeduplicator({ maxEntries: 2, store });
    expect(
      await restarted.accept({
        edited_message: { chat: { id: -1 }, edit_date: 20, message_id: 7 },
      })
    ).toBe(true);
    expect(
      await restarted.accept({
        edited_message: { chat: { id: -1 }, edit_date: 20, message_id: 7 },
      })
    ).toBe(false);
    expect(await restarted.accept({ update_id: 2 })).toBe(true);
    expect(records.length).toBe(2);
  });

  it('deduplicates concurrent updates with an atomic store transaction', async () => {
    const records = [];
    const store = {
      updateRecords: async (_kind, update) => {
        records.splice(0, records.length, ...(await update([...records])));
      },
    };
    const deduplicator = new UpdateDeduplicator({ store });
    expect(
      await Promise.all([
        deduplicator.accept({ update_id: 1 }),
        deduplicator.accept({ update_id: 1 }),
      ])
    ).toEqual([true, false]);
    expect(records.length).toBe(1);
  });
});

describe('MTProto history collection', () => {
  it('uses the two-month cutoff, normalizer, and transport provenance', async () => {
    const requested = [];
    const router = {
      history: async (_source, options) => {
        requested.push(options);
        return [
          {
            chat: { username: 'rentals' },
            date: '2026-09-10T00:00:00Z',
            groupedId: 'album-1',
            id: 10,
            text: 'Studio Nha Trang 8,000,000 VND/month',
            topicId: 4,
          },
          {
            chat: { username: 'rentals' },
            date: '2026-06-01T00:00:00Z',
            id: 1,
            text: 'Old room 1,000,000 VND/month',
          },
        ];
      },
    };
    const collector = new TelegramHistoryCollector({
      now: () => new Date('2026-09-22T00:00:00Z'),
      rates: { VND: 1 },
      router,
    });
    const offers = await collector.collect([{ id: 'telegram:rentals' }]);
    expect(offers.length).toBe(1);
    expect(offers[0].provenance.transport).toBe('mtproto');
    expect(offers[0].provenance.topicId).toBe(4);
    expect(requested[0].since.toISOString()).toBe('2026-07-22T00:00:00.000Z');
  });
});
