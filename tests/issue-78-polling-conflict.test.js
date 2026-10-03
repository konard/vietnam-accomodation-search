import { describe, expect, it } from 'test-anywhere';

import {
  classifyTelegramError,
  CONFLICT_BACKOFF,
  CONFLICT_MESSAGE,
  conflictDelay,
  TelegramRuntime,
} from '../src/index.js';

// One bot token on the Telegram side: a newer getUpdates terminates the
// pending one with 409, as the Bot API does for two pollers.
class TokenHub {
  constructor() {
    this.pending = undefined;
  }

  getUpdates(poller) {
    if (this.pending && this.pending.poller !== poller) {
      this.pending.reject({
        description: 'Conflict: terminated by other getUpdates request',
        error_code: 409,
        ok: false,
      });
    }
    return new Promise((resolve, reject) => {
      this.pending = { poller, reject, resolve };
    });
  }

  answer(poller) {
    if (this.pending?.poller === poller) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve({ ok: true, result: [] });
    }
  }
}

// The grammY surface the runtime uses: getMe, start/stop, and API
// transformers that observe every getUpdates result.
function pollingBot(hub) {
  const transformers = [];
  const bot = {
    api: {
      config: { use: (transformer) => transformers.push(transformer) },
      getMe: async () => ({ id: 1 }),
    },
    running: false,
    starts: 0,
    async call(method) {
      const raw = () => hub.getUpdates(bot);
      const run = transformers.reduce(
        (previous, transformer) => (name, payload) =>
          transformer(previous, name, payload),
        (name) => (name === 'getUpdates' ? raw() : { ok: true })
      );
      const result = await run(method, {});
      if (!result.ok) {
        throw result;
      }
      return result;
    },
    async start({ onStart }) {
      bot.running = true;
      bot.starts += 1;
      onStart();
      try {
        while (bot.running) {
          await bot.call('getUpdates');
        }
      } finally {
        bot.running = false;
      }
    },
    async stop() {
      bot.running = false;
      hub.answer(bot);
    },
  };
  return bot;
}

function runtimeFor(bot, logs) {
  return new TelegramRuntime({
    bot,
    conflictBackoff: { baseMs: 5, maxMs: 20 },
    healthPort: 0,
    logger: {
      error: (...values) => logs.push(values),
      info: (...values) => logs.push(values),
      warn: (...values) => logs.push(values),
    },
    random: () => 0.5,
  });
}

async function until(condition, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Condition was not met in time.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function ready(runtime) {
  const { port } = runtime.server.address();
  const response = await fetch(`http://127.0.0.1:${port}/ready`);
  return { body: await response.json(), status: response.status };
}

describe('polling conflict: two pollers on one bot token', () => {
  it('marks the evicted instance unready and keeps it running with backoff', async () => {
    const hub = new TokenHub();
    const firstLogs = [];
    const secondLogs = [];
    const firstBot = pollingBot(hub);
    const secondBot = pollingBot(hub);
    const first = runtimeFor(firstBot, firstLogs);
    const second = runtimeFor(secondBot, secondLogs);
    try {
      await first.start();
      expect((await ready(first)).status).toBe(200);

      await second.start();
      await until(() => first.conflicts > 0);
      const evicted = await ready(first);
      expect(evicted.status).toBe(503);
      expect(evicted.body).toEqual({
        conflicts: first.conflicts,
        reason: 'polling-conflict',
        status: 'not-ready',
      });
      expect(firstLogs.some(([message]) => message === CONFLICT_MESSAGE)).toBe(
        true
      );

      // Both instances keep evicting each other, but neither process exits:
      // each polls again after its backoff and stays unready meanwhile.
      await until(() => first.conflicts >= 3 && second.conflicts >= 3);
      expect(first.live && second.live).toBe(true);
      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(firstBot.starts > 1).toBe(true);
      const conflictLog = firstLogs.find(
        ([message]) => message === CONFLICT_MESSAGE
      );
      expect(Object.keys(conflictLog[1]).sort()).toEqual([
        'conflicts',
        'retryInMs',
      ]);
    } finally {
      await second.stop('test');
      await first.stop('test');
    }
    expect(await first.polling).toBe(undefined);
    expect(await second.polling).toBe(undefined);
  });

  it('becomes ready again after a successful getUpdates call', async () => {
    const hub = new TokenHub();
    const logs = [];
    const bot = pollingBot(hub);
    const runtime = runtimeFor(bot, logs);
    try {
      await runtime.start();
      // A one-off foreign poll evicts this instance once.
      void hub.getUpdates({}).catch(() => {});
      await until(() => runtime.conflicts === 1);
      expect(runtime.ready).toBe(false);
      await until(() => bot.starts === 2 && hub.pending?.poller === bot);
      expect(runtime.ready).toBe(false);
      hub.answer(bot);
      await until(() => runtime.ready);
      expect((await ready(runtime)).body).toEqual({ status: 'ready' });
      expect(logs.some(([message]) => message === 'telegram polling resumed'));
    } finally {
      await runtime.stop('test');
    }
  });

  it('stops promptly during a conflict backoff', async () => {
    let rejectPolling;
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: ({ onStart }) => {
          onStart();
          return new Promise((_resolve, reject) => {
            rejectPolling = reject;
          });
        },
        stop: async () => {},
      },
      conflictBackoff: { baseMs: 60_000, maxMs: 60_000 },
      healthPort: null,
      logger: { error: () => {}, info: () => {} },
    });
    await runtime.start();
    rejectPolling({ error_code: 409 });
    await until(() => runtime.conflicts === 1);
    const started = Date.now();
    await runtime.stop('signal');
    expect(await runtime.polling).toBe(undefined);
    expect(Date.now() - started < 5_000).toBe(true);
  });

  it('restores readiness on restart when the bot cannot report polling results', async () => {
    let attempt = 0;
    let polling;
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: ({ onStart }) => {
          attempt += 1;
          onStart();
          return new Promise((resolve, reject) => {
            polling = { reject, resolve };
          });
        },
        stop: async () => polling.resolve(),
      },
      conflictBackoff: { baseMs: 1, maxMs: 1 },
      healthPort: null,
      logger: { error: () => {}, info: () => {} },
    });
    await runtime.start();
    polling.reject({ error_code: 409 });
    await until(() => attempt === 2);
    expect(runtime.ready).toBe(true);
    expect(runtime.health()).toEqual({ status: 'ready' });
    await runtime.stop('test');
    expect(await runtime.polling).toBe(undefined);
  });
});

describe('polling conflict: policy', () => {
  it('is not a fatal error class', () => {
    expect(classifyTelegramError({ error_code: 409 })).toEqual({
      category: 'conflict',
      fatal: false,
      retryable: false,
    });
  });

  it('backs off exponentially with jitter, bounded by the maximum', () => {
    const delays = [1, 2, 3, 10, 20].map((attempt) =>
      conflictDelay(attempt, CONFLICT_BACKOFF, () => 1)
    );
    expect(delays).toEqual([5_000, 10_000, 20_000, 300_000, 300_000]);
    expect(conflictDelay(1, CONFLICT_BACKOFF, () => 0)).toBe(2_500);
    expect(conflictDelay(0, { baseMs: 8, maxMs: 100 }, () => 0)).toBe(4);
    // The default never polls again sooner than every few seconds.
    expect(conflictDelay(1) >= 2_500).toBe(true);
  });
});
