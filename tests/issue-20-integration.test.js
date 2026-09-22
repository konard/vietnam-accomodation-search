import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  BROWSER_SOURCE_ADAPTERS,
  BotApiTelegramDiscoveryProvider,
  DEFAULT_WEB_SOURCES,
  DomainScheduler,
  MtcuteTelegramProvider,
  SourceRegistry,
  TelegramAuthService,
  TelegramSourceDiscovery,
  browserAdapterFor,
  detectListingLanguage,
  inspectSessionEnvelope,
} from '../src/index.js';

async function failureOf(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

describe('issue 20 production integrations', () => {
  it('has a versioned adapter for every web seed and excludes the unsafe sale route', async () => {
    for (const source of DEFAULT_WEB_SOURCES) {
      expect(browserAdapterFor(source.searchUrl).schemaVersion).toBe(1);
    }
    expect(BROWSER_SOURCE_ADAPTERS.chotot.enabled).toBe(false);
    const registry = new SourceRegistry({
      store: { loadSources: async () => [] },
    });
    const web = await registry.list('web');
    expect(web.length).toBe(20);
    expect(web.some(({ id }) => id === 'chotot')).toBe(false);
    expect(web.some(({ id }) => id === 'hotel-mix')).toBe(true);
  });

  it('detects the three reviewed listing languages with explicit provenance', () => {
    const cases = [
      ['Apartment for rent, price per month', 'en'],
      ['Сдаётся квартира, цена за месяц', 'ru'],
      ['Cho thuê căn hộ, giá theo tháng', 'vi'],
    ];
    for (const [text, language] of cases) {
      const detected = detectListingLanguage(text);
      expect(detected.language).toBe(language);
      expect(detected.schemaVersion).toBe(1);
      expect(detected.confidence > 0).toBe(true);
    }
    expect(detectListingLanguage('123').language).toBe('unknown');
  });

  it('retries within a bounded per-domain budget and surfaces exhaustion', async () => {
    let attempts = 0;
    const scheduler = new DomainScheduler({
      delay: async () => {},
      maxAttempts: 2,
      maxRequestsPerDomain: 2,
    });
    expect(
      await scheduler.run('https://rent.example/one', async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('temporary');
        }
        return 'ok';
      })
    ).toBe('ok');
    const error = await failureOf(() =>
      scheduler.run('https://rent.example/two', async () => 'unreachable')
    );
    expect(error.code).toBe('BROWSER_DOMAIN_BUDGET_EXHAUSTED');
  });

  it('rejects Bot API private chats before reading identity fields', async () => {
    const privateChat = new Proxy(
      { type: 'private' },
      {
        get(target, key) {
          if (key === 'then') {
            return undefined;
          }
          if (key !== 'type') {
            throw new Error(`private field read: ${String(key)}`);
          }
          return target[key];
        },
      }
    );
    const provider = new BotApiTelegramDiscoveryProvider({
      api: { getChat: async () => privateChat },
      candidates: [{ url: 'https://t.me/private_candidate' }],
    });
    const result = await new TelegramSourceDiscovery({
      providers: [provider],
    }).discover();
    expect(result.sources).toEqual([]);
    expect(result.rejected).toEqual([
      { reason: 'private-user', transport: 'bot-api' },
    ]);
  });

  it('uses MTProto folders/global search without joining and rejects User peers first', async () => {
    const calls = [];
    const user = new Proxy(
      { type: 'user' },
      {
        get(target, key) {
          if (key !== 'type') {
            throw new Error(`private field read: ${String(key)}`);
          }
          return target[key];
        },
      }
    );
    const channel = {
      chatType: 'channel',
      id: -10042,
      membersCount: 1200,
      title: 'Nha Trang rentals',
      type: 'chat',
      username: 'nha_rentals',
    };
    const client = {
      destroy: async () => calls.push('destroy'),
      getMe: async () => ({ id: 7 }),
      async *iterDialogs({ folder }) {
        calls.push(`folder:${folder}`);
        yield { peer: user };
        yield { peer: channel };
      },
      async *iterSearchGlobal({ query }) {
        calls.push(`query:${query}`);
        yield { chat: channel };
      },
      start: async () => calls.push('start'),
    };
    const provider = new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => client,
      session: 'native-session',
    });
    const candidates = await provider.discover({
      focus: 'nha-trang',
      queries: [{ id: 'q', language: 'en', text: 'Nha Trang rent' }],
    });
    expect(candidates.map(({ entity }) => entity._)).toEqual([
      'user',
      'channel',
      'channel',
    ]);
    expect(calls).toContain('folder:Нячанг жильё');
    expect(calls).toContain('query:Nha Trang rent');
    expect(calls.some((call) => call.startsWith('join'))).toBe(false);
    await provider.destroy();
  });

  it('migrates a validated native session atomically and preserves it on failure', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'session-migration-'));
    const sessionFile = join(directory, 'telegram.session');
    await writeFile(sessionFile, 'legacy-native-session', {
      flag: 'wx',
      mode: 0o600,
    });
    const client = {
      destroy: async () => {},
      getMe: async () => ({ id: 42, username: 'owner' }),
      importSession: async () => {},
    };
    const service = new TelegramAuthService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => client,
      sessionFile,
    });
    try {
      expect((await service.status()).state).toBe('active-migrated-native');
      const migrated = await readFile(sessionFile, 'utf8');
      expect(inspectSessionEnvelope(migrated).sessionId).toBe(
        'telegram-user:42'
      );
      if (process.platform !== 'win32') {
        expect((await stat(sessionFile)).mode & 0o777).toBe(0o600);
      }

      await writeFile(sessionFile, 'second-native-session', { mode: 0o600 });
      const failing = new TelegramAuthService({
        apiHash: 'hash',
        apiId: 1,
        clientFactory: async () => ({
          destroy: async () => {},
          getMe: async () => {
            throw new Error('identity unavailable');
          },
          importSession: async () => {},
        }),
        sessionFile,
      });
      expect((await failureOf(() => failing.validate())).message).toBe(
        'identity unavailable'
      );
      expect(await readFile(sessionFile, 'utf8')).toBe('second-native-session');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
