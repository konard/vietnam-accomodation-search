import { describe, expect, it } from 'test-anywhere';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DomainScheduler } from '../src/browser-adapters.js';
import { LinksStore, validKind } from '../src/links-store.js';
import { TelegramSourceDiscovery } from '../src/telegram-discovery.js';

const COLLECTION_CALL =
  /\b(?:load|save|update|append)Records\??\.?\(\s*(['"`])([^'"`]+)\1/gu;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(directory, entry.name))
        : [join(directory, entry.name)]
    )
  );
  return nested.flat().filter((path) => path.endsWith('.js'));
}

async function collectionNames() {
  const names = new Map();
  for (const path of await sourceFiles('src')) {
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(COLLECTION_CALL)) {
      names.set(match[2], path);
    }
  }
  return names;
}

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'issue-94-'));
  try {
    return await run(new LinksStore({ directory }), directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe('record collection names used by src/', () => {
  it('finds the collections the runtime persists', async () => {
    const names = await collectionNames();
    expect(names.has('browser-domain-cooldowns')).toBe(true);
    expect(names.has('telegram-discovery-checkpoints')).toBe(true);
    expect(names.has('traces')).toBe(true);
  });

  it('accepts every literal collection name in validKind', async () => {
    const invalid = [...(await collectionNames())].filter(([name]) => {
      try {
        validKind(name);
        return false;
      } catch {
        return true;
      }
    });
    expect(invalid).toEqual([]);
  });
});

describe('DomainScheduler with a real LinksStore', () => {
  it('persists a rate-limit cooldown and reads it back', async () => {
    await withStore(async (store, directory) => {
      let now = 1_000;
      const scheduler = new DomainScheduler({
        delay: async () => {},
        maxAttempts: 1,
        now: () => now,
        store,
      });
      const rateLimit = Object.assign(new Error('limited'), {
        retryAfterMs: 4_000,
        status: 429,
      });
      await scheduler
        .run('https://cooldown.test/search', async () => {
          throw rateLimit;
        })
        .catch(() => {});
      expect(await readdir(directory)).toContain(
        'browser-domain-cooldowns.lino'
      );
      const [state] = await store.loadRecords('browser-domain-cooldowns');
      expect(state.domain).toBe('cooldown.test');
      expect(state.blockedUntil).toBe(5_000);

      now = 6_000;
      const fresh = new DomainScheduler({
        delay: async () => {},
        now: () => now,
        store,
      });
      expect(
        await fresh.run('https://cooldown.test/next', async () => 'loaded')
      ).toBe('loaded');
    });
  });
});

describe('TelegramSourceDiscovery checkpoints with a real LinksStore', () => {
  it('reads saved checkpoints without a collection-name error', async () => {
    await withStore(async (store) => {
      await store.saveRecords('telegram-discovery-checkpoints', [
        { complete: true, id: 'nationwide' },
      ]);
      const discovery = new TelegramSourceDiscovery({ providers: [], store });
      const result = await discovery.discover();
      expect(Array.isArray(result.sources)).toBe(true);
    });
  });
});
