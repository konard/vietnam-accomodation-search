import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import { runReleaseAudit } from '../experiments/run-release-audit.mjs';
import {
  BrowserCollector,
  DomainScheduler,
  MtcuteTelegramProvider,
  SearchService,
  SubscriptionScheduler,
  TelegramAuthService,
  TelegramHistoryCollector,
  TelegramIngestionService,
  createApplication,
  createReleaseAudit,
  normalizeMtcuteMessage,
  validateTelegramConfiguration,
} from '../src/index.js';

const isDenoRuntime = typeof globalThis.Deno !== 'undefined';
const isWindowsRuntime =
  typeof globalThis.process !== 'undefined' && process.platform === 'win32';

async function failureOf(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

function memoryRecords() {
  const records = new Map();
  return {
    records,
    deleteOffersByMessages: async () => {},
    listOffers: async () => records.get('offers') || [],
    loadRecords: async (kind) => records.get(kind) || [],
    loadSources: async () => records.get('sources') || [],
    saveOffers: async (offers) => records.set('offers', offers),
    saveRecords: async (kind, values) => records.set(kind, values),
    saveSources: async (sources) => records.set('sources', sources),
    updateRecords: async (kind, update) => {
      const next = await update(records.get(kind) || []);
      records.set(kind, next);
      return next;
    },
  };
}

describe('issue 20 composition and failure tracing', () => {
  it('wires configured MTProto and all registry discovery routes', async () => {
    // Constructing the real grammY Bot loads a Node dependency that inspects
    // process.env. The Deno CI leg intentionally grants read access only.
    if (isDenoRuntime) {
      return;
    }
    const store = memoryRecords();
    let clients = 0;
    let activeClients = 0;
    let maxActiveClients = 0;
    let botDiscoveryCalls = 0;
    const app = createApplication({
      botDiscoveryApi: {
        getChat: async (username) => {
          botDiscoveryCalls += 1;
          return {
            id: -100,
            title: 'Bot-visible rentals',
            type: 'channel',
            username: String(username).replace(/^@/u, ''),
          };
        },
      },
      collector: {},
      discoverer: {
        discover: async (type) =>
          type === 'web'
            ? [
                {
                  id: 'web:fixture',
                  languages: ['en'],
                  name: 'Web fixture',
                  popularity: { evidenceUrl: 'https://web.test', value: 1 },
                  searchUrl: 'https://web.test/search?q={query}',
                  type: 'web',
                  url: 'https://web.test',
                },
              ]
            : [],
      },
      environment: {},
      mediaCache: {},
      mtcuteClientFactory: async () => {
        clients += 1;
        return {
          destroy: async () => {
            activeClients -= 1;
          },
          getMe: async () => ({ id: 7 }),
          async *iterDialogs() {},
          async *iterSearchGlobal() {},
          start: async () => {
            activeClients += 1;
            maxActiveClients = Math.max(maxActiveClients, activeClients);
          },
        };
      },
      presetService: {},
      service: {},
      store,
      telegramCredentials: {
        apiHash: 'hash',
        apiId: '1',
        session: 'native-session',
      },
      traceRecorder: {
        persist: async () => {},
        record: () => {},
      },
      updateDeduplicator: {},
    });

    await app.createBot('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi');
    const result = await app.registry.update({
      focusCount: 1,
      telegramCount: 1,
      webCount: 1,
    });
    expect(result.web[0].id).toBe('web:fixture');
    expect(result.telegram.length > 0).toBe(true);
    expect(botDiscoveryCalls > 0).toBe(true);
    expect(clients > 0).toBe(true);
    expect(maxActiveClients).toBe(1);
    expect(store.records.has('telegram-discovery-checkpoint')).toBe(true);

    store.updateRecords = undefined;
    await app.registry.update({
      focusCount: 1,
      telegramCount: 1,
      webCount: 1,
    });
    expect(store.records.get('telegram-discovery-checkpoint').length > 0).toBe(
      true
    );
  });

  it('records search and subscription failures before propagating them', async () => {
    const searchEvents = [];
    const service = new SearchService({
      collector: {
        collect: async () => {
          const error = new Error('operator stopped search');
          error.name = 'AbortError';
          throw error;
        },
      },
      registry: { list: async () => [] },
      store: { listOffers: async () => [], saveOffers: async () => {} },
      traceRecorder: {
        persist: async () => {},
        record: (event) => searchEvents.push(event),
      },
    });
    expect((await failureOf(() => service.search())).name).toBe('AbortError');
    expect(searchEvents.at(-1).status).toBe('cancelled');

    const subscriptionEvents = [];
    const scheduler = new SubscriptionScheduler({
      deliver: async () => {},
      presets: {
        listSubscriptions: async () => [{ options: {}, userId: '1' }],
      },
      search: async () => {
        throw new Error('search unavailable');
      },
      traceRecorder: {
        persist: async () => {},
        record: (event) => subscriptionEvents.push(event),
      },
    });
    expect((await failureOf(() => scheduler.tick())).message).toBe(
      'search unavailable'
    );
    expect(subscriptionEvents.at(-1).status).toBe('failure');
  });
});

describe('issue 20 browser, release, auth, and history runtime edges', () => {
  it('atomically replaces release-audit output with private permissions', async () => {
    // This assertion needs environment and filesystem write access, which the
    // Deno leg omits; Windows does not implement POSIX permission mode bits.
    if (isDenoRuntime || isWindowsRuntime) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'release-audit-'));
    const output = join(directory, 'audit.json');
    try {
      await writeFile(output, 'old evidence');
      await chmod(output, 0o644);
      await runReleaseAudit(['--output', output], {});
      expect((await stat(output)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('uses the cancellable default delay and inherits a source location', async () => {
    const scheduler = new DomainScheduler({ maxDelayMs: 1, minDelayMs: 1 });
    expect(await scheduler.run('https://delay.test', () => 'done')).toBe(
      'done'
    );
    const controller = new AbortController();
    const waiting = new DomainScheduler({
      maxDelayMs: 10_000,
      minDelayMs: 10_000,
    }).run('https://cancel-delay.test', () => 'never', {
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error('delay cancelled'));
    expect((await failureOf(() => waiting)).message).toBe('delay cancelled');

    let abortedReads = 0;
    const alreadyCancelledDelay = new DomainScheduler({
      maxDelayMs: 1,
      minDelayMs: 1,
    }).run('https://cancel-before-delay.test', () => 'never', {
      signal: {
        addEventListener: () => {},
        get aborted() {
          abortedReads += 1;
          return abortedReads === 2;
        },
        reason: new Error('cancelled before delay'),
      },
    });
    expect((await failureOf(() => alreadyCancelledDelay)).message).toBe(
      'cancelled before delay'
    );

    const afterDelayController = new AbortController();
    const cancelledAfterDelay = new DomainScheduler({
      delay: async () =>
        afterDelayController.abort(new Error('cancelled after delay')),
      maxDelayMs: 1,
      minDelayMs: 1,
    }).run('https://cancel-after-delay.test', () => 'never', {
      signal: afterDelayController.signal,
    });
    expect((await failureOf(() => cancelledAfterDelay)).message).toBe(
      'cancelled after delay'
    );

    const collector = new BrowserCollector({
      now: () => new Date('2026-09-22T00:00:00Z'),
    });
    let page = 0;
    const offers = await collector.collectSource(
      {
        evaluate: async () =>
          page++ === 0
            ? [
                {
                  date: '2026-09-21T00:00:00Z',
                  text: 'Apartment for rent 8,000,000 VND/month',
                  url: 'https://t.me/fixture/1',
                },
                {
                  date: '2026-09-21T00:00:00Z',
                  text: 'Visa service in Nha Trang',
                  url: 'https://t.me/fixture/2',
                },
              ]
            : [],
        goto: async () => {},
      },
      {
        focus: 'nha-trang',
        id: 'telegram:fixture',
        name: 'Fixture',
        searchUrl: 'https://t.me/s/fixture',
        type: 'telegram',
        url: 'https://t.me/fixture',
      },
      '',
      { VND: 1 }
    );
    expect(offers[0].location).toBe('Nha Trang, Vietnam');
  });

  it('preserves structured release evidence and rejects foreign sessions', async () => {
    const audit = createReleaseAudit({
      gates: {
        'offline-quality-and-clean-install': {
          note: 'verified',
          status: 'pass',
        },
      },
    });
    expect(audit.gates['offline-quality-and-clean-install'].note).toBe(
      'verified'
    );
    expect(() =>
      validateTelegramConfiguration({
        apiHash: 'hash',
        apiId: '1',
        session: 'foreign',
        sessionFormat: 'gramjs/string-session-v1',
      })
    ).toThrow();
    expect(() =>
      validateTelegramConfiguration({
        apiHash: 'hash',
        apiId: '1',
        session: 'unknown',
        sessionFormat: 'unknown/v9',
      })
    ).toThrow();
  });

  it('writes session envelopes and reports every validation status class', async () => {
    let envelope;
    const login = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => {},
        exportSession: async () => 'new-native-session',
        getMe: async () => ({ id: 42, username: 'owner' }),
        start: async () => {},
      }),
      onSessionEnvelope: async (value) => {
        envelope = value;
      },
    });
    expect((await login.login()).id).toBe(42);
    expect(JSON.parse(envelope).expectedUserId).toBe('42');

    const status = (session, clientFactory, expectedUserId) =>
      new TelegramAuthService({
        apiHash: 'hash',
        apiId: 1,
        clientFactory,
        expectedUserId,
        session,
      }).status();
    expect((await status('{}')).state).toBe('partial');
    expect(
      (
        await status(
          JSON.stringify({
            format: 'foreign/session-v1',
            payload: 'x',
            provider: 'foreign',
            schemaVersion: 1,
            sessionId: 'foreign:1',
          })
        )
      ).state
    ).toBe('unsupported');
    let foreignClients = 0;
    expect(
      (
        await new TelegramAuthService({
          apiHash: 'hash',
          apiId: 1,
          clientFactory: async () => {
            foreignClients += 1;
            return {};
          },
          session: 'gramjs-native-fixture',
          sessionFormat: 'gramjs/string-session-v1',
        }).status()
      ).state
    ).toBe('relogin-required');
    expect(foreignClients).toBe(0);

    const failingClient = (failure) => async () => ({
      destroy: async () => {},
      importSession: async () => {
        throw failure;
      },
    });
    const expired = new Error('session expired');
    expired.code = 'SESSION_EXPIRED';
    expect((await status('native', failingClient(expired))).state).toBe(
      'expired-or-revoked'
    );
    expect(
      (await status('native', failingClient(new Error('network down')))).state
    ).toBe('degraded');
    expect(
      (
        await status(
          'native',
          async () => ({
            destroy: async () => {},
            getMe: async () => ({ id: 2 }),
            importSession: async () => {},
          }),
          1
        )
      ).state
    ).toBe('identity-mismatch');
  });

  it('filters irrelevant history before parsing', async () => {
    const collector = new TelegramHistoryCollector({
      now: () => new Date('2026-09-22T00:00:00Z'),
      router: {
        history: async () => [
          {
            date: '2026-09-21T00:00:00Z',
            id: 1,
            text: 'I like apartment architecture',
          },
        ],
      },
    });
    expect(
      (
        await collector.collect([
          { focus: 'nha-trang', id: 'telegram:fixture' },
        ])
      ).length
    ).toBe(0);
  });
});

describe('issue 20 concrete MTProto edge behavior', () => {
  function providerWith(client, options = {}) {
    return new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => client,
      discoveryFolders: ['folder'],
      logger: { debug: () => {} },
      session: 'native',
      ...options,
    });
  }

  function discoveryClient(overrides = {}) {
    return {
      destroy: async () => {},
      getMe: async () => ({ id: 1 }),
      async *iterDialogs() {},
      async *iterSearchGlobal() {},
      start: async () => {},
      ...overrides,
    };
  }

  it('classifies unsupported peers and contains folder/search failures', async () => {
    const provider = providerWith(
      discoveryClient({
        async *iterDialogs() {
          yield { peer: { id: 5, type: 'unsupported' } };
          const error = new Error('folder missing');
          error.code = 'FOLDER_MISSING';
          throw error;
        },
        async *iterSearchGlobal() {
          yield { chat: { id: 6, type: 'unsupported' } };
          const error = new Error('search missing');
          error.code = 'SEARCH_MISSING';
          throw error;
        },
      })
    );
    const result = await provider.discover({
      focus: 'nha-trang',
      queries: [{ id: 'en', language: 'en', text: 'rent' }],
    });
    expect(result[0].entity._).toBe('unsupported');
    expect(result.failures.length).toBe(2);
    await provider.destroy();
  });

  it('resolves MTProto history from nested discovered peer metadata', async () => {
    const peers = [];
    const provider = providerWith(
      discoveryClient({
        iterHistory(peer) {
          peers.push(peer);
          return [];
        },
        resolvePeer: async (peer) => {
          peers.push(peer);
          return `resolved:${peer}`;
        },
      })
    );
    const history = await provider.history({
      id: 'telegram:peer:77',
      telegram: { kind: 'channel', peerId: '77' },
    });
    const messages = [];
    for await (const message of history) {
      messages.push(message);
    }
    expect(messages).toEqual([]);
    expect(peers).toEqual(['77', '77']);
    await provider.destroy();
  });

  it('resumes MTProto history newer and older than a durable checkpoint', async () => {
    const calls = [];
    const provider = providerWith(
      discoveryClient({
        async *iterHistory(peer, options) {
          calls.push([peer, options]);
          if (!options.minId) {
            yield {
              chat: {},
              date: new Date('2026-09-21T00:00:00Z'),
              id: 301,
              text: '',
            };
          }
          yield {
            chat: {},
            date: new Date(
              options.minId ? '2026-09-21T00:00:00Z' : '2026-09-19T00:00:00Z'
            ),
            id: options.minId ? 301 : 249,
            text: '',
          };
        },
        resolvePeer: async () => {},
      })
    );
    const history = await provider.history(
      { id: 'telegram:fixture', telegram: { username: 'fixture' } },
      {
        resume: {
          oldestMessageDate: '2026-09-20T00:00:00Z',
          oldestMessageId: 250,
        },
        since: new Date('2026-09-01T00:00:00Z'),
      }
    );
    const messages = [];
    for await (const message of history) {
      messages.push(message);
    }
    expect(messages.map(({ id }) => id)).toEqual([301, 249]);
    expect(calls[0][1]).toEqual({ minId: 250 });
    expect(calls[1][1]).toEqual({
      offset: { date: new Date('2026-09-20T00:00:00Z'), id: 250 },
    });
    await provider.destroy();
  });

  it('propagates operator cancellation inside both discovery iterators', async () => {
    const folderController = new AbortController();
    const folder = providerWith(
      discoveryClient({
        async *iterDialogs() {
          folderController.abort(new Error('folder cancelled'));
          yield { peer: { type: 'chat' } };
        },
      })
    );
    expect(
      (
        await failureOf(() =>
          folder.discover({
            focus: 'nha-trang',
            signal: folderController.signal,
          })
        )
      ).message
    ).toBe('folder cancelled');
    await folder.destroy();

    const searchController = new AbortController();
    const search = providerWith(
      discoveryClient({
        async *iterSearchGlobal() {
          searchController.abort(new Error('search cancelled'));
          yield { chat: { type: 'chat' } };
        },
      })
    );
    expect(
      (
        await failureOf(() =>
          search.discover({
            queries: [{ id: 'en', language: 'en', text: 'rent' }],
            signal: searchController.signal,
          })
        )
      ).message
    ).toBe('search cancelled');
    await search.destroy();
  });

  it('normalizes inherited locations and checkpoints a 250-message backfill', async () => {
    expect(
      normalizeMtcuteMessage(
        { chat: {}, date: new Date(), id: 1, text: '' },
        { focus: 'nha-trang', id: 'telegram:fixture' }
      ).inheritedLocation
    ).toBe('Nha Trang, Vietnam');

    const store = memoryRecords();
    let handler;
    const source = { focus: 'nha-trang', id: 'telegram:fixture' };
    const provider = {
      destroy: async () => {},
      history: async () =>
        Array.from({ length: 250 }, (_, index) =>
          index === 0
            ? {
                chat: { username: 'fixture' },
                contacts: { phone: ['+84123456789'] },
                date: '2026-09-21T00:00:00Z',
                groupedId: 'album-1',
                id: 1,
                inheritedLocation: 'Nha Trang, Vietnam',
                inheritedLocationSource: source.id,
                media: { id: 'photo-1', mimeType: 'image/jpeg' },
                sourceId: source.id,
                text: 'Cho thuê căn hộ Nha Trang 8,000,000 VND/month, phone +84123456789',
              }
            : {
                date: '2026-09-21T00:00:00Z',
                id: index + 1,
                isService: true,
                sourceId: source.id,
                text: '',
              }
        ),
      liveUpdates: async (next) => {
        handler = next;
        return { stop: () => {} };
      },
    };
    const service = new TelegramIngestionService({ provider, store });
    await service.start([source]);
    const checkpoints = store.records.get('telegram-ingestion-checkpoints');
    expect(checkpoints.some(({ messages }) => messages === 250)).toBe(true);
    expect(
      checkpoints.some(
        ({ oldestMessageDate }) => oldestMessageDate === '2026-09-21T00:00:00Z'
      )
    ).toBe(true);
    const graph = store.records.get('domain-records');
    expect(graph.some(({ type }) => type === 'album')).toBe(true);
    expect(graph.some(({ type }) => type === 'media')).toBe(true);
    expect(graph.some(({ type }) => type === 'contact')).toBe(true);

    for (const id of [251, 252]) {
      await handler({
        message: {
          date: '2026-09-22T00:00:00Z',
          groupedId: 'live-album',
          id,
          sourceId: source.id,
          text:
            id === 251
              ? 'Apartment for rent in Nha Trang 7,000,000 VND/month'
              : 'contact +84111111111',
        },
        sourceId: source.id,
        type: 'new',
      });
    }
    await handler({
      message: {
        date: '2026-09-22T00:00:00Z',
        id: 253,
        sourceId: source.id,
        text: 'Apartment for rent in Nha Trang, contact by direct message',
      },
      sourceId: source.id,
      type: 'new',
    });
    await service.destroy();
  });

  it('loads an incomplete backfill checkpoint and its stored material', async () => {
    const store = memoryRecords();
    const source = { focus: 'nha-trang', id: 'telegram:fixture' };
    store.records.set('telegram-ingestion-checkpoints', [
      {
        complete: false,
        id: source.id,
        oldestMessageDate: '2026-09-20T00:00:00Z',
        oldestMessageId: 250,
      },
    ]);
    store.records.set('telegram-events', [
      {
        id: 'stored-event',
        message: {
          date: '2026-09-20T00:00:00Z',
          id: 250,
          isService: true,
          sourceId: source.id,
          text: '',
        },
        sourceId: source.id,
        type: 'backfill',
      },
    ]);
    store.records.set('domain-records', [
      { id: 'offer:old', type: 'offer' },
      {
        id: 'offer:old#source',
        object: 'telegram:fixture',
        predicate: 'offer.sourceId',
        subject: 'offer:old',
        type: 'semantic-link',
      },
      {
        id: 'offer:old#message',
        object: 4,
        predicate: 'offer.messageIds.0',
        subject: 'offer:old',
        type: 'semantic-link',
      },
      { id: 'contact:old', type: 'contact' },
      {
        id: 'contact:old#offer',
        object: 'offer:old',
        predicate: 'contact.offerId',
        subject: 'contact:old',
        type: 'semantic-link',
      },
    ]);
    let historyOptions;
    const service = new TelegramIngestionService({
      provider: {
        destroy: async () => {},
        history: async (_source, options) => {
          historyOptions = options;
          return [];
        },
        liveUpdates: async () => ({ stop: () => {} }),
      },
      store,
    });
    await service.start([source]);
    expect(historyOptions.resume).toEqual({
      oldestMessageDate: '2026-09-20T00:00:00Z',
      oldestMessageId: 250,
    });
    expect(
      store.records
        .get('telegram-ingestion-checkpoints')
        .find(({ id }) => id === source.id).messages
    ).toBe(1);
    await service.destroy();
  });

  it('prunes raw events outside the rolling two-month retention window', async () => {
    const store = memoryRecords();
    store.updateRecords = undefined;
    store.records.set('telegram-events', [
      {
        id: 'old-event',
        message: { date: '2026-06-01T00:00:00Z', id: 4 },
        sourceId: 'telegram:fixture',
        type: 'backfill',
      },
      {
        id: 'recent-event',
        message: { date: '2026-09-01T00:00:00Z', id: 5 },
        sourceId: 'telegram:fixture',
        type: 'backfill',
      },
    ]);
    const service = new TelegramIngestionService({
      now: () => new Date('2026-09-22T00:00:00Z'),
      provider: {
        destroy: async () => {},
        history: async () => [],
        liveUpdates: async () => ({ stop: () => {} }),
      },
      store,
    });

    await service.start([{ id: 'telegram:fixture' }]);
    expect(store.records.get('telegram-events').map(({ id }) => id)).toEqual([
      'recent-event',
    ]);
    expect(
      store.records.get('domain-records').some(({ id }) => id === 'contact:old')
    ).toBe(false);
    await service.destroy();
  });

  it('contains secondary trace persistence failures during live and startup errors', async () => {
    const debug = [];
    let handler;
    let storeFails = false;
    let traceFails = false;
    const store = memoryRecords();
    store.saveRecords = async (kind, values) => {
      if (storeFails) {
        throw new Error('primary persistence failed');
      }
      store.records.set(kind, values);
    };
    store.updateRecords = undefined;
    const trace = {
      persist: async () => {
        if (traceFails) {
          throw new Error('trace persistence failed');
        }
      },
      record: () => {},
    };
    const live = new TelegramIngestionService({
      logger: { debug: (...values) => debug.push(values), error: () => {} },
      provider: {
        destroy: async () => {},
        history: async () => [],
        liveUpdates: async (next) => {
          handler = next;
          return { stop: () => {} };
        },
      },
      store,
      traceRecorder: trace,
    });
    await live.start([]);
    storeFails = true;
    traceFails = true;
    expect(
      (
        await failureOf(() =>
          handler({
            message: { id: 1, isService: true },
            sourceId: 'telegram:fixture',
            type: 'new',
          })
        )
      ).message
    ).toBe('primary persistence failed');
    expect(debug[0][0]).toContain('failure trace persistence failed');
    await live.destroy();

    const startupDebug = [];
    const startup = new TelegramIngestionService({
      logger: {
        debug: (...values) => startupDebug.push(values),
      },
      provider: {
        destroy: async () => {},
        history: async () => {
          throw new Error('history failed');
        },
      },
      store: memoryRecords(),
      traceRecorder: {
        persist: async () => {
          throw new Error('trace failed');
        },
        record: () => {},
      },
    });
    expect((await failureOf(() => startup.start([{}]))).message).toBe(
      'history failed'
    );
    expect(startupDebug[0][0]).toContain('startup trace persistence failed');
  });
});
