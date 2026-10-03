import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'test-anywhere';

import {
  assertTokenNotShared,
  observeSettle,
  parseSettleSample,
  readTokenFingerprints,
  TOKEN_FINGERPRINT_SCRIPT,
} from '../scripts/deploy-guards.mjs';
import { deploymentStateMachine } from '../scripts/deploy.mjs';

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

// Deno runs the suite without net access, so it cannot bind the health server.
const isDeno = typeof globalThis.Deno !== 'undefined';

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
    if (isDeno) {
      return;
    }
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
    if (isDeno) {
      return;
    }
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

const execute = promisify(execFile);

async function rejection(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('polling conflict: deploy settle window', () => {
  it('fails the deploy and restores the previous image when the candidate meets another poller', async () => {
    if (isDeno) {
      return;
    }
    const hub = new TokenHub();
    // The other Compose project already polls with the same token.
    const other = runtimeFor(pollingBot(hub), []);
    const lines = [];
    const candidate = new TelegramRuntime({
      bot: pollingBot(hub),
      conflictBackoff: { baseMs: 5, maxMs: 20 },
      healthPort: 0,
      logger: {
        error: (message) => lines.push(message),
        info: (message) => lines.push(message),
      },
      random: () => 0.5,
    });
    const calls = [];
    try {
      await other.start();
      const error = await rejection(() =>
        deploymentStateMachine({
          capture: async () => 'snapshot',
          inspectPrevious: async () => 'vac:previous',
          prepare: async () => 'vac:candidate',
          record: async () => calls.push('record'),
          restore: async (image, snapshot) =>
            calls.push(`restore ${image} ${snapshot}`),
          // `docker inspect` and `docker logs` of the candidate container.
          settle: () =>
            observeSettle({
              durationMs: 2_000,
              intervalMs: 5,
              sample: async () =>
                parseSettleSample(
                  `0 true ${(await ready(candidate)).status === 200 ? 'healthy' : 'unhealthy'}`,
                  lines.join('\n')
                ),
            }),
          start: async () => {
            calls.push('start');
            await candidate.start();
          },
          stop: async () => calls.push('stop'),
          // The candidate passed getMe and started polling.
          wait: async () => expect(candidate.live).toBe(true),
        })
      );
      expect(error.message.startsWith('Candidate readiness failed;')).toBe(
        true
      );
      expect(
        /during the 2 s settle window: \d+ Telegram polling conflict\(s\): another poller holds this bot token\.$/u.test(
          error.message
        )
      ).toBe(true);
      expect(calls).toEqual(['stop', 'start', 'restore vac:previous snapshot']);
      // The evicted candidate itself reports unready meanwhile.
      await until(() => candidate.conflicts > 0);
      expect((await ready(candidate)).body.reason).toBe('polling-conflict');
    } finally {
      await candidate.stop('test');
      await other.stop('test');
    }
  });

  it('fails on a restart, a stopped container, or an unhealthy status', async () => {
    const cases = [
      [
        ['0 true healthy', '1 true healthy'],
        'the container restarted 1 time(s)',
      ],
      [['2 true healthy', '2 false '], 'the container stopped'],
      [
        ['0 true healthy', '0 true unhealthy'],
        'the container became unhealthy',
      ],
    ];
    for (const [samples, reason] of cases) {
      const queue = [...samples];
      const error = await rejection(() =>
        observeSettle({
          durationMs: 30_000,
          now: () => 0,
          sample: async () =>
            parseSettleSample(queue.shift() ?? samples.at(-1)),
          sleep: async () => {},
        })
      );
      expect(error.message).toBe(
        `Candidate failed during the 30 s settle window: ${reason}.`
      );
    }
  });

  it('passes a candidate that stays healthy for the whole window', async () => {
    let clock = 0;
    const slept = [];
    const result = await observeSettle({
      durationMs: 5_000,
      intervalMs: 2_000,
      now: () => clock,
      sample: async () => parseSettleSample('3 true healthy\n', 'started\n'),
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    expect(result).toEqual({
      conflicts: 0,
      health: 'healthy',
      restarts: 3,
      running: true,
    });
    expect(slept).toEqual([2_000, 2_000, 1_000]);
    expect(parseSettleSample('0 true')).toEqual({
      conflicts: 0,
      health: '',
      restarts: 0,
      running: true,
    });
  });
});

describe('polling conflict: shared token guard', () => {
  const records = [
    { projectName: 'vac', tokenFingerprint: 'a'.repeat(64) },
    { projectName: 'vac-drill', tokenFingerprint: 'b'.repeat(64) },
  ];

  it('refuses a second project with the same token fingerprint', () => {
    expect(() =>
      assertTokenNotShared({
        fingerprint: 'a'.repeat(64),
        projectName: 'vac-qa',
        records,
      })
    ).toThrow(
      "Compose project vac already deploys this bot token; Telegram allows one poller per token, so both bots would fail with 409 Conflict. Use a separate bot for vac-qa, remove the other project's .deploy record, or pass --allow-shared-token."
    );
  });

  it('allows the same project, a different token, or the explicit flag', () => {
    const fingerprint = 'a'.repeat(64);
    for (const options of [
      { fingerprint, projectName: 'vac' },
      { fingerprint: 'c'.repeat(64), projectName: 'vac-qa' },
      { allowSharedToken: true, fingerprint, projectName: 'vac-qa' },
      { fingerprint: '', projectName: 'vac-qa' },
    ]) {
      expect(assertTokenNotShared({ ...options, records })).toBe(undefined);
    }
  });

  it('prints only a salted digest of the token, read from the env or a file', async () => {
    // Deno runs the suite without permission to spawn processes.
    if (isDeno) {
      return;
    }
    const token = '123456:SECRET-token-value';
    const expected = createHash('sha256')
      .update(`telegram-bot-token:${token}`)
      .digest('hex');
    const root = await realpath(await mkdtemp(join(tmpdir(), 'issue-78-')));
    try {
      const file = join(root, 'token');
      await writeFile(file, `${token}\n`);
      for (const env of [
        { TELEGRAM_BOT_TOKEN: token },
        { TELEGRAM_BOT_TOKEN_FILE: file },
      ]) {
        const { stdout } = await execute(
          process.execPath,
          ['--input-type=module', '-e', TOKEN_FINGERPRINT_SCRIPT],
          { env: { PATH: process.env.PATH, ...env } }
        );
        expect(stdout).toBe(`${expected}\n`);
      }
      const { stdout } = await execute(
        process.execPath,
        ['--input-type=module', '-e', TOKEN_FINGERPRINT_SCRIPT],
        { env: { PATH: process.env.PATH } }
      );
      expect(stdout).toBe('');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('reads the fingerprints every project recorded under .deploy', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const root = await realpath(await mkdtemp(join(tmpdir(), 'issue-78-')));
    try {
      expect(await readTokenFingerprints(join(root, 'missing'))).toEqual([]);
      for (const [name, state] of [
        ['vac', { tokenFingerprint: 'a'.repeat(64) }],
        ['vac-old', { currentImage: 'vac:1' }],
      ]) {
        await mkdir(join(root, name));
        await writeFile(join(root, name, 'state.json'), JSON.stringify(state));
      }
      await mkdir(join(root, 'vac-empty'));
      await writeFile(join(root, 'operation.lock'), '');
      expect(await readTokenFingerprints(root)).toEqual([
        { projectName: 'vac', tokenFingerprint: 'a'.repeat(64) },
      ]);
      await writeFile(join(root, 'vac-old', 'state.json'), '{');
      expect((await rejection(() => readTokenFingerprints(root))).name).toBe(
        'SyntaxError'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
