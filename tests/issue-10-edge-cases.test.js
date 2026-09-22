import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  LinkCliMirror,
  LinksStore,
  PresetService,
  SubscriptionScheduler,
  TelegramAccessPolicy,
  TelegramAuthService,
  TelegramCapabilityRouter,
  TelegramHistoryCollector,
  TelegramRuntime,
  UpdateDeduplicator,
  createApplication,
  deserializeRecords,
  preflightTelegram,
  queryRecords,
  redactTelegramValue,
  registerTelegramHandlers,
  resolveTelegramSecrets,
  serializeRecords,
  telegramDeduplicationMiddleware,
  telegramRuntimeMiddleware,
} from '../src/index.js';
import { secretPrompt } from '../src/secret-prompt.js';

async function capturedFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

function memoryStore() {
  const values = new Map();
  return {
    loadRecords: async (kind) =>
      globalThis.structuredClone(values.get(kind) || []),
    saveRecords: async (kind, records) =>
      values.set(kind, globalThis.structuredClone(records)),
  };
}

function isNodeRuntime() {
  return typeof globalThis.Deno === 'undefined';
}

describe('issue 10 defensive storage paths', () => {
  it('handles empty queries, legacy schemas, invalid collections, and storage budgets', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    expect(serializeRecords('offer', [])).toBe('');
    expect(deserializeRecords('offer', '')).toEqual([]);
    expect(queryRecords('offer', '', { path: 'id', value: 'x' })).toEqual([]);

    const legacyOpaque = '(offer: (data: eyJpZCI6ImxlZ2FjeSJ9))';
    expect(deserializeRecords('offer', legacyOpaque)).toEqual([
      { id: 'legacy' },
    ]);
    const legacyAssociative = [
      "(offer: 'record:legacy' 'value:string:legacy')",
      "('field:/': 'record:legacy' 'value:object')",
      "('field:/id': 'record:legacy' 'value:string:legacy')",
    ].join('\n');
    expect(deserializeRecords('offer', legacyAssociative)).toEqual([
      { id: 'legacy' },
    ]);

    const directory = await mkdtemp(join(tmpdir(), 'storage-edges-'));
    try {
      const store = new LinksStore({
        binaryMirror: false,
        directory,
        maxBytes: 1,
      });
      expect(() => store.pathFor('../invalid')).toThrow();
      await store.saveOffers([{ id: 'too-large', title: 'large' }]);
      expect(await store.listOffers()).toEqual([]);
      await store.saveRecords('user-settings', [{ id: '1', enabled: true }]);
      expect(
        await store.queryRecords('user-settings', {
          path: 'enabled',
          value: true,
        })
      ).toEqual([{ enabled: true, id: '1' }]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('cleans failed binary candidates and exercises the real process runner', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'mirror-edges-'));
    try {
      const failing = new LinkCliMirror({
        run: async () => {
          throw new Error('candidate failed');
        },
      });
      const error = await capturedFailure(() =>
        failing.stage({ directory, kind: 'offers', notation: 'offer: (a b)\n' })
      );
      expect(error.message).toContain('candidate failed');

      const executable = new LinkCliMirror({ command: process.execPath });
      await executable.preflight();
      expect(
        (
          await capturedFailure(() =>
            executable.stage({
              directory,
              kind: 'process-failure',
              notation: 'offer: (a b)\n',
            })
          )
        ).message
      ).toContain('clink exited');
      const missing = new LinkCliMirror({
        command: join(directory, 'missing'),
      });
      expect((await capturedFailure(() => missing.preflight())).code).toBe(
        'ENOENT'
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects a clink export that loses links and repairs corrupt pointers', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'mirror-verify-'));
    try {
      const mirror = new LinkCliMirror({
        run: async (_command, arguments_) => {
          const databasePath = arguments_[arguments_.indexOf('--db') + 1];
          const exportPath = arguments_[arguments_.indexOf('--export') + 1];
          await writeFile(databasePath, 'binary');
          await writeFile(exportPath, 'unrelated: (left right)\n');
        },
      });
      const error = await capturedFailure(() =>
        mirror.stage({ directory, kind: 'offers', notation: 'offer: (a b)\n' })
      );
      expect(error.message).toContain('links missing');

      const retaining = new LinkCliMirror({
        run: async (_command, arguments_) => {
          const databasePath = arguments_[arguments_.indexOf('--db') + 1];
          const source = arguments_[arguments_.indexOf('--import') + 1];
          const target = arguments_[arguments_.indexOf('--export') + 1];
          await writeFile(databasePath, 'binary');
          await writeFile(
            target,
            `${await readFile(source, 'utf8')}unrelated: (left right)\n`
          );
        },
      });
      expect(
        (
          await capturedFailure(() =>
            retaining.stage({
              directory,
              kind: 'offers',
              notation: 'offer: (a b)\n',
            })
          )
        ).message
      ).toContain('unexpected links');

      await writeFile(join(directory, 'offers.lino'), 'offer: (a b)\n');
      await writeFile(
        join(directory, '.pointer-placeholder'),
        'keeps test setup explicit'
      );
      let successfulRuns = 0;
      const successful = new LinkCliMirror({
        run: async (_command, arguments_) => {
          successfulRuns += 1;
          const databasePath = arguments_[arguments_.indexOf('--db') + 1];
          const source = arguments_[arguments_.indexOf('--import') + 1];
          const target = arguments_[arguments_.indexOf('--export') + 1];
          await writeFile(databasePath, 'binary');
          await writeFile(target, await readFile(source, 'utf8'));
        },
      });
      const first = await successful.ensure({
        directory,
        kind: 'offers',
        notation: 'offer: (a b)\n',
      });
      await mkdir(join(directory, '.binary', 'offers-obsolete'));
      expect(
        (
          await successful.ensure({
            directory,
            kind: 'offers',
            notation: 'offer: (a b)\n',
          })
        ).sha256
      ).toBe(first.sha256);
      expect(successfulRuns).toBe(1);
      const current = JSON.parse(
        await readFile(
          join(directory, '.binary', 'offers.current.json'),
          'utf8'
        )
      );
      await writeFile(
        join(current.directory, 'manifest.json'),
        JSON.stringify({ kind: 'wrong', sha256: first.sha256, version: 1 })
      );
      await successful.ensure({
        directory,
        kind: 'offers',
        notation: 'offer: (a b)\n',
      });
      expect(successfulRuns).toBe(2);

      await rm(join(current.directory, 'manifest.json'));
      await mkdir(join(current.directory, 'manifest.json'));
      expect(
        (
          await capturedFailure(() =>
            successful.ensure({
              directory,
              kind: 'offers',
              notation: 'offer: (a b)\n',
            })
          )
        ).code
      ).toBe('EISDIR');
      await rm(join(current.directory, 'manifest.json'), {
        force: true,
        recursive: true,
      });
      await successful.ensure({
        directory,
        kind: 'offers',
        notation: 'offer: (a b)\n',
      });
      expect(successfulRuns).toBe(3);

      await writeFile(
        join(current.directory, 'verified.lino'),
        'corrupt: (left right)\n'
      );
      await successful.ensure({
        directory,
        kind: 'offers',
        notation: 'offer: (a b)\n',
      });
      expect(successfulRuns).toBe(4);
      await writeFile(join(current.directory, 'data.links'), 'corrupt-binary');
      await successful.ensure({
        directory,
        kind: 'offers',
        notation: 'offer: (a b)\n',
      });
      expect(successfulRuns).toBe(5);
      await writeFile(
        join(directory, '.binary', 'offers.current.json'),
        '{not-json'
      );
      const repaired = await successful.ensure({
        directory,
        kind: 'offers',
        notation: 'offer: (a b)\n',
      });
      expect(repaired.sha256).toBe(first.sha256);

      await rm(join(directory, '.binary', 'offers.current.json'));
      await mkdir(join(directory, '.binary', 'offers.current.json'));
      expect(
        (
          await capturedFailure(() =>
            successful.ensure({
              directory,
              kind: 'offers',
              notation: 'offer: (a b)\n',
            })
          )
        ).code
      ).toBe('EISDIR');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('handles lock-owner edge cases and mirrors generic and offer reads/writes', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'lock-owner-'));
    try {
      const lock = join(directory, '.write.lock');
      await mkdir(lock);
      setTimeout(() => {
        void writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: 0 }));
      }, 20);
      const calls = [];
      const mirror = {
        ensure: async (input) => calls.push(['ensure', input.kind]),
        stage: async (input) => ({
          activate: async () => calls.push(['activate', input.kind]),
        }),
      };
      const store = new LinksStore({ directory, mirror });
      await store.saveOffers([{ id: 'mirrored' }]);
      await store.listOffers();
      expect(calls).toEqual([
        ['activate', 'offers'],
        ['ensure', 'offers'],
      ]);

      await mkdir(lock);
      await mkdir(join(lock, 'owner.json'));
      expect(
        (await capturedFailure(() => store.saveRecords('presets', []))).code
      ).toBe('EISDIR');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('refuses to steal a live process lock after a bounded wait', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'live-lock-'));
    const lock = join(directory, '.write.lock');
    await mkdir(lock);
    await writeFile(
      join(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid })
    );
    try {
      const store = new LinksStore({ binaryMirror: false, directory });
      expect(
        (await capturedFailure(() => store.saveRecords('presets', []))).message
      ).toContain('Timed out acquiring');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects unknown associative scalar types', () => {
    const malformed = serializeRecords('offer', [{ id: 'x' }]).replace(
      'value:object',
      'value:unknown'
    );
    expect(() => deserializeRecords('offer', malformed)).toThrow();
  });
});

describe('issue 10 authentication edge cases', () => {
  it('reads file-backed secrets and rejects ambiguous secret sources', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'secret-file-'));
    const path = join(directory, 'token');
    await writeFile(path, 'from-file\n');
    try {
      expect(
        (await resolveTelegramSecrets({ TELEGRAM_BOT_TOKEN_FILE: path }))
          .botToken
      ).toBe('from-file');
      const error = await capturedFailure(() =>
        resolveTelegramSecrets({
          TELEGRAM_BOT_TOKEN: 'inline',
          TELEGRAM_BOT_TOKEN_FILE: path,
        })
      );
      expect(error.message).toContain('cannot both');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('fails preflight before startup for absent, rejected, or mismatched identities', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    expect(
      (
        await capturedFailure(() =>
          preflightTelegram({ env: {}, fetchImpl: async () => {} })
        )
      ).message
    ).toContain('Configure');

    const directory = await mkdtemp(join(tmpdir(), 'preflight-edges-'));
    try {
      const rejected = await capturedFailure(() =>
        preflightTelegram({
          directory,
          env: { TELEGRAM_BOT_TOKEN: 'secret' },
          fetchImpl: async () => ({
            json: async () => ({ ok: false }),
            ok: false,
            status: 401,
          }),
        })
      );
      expect(rejected.message).toContain('status 401');
      const mismatch = await capturedFailure(() =>
        preflightTelegram({
          directory,
          env: {
            TELEGRAM_BOT_TOKEN: 'secret',
            TELEGRAM_EXPECTED_BOT_ID: '2',
          },
          fetchImpl: async () => ({
            json: async () => ({ ok: true, result: { id: 1 } }),
            ok: true,
            status: 200,
          }),
        })
      );
      expect(mismatch.message).toContain('identity mismatch');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('supports explicit QR login output, status, rotation, and revocation', async () => {
    const calls = [];
    const makeClient = async () => ({
      destroy: async () => calls.push('destroy'),
      exportSession: async () => 'session',
      getMe: async () => ({ id: 7, username: 'owner' }),
      importSession: async (session) => calls.push(`import:${session}`),
      logOut: async () => calls.push('logout'),
      start: async (callbacks) => {
        calls.push(await callbacks.phone());
        calls.push(await callbacks.code());
        calls.push(await callbacks.password());
        calls.push(`qr:${typeof callbacks.qrCodeHandler}`);
      },
    });
    const sessions = [];
    const service = new TelegramAuthService({
      apiHash: 'hash',
      apiId: '7',
      clientFactory: makeClient,
      onSession: async (session) => sessions.push(session),
      qrCodeHandler: () => {},
      session: 'existing',
    });
    expect(
      await service.login({
        code: '12345',
        password: '2fa',
        phone: '+84123',
        qr: true,
      })
    ).toEqual({ id: 7, username: 'owner' });
    expect(sessions).toEqual(['session']);
    expect(calls).toContain('qr:function');
    expect((await service.status()).configured).toBe(true);
    await service.rotate({ code: '2', password: 'p', phone: '+2' });
    await service.logout();
    expect(calls).toContain('logout');
    expect((await service.status()).configured).toBe(false);
  });

  it('rejects invalid credentials, missing prompts, missing sessions, and implicit output', async () => {
    expect(
      (
        await capturedFailure(async () =>
          new TelegramAuthService({ apiHash: '', apiId: 'bad' }).credentials()
        )
      ).message
    ).toContain('TELEGRAM_API_ID');
    const client = {
      destroy: async () => {},
      exportSession: async () => 'secret',
      getMe: async () => ({ id: 1 }),
      start: async ({ phone }) => phone(),
    };
    const noPrompt = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => client,
    });
    expect((await capturedFailure(() => noPrompt.login())).message).toContain(
      'non-interactive'
    );
    expect(
      (await capturedFailure(() => noPrompt.validate())).message
    ).toContain('No Telegram user session');

    const noOutput = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        ...client,
        start: async () => {},
      }),
    });
    expect((await capturedFailure(() => noOutput.login())).message).toContain(
      'explicit session file'
    );
    expect(await noOutput.status()).toEqual({ configured: false });
    await noOutput.logout({ revoke: false });
  });

  it('reads and removes session files and propagates non-missing file errors', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'auth-file-'));
    const sessionFile = join(directory, 'session');
    await writeFile(sessionFile, 'stored');
    const calls = [];
    const service = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => calls.push('destroy'),
        getMe: async () => ({ id: 1 }),
        importSession: async (value) => calls.push(value),
        logOut: async () => calls.push('logout'),
      }),
      sessionFile,
    });
    try {
      expect((await service.status()).configured).toBe(true);
      await service.logout();
      expect(calls).toContain('stored');
      expect((await capturedFailure(() => readFile(sessionFile))).code).toBe(
        'ENOENT'
      );

      const unreadable = new TelegramAuthService({ sessionFile: directory });
      expect((await capturedFailure(() => unreadable.status())).code).toBe(
        'EISDIR'
      );
      const absent = new TelegramAuthService({
        sessionFile: join(directory, 'absent'),
      });
      expect(await absent.status()).toEqual({ configured: false });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('preserves authentication and cleanup failures deterministically', async () => {
    const primary = new Error('invalid login code');
    const cleanup = new Error('disconnect failed');
    const service = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => {
          throw cleanup;
        },
        start: async () => {
          throw primary;
        },
      }),
      onSession: async () => {},
    });

    const error = await capturedFailure(() =>
      service.login({ code: 'bad', password: 'hidden', phone: '+84123' })
    );
    expect(error instanceof AggregateError).toBe(true);
    expect(error.errors).toEqual([primary, cleanup]);
    expect(error.message).toContain('cleanup');
  });
});

describe('hidden terminal input', () => {
  function terminal() {
    const input = new EventEmitter();
    input.isTTY = true;
    input.isRaw = false;
    input.pause = () => {};
    input.resume = () => {};
    input.setEncoding = () => {};
    input.setRawMode = (value) => {
      input.isRaw = value;
    };
    const output = {
      text: '',
      write(value) {
        this.text += value;
      },
    };
    return { input, output };
  }

  it('never echoes input, supports backspace, and restores terminal state', async () => {
    expect(() => secretPrompt({ input: {}, label: 'Code' })).toThrow();
    const { input, output } = terminal();
    const pending = secretPrompt({ input, label: 'Password', output });
    input.emit('data', 'ab\u007fc\n');
    expect(await pending).toBe('ac');
    expect(output.text).toBe('Password: \n');
    expect(input.isRaw).toBe(false);
  });

  it('turns Ctrl-C into a cancellable authentication error', async () => {
    const { input, output } = terminal();
    const pending = secretPrompt({ input, label: 'Code', output });
    input.emit('data', '\u0003');
    expect((await capturedFailure(() => pending)).name).toBe('AbortError');
  });
});

describe('issue 10 preset and application defaults', () => {
  it('validates names, aliases variants, bounds history, and covers missing records', async () => {
    const store = memoryStore();
    const presets = new PresetService({ maxShownPerUser: 1, store });
    expect(
      (await capturedFailure(() => presets.save('1', 'bad name'))).name
    ).toBe('TypeError');
    expect(
      (await capturedFailure(() => presets.show('1', 'missing'))).message
    ).toContain('does not exist');
    expect(
      (await capturedFailure(() => presets.delete('1', 'default'))).message
    ).toContain('cannot be deleted');
    expect(
      (await capturedFailure(() => presets.delete('1', 'missing'))).message
    ).toContain('does not exist');
    await presets.markSuccessfulRun('absent');
    await presets.markDelivered('1', [
      { id: 'old' },
      {
        id: 'new',
        identityKeys: ['key'],
        officialUrl: 'official',
        url: 'url',
        variants: [{ id: 'variant', officialUrl: 'v-official', url: 'v-url' }],
      },
    ]);
    expect(await presets.unseen('1', [{ id: 'variant' }])).toEqual([]);
    expect(await presets.subscription('1')).toBe(undefined);
    await presets.save('1', 'typed', { types: ['hotel', 'studio'] });
    await presets.use('1', 'typed');
    expect((await presets.subscribe('1')).presetName).toBe('typed');
  });

  it('starts once, reports background search failure, and stops cleanly', async () => {
    const errors = [];
    const scheduler = new SubscriptionScheduler({
      deliver: async () => {},
      intervalMs: 100_000,
      logger: { error: (...values) => errors.push(values) },
      presets: {
        listSubscriptions: async () => {
          throw new Error('search down');
        },
      },
      search: async () => [],
    });
    scheduler.start();
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await scheduler.stop();
    expect(errors[0][0]).toBe('subscription search failed');

    const typed = new SubscriptionScheduler({
      deliver: async () => {},
      presets: {
        listSubscriptions: async () => [
          { options: { types: ['hotel', 'studio'] }, userId: '1' },
        ],
        markSuccessfulRun: async () => {},
        unseen: async () => [],
      },
      search: async () => [],
    });
    await typed.tick();
  });

  it('constructs the complete default application graph', () => {
    if (!isNodeRuntime()) {
      return;
    }
    const previous = process.env.BROWSER_NO_SANDBOX;
    const previousMirror = process.env.LINKS_BINARY_MIRROR;
    process.env.BROWSER_NO_SANDBOX = '1';
    process.env.LINKS_BINARY_MIRROR = '1';
    try {
      const app = createApplication({ directory: '.test-default-app' });
      expect(app.store.mirror instanceof LinkCliMirror).toBe(true);
      expect(app.collector.browserLaunchOptions.args).toContain('--no-sandbox');
      expect(typeof app.createAvailabilityService).toBe('function');
      expect(typeof app.createBot).toBe('function');
      expect(
        app.createTelegramIngestionService({
          apiHash: 'hash',
          apiId: 1,
          session: 'session',
        }).provider.transport
      ).toBe('mtproto');
    } finally {
      if (previous === undefined) {
        delete process.env.BROWSER_NO_SANDBOX;
      } else {
        process.env.BROWSER_NO_SANDBOX = previous;
      }
      if (previousMirror === undefined) {
        delete process.env.LINKS_BINARY_MIRROR;
      } else {
        process.env.LINKS_BINARY_MIRROR = previousMirror;
      }
    }
  });
});

describe('issue 10 Telegram lifecycle edges', () => {
  it('serves loopback liveness/readiness and closes mixed resource types', async () => {
    if (!isNodeRuntime()) {
      return;
    }
    const closed = [];
    const bot = {
      api: { getMe: async () => ({ id: 1 }) },
      start: async ({ onStart }) => onStart(),
      stop: async () => closed.push('bot'),
    };
    const runtime = new TelegramRuntime({
      bot,
      healthPort: 0,
      logger: { info: () => {} },
      resources: [
        { close: async () => closed.push('close') },
        { disconnect: async () => closed.push('disconnect') },
      ],
    });
    await runtime.start();
    const port = runtime.server.address().port;
    expect(
      (await (await fetch(`http://127.0.0.1:${port}/live`)).json()).status
    ).toBe('live');
    expect(
      (await (await fetch(`http://127.0.0.1:${port}/ready`)).json()).status
    ).toBe('ready');
    expect(runtime.stop('done')).toBe(runtime.stop('again'));
    await runtime.stop('done');
    expect(closed).toEqual(['bot', 'close', 'disconnect']);
  });

  it('ignores updates while draining and logs nonfatal update failures', async () => {
    const warnings = [];
    let handler;
    const runtime = new TelegramRuntime({
      bot: {
        catch: (value) => {
          handler = value;
        },
      },
      healthPort: null,
      logger: { info: () => {}, warn: (...values) => warnings.push(values) },
    });
    let called = false;
    await runtime.middleware({}, async () => {
      called = true;
    });
    expect(called).toBe(false);
    await handler(new Error('ordinary update failure'));
    expect(warnings[0][0]).toBe('telegram update failed');
  });

  it('maps polling conflicts and startup authentication failures to fatal exits', async () => {
    const errors = [];
    const conflict = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: async () => {
          throw { error_code: 409 };
        },
        stop: async () => {},
      },
      healthPort: null,
      logger: { error: (...values) => errors.push(values), info: () => {} },
    });
    const conflictError = await capturedFailure(() => conflict.start());
    expect(conflictError.exitCode).toBe(21);

    const auth = new TelegramRuntime({
      bot: {
        api: {
          getMe: async () => {
            throw { error_code: 401 };
          },
        },
        stop: async () => {},
      },
      healthPort: null,
      logger: { error: (...values) => errors.push(values), info: () => {} },
    });
    expect((await capturedFailure(() => auth.start())).exitCode).toBe(20);
    expect(errors.length).toBe(2);
  });

  it('handles a polling failure after readiness and reports failed fatal cleanup', async () => {
    let rejectPolling;
    const errors = [];
    const polling = new Promise((_resolve, reject) => {
      rejectPolling = reject;
    });
    const runtime = new TelegramRuntime({
      bot: {
        api: { getMe: async () => ({ id: 1 }) },
        start: ({ onStart }) => {
          onStart();
          return polling;
        },
        stop: async () => {
          throw new Error('cannot stop');
        },
      },
      healthPort: null,
      logger: { error: (...values) => errors.push(values), info: () => {} },
    });
    await runtime.start();
    const failure = Object.assign(new Error('poll conflict'), {
      error_code: 409,
    });
    rejectPolling(failure);
    expect((await capturedFailure(() => runtime.polling)).exitCode).toBe(21);
    expect(errors.map(([message]) => message)).toContain(
      'telegram shutdown failed'
    );
  });

  it('aggregates shutdown, drain, resource, polling, and health-close failures', async () => {
    let pollingReject;
    const polling = new Promise((_resolve, reject) => {
      pollingReject = reject;
    });
    const runtime = new TelegramRuntime({
      bot: {
        start: () => polling,
        stop: async () => {
          throw new Error('bot stop');
        },
      },
      drainDeadlineMs: 0,
      healthPort: null,
      logger: { info: () => {} },
      resources: [
        {
          destroy: async () => {
            throw new Error('resource close');
          },
        },
      ],
      scheduler: {
        stop: async () => {
          throw new Error('scheduler stop');
        },
      },
    });
    runtime.startPromise = polling;
    runtime.inFlight = 1;
    runtime.server = {
      close: (callback) => callback(new Error('health close')),
    };
    pollingReject(new Error('polling stop'));
    const error = await capturedFailure(() => runtime.stop('test'));
    expect(error instanceof AggregateError).toBe(true);
    expect(error.errors.length).toBeGreaterThan(3);
    expect(runtime.exitCode).toBe(22);
  });

  it('installs removable signal handlers and accepts non-message updates once', async () => {
    const processLike = new EventEmitter();
    processLike.exitCode = undefined;
    const runtime = new TelegramRuntime({ healthPort: null });
    const remove = runtime.installSignalHandlers(processLike);
    expect(processLike.listenerCount('SIGINT')).toBe(1);
    processLike.emit('SIGINT');
    await Promise.resolve();
    remove();
    expect(processLike.listenerCount('SIGTERM')).toBe(0);

    const store = memoryStore();
    const deduplicator = new UpdateDeduplicator({ store });
    expect(
      await deduplicator.accept({ inline_query: { id: 'untracked' } })
    ).toBe(true);
    expect(
      await deduplicator.accept({
        channel_post: { chat: { id: -1 }, date: 2, message_id: 1 },
      })
    ).toBe(true);
    const editedChannelPost = {
      edited_channel_post: {
        chat: { id: -1 },
        date: 2,
        edit_date: 3,
        message_id: 1,
      },
    };
    expect(await deduplicator.accept(editedChannelPost)).toBe(true);
    expect(await deduplicator.accept(editedChannelPost)).toBe(false);
  });

  it('reports signal cleanup failures with the cleanup exit code', async () => {
    const processLike = new EventEmitter();
    processLike.exitCode = undefined;
    const errors = [];
    const runtime = new TelegramRuntime({
      healthPort: null,
      logger: {
        error: (...values) => errors.push(values),
        info: () => {},
      },
      scheduler: {
        stop: async () => {
          throw new Error('scheduler cleanup failed');
        },
      },
    });
    runtime.installSignalHandlers(processLike);

    processLike.emit('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(processLike.exitCode).toBe(22);
    expect(errors[0][0]).toBe('telegram shutdown failed');
  });

  it('waits for an in-flight update within the drain deadline', async () => {
    const runtime = new TelegramRuntime({
      bot: { stop: async () => {} },
      drainDeadlineMs: 100,
      healthPort: null,
      logger: { info: () => {} },
    });
    runtime.accepting = true;
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const update = runtime.middleware({}, async () => blocked);
    setTimeout(release, 25);
    await runtime.stop('drain');
    await update;
    expect(runtime.inFlight).toBe(0);
  });

  it('routes every MTProto-only capability and rejects unsupported modes', async () => {
    expect(() => new TelegramCapabilityRouter({ mode: 'invalid' })).toThrow();
    const calls = [];
    const provider = {
      liveUpdates: async () => calls.push('live'),
      media: async () => calls.push('media'),
      membership: async () => calls.push('membership'),
      popularity: async () => calls.push('popularity'),
      resolveEntity: async () => calls.push('entity'),
    };
    const router = new TelegramCapabilityRouter({
      mode: 'user-only',
      user: provider,
    });
    await router.liveUpdates();
    await router.media();
    await router.membership();
    await router.popularity();
    await router.resolveEntity();
    expect(calls).toEqual([
      'live',
      'media',
      'membership',
      'popularity',
      'entity',
    ]);
  });
});

describe('issue 10 Telegram command and ingestion edges', () => {
  function commandBot() {
    const commands = new Map();
    const handlers = new Map();
    return {
      bot: {
        command: (name, handler) => commands.set(name, handler),
        on: (name, handler) => handlers.set(name, handler),
      },
      commands,
      handlers,
    };
  }

  it('bounds direct replies and reports missing identity and command dependencies', async () => {
    const { bot, commands } = commandBot();
    registerTelegramHandlers(bot, {
      registry: { update: async () => ({ telegram: [], web: [] }) },
      service: {
        search: async () => [
          { id: 'long', priceVnd: 1, title: 'x'.repeat(5000) },
        ],
      },
    });
    const replies = [];
    await commands.get('search')({
      match: '',
      reply: async (text) => replies.push(text),
    });
    expect(replies.length).toBe(2);
    for (const name of ['preset', 'subscribe', 'unsubscribe', 'subscription']) {
      await commands.get(name)({
        from: { id: 1 },
        match: 'unknown',
        reply: async (text) => replies.push(text),
      });
    }
    const identified = commandBot();
    registerTelegramHandlers(identified.bot, {
      presetService: { resolveSearch: async (_user, options) => options },
      registry: { update: async () => ({ telegram: [], web: [] }) },
      service: { search: async () => [] },
    });
    await identified.commands.get('search')({
      match: '',
      reply: async (text) => replies.push(text),
    });
    expect(replies.join('\n')).toContain('not configured');
    expect(replies.join('\n')).toContain('requires a Telegram user');
  });

  it('reports unknown preset actions and authorization failures for subscription commands', async () => {
    const { bot, commands } = commandBot();
    const presetService = {
      activeName: async () => 'default',
      list: async () => [],
      resolveSearch: async (_user, options) => options,
      subscription: async () => undefined,
    };
    registerTelegramHandlers(bot, {
      accessPolicy: {
        authorize: (_context, { action }) => {
          if (action === 'subscribe') {
            throw new Error('denied');
          }
        },
      },
      presetService,
      registry: { update: async () => ({ telegram: [], web: [] }) },
      service: { search: async () => [] },
    });
    const replies = [];
    const context = {
      from: { id: 1 },
      match: 'unexpected',
      reply: async (text) => replies.push(text),
    };
    await commands.get('preset')(context);
    await commands.get('subscribe')(context);
    await commands.get('unsubscribe')(context);
    await commands.get('subscription')(context);
    expect(replies[0]).toContain('Unknown preset action');
    expect(replies.slice(1)).toEqual([
      'denied\nUsage: /subscribe [PRESET]',
      'denied',
      'denied',
    ]);
  });

  it('runs runtime and persistent deduplication middleware deterministically', async () => {
    const calls = [];
    const bot = {};
    const plain = telegramRuntimeMiddleware(bot);
    await plain({}, async () => calls.push('next'));
    bot.runtime = {
      middleware: async (_context, next) => {
        calls.push('runtime');
        return next();
      },
    };
    await plain({}, async () => calls.push('next'));
    const accepted = telegramDeduplicationMiddleware({
      accept: async ({ id }) => id === 1,
    });
    await accepted({ update: { id: 1 } }, async () => calls.push('accepted'));
    await accepted({ update: { id: 2 } }, async () => calls.push('duplicate'));
    expect(calls).toEqual(['next', 'runtime', 'next', 'accepted']);
  });

  it('validates access modes, redacts cycles, and keeps the latest edited history item', async () => {
    expect(() => new TelegramAccessPolicy({ mode: 'invalid' })).toThrow();
    const circular = {};
    circular.self = circular;
    expect(redactTelegramValue(circular).self).toBe('[CIRCULAR]');

    async function* history() {
      yield {
        date: '2026-09-20T00:00:00Z',
        editDate: 1,
        id: 1,
        text: 'Room Nha Trang 1,000,000 VND/month',
      };
      yield {
        date: '2026-09-20T00:00:00Z',
        editDate: 2,
        id: 1,
        text: 'Room Nha Trang 2,000,000 VND/month',
      };
    }
    const collector = new TelegramHistoryCollector({
      now: () => new Date('2026-09-22T00:00:00Z'),
      rateProvider: { getRates: async () => ({ VND: 1 }) },
      router: { history: async () => history() },
    });
    const offers = await collector.collect([{ id: 'telegram:one' }]);
    expect(offers[0].priceVnd).toBe(2_000_000);
  });
});
