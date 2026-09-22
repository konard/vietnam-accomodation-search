import { describe, expect, it } from 'test-anywhere';

import {
  DEFAULT_TELEGRAM_SOURCES,
  DEFAULT_WEB_SOURCES,
  BrowserSourceDiscoverer,
  SourceRegistry,
} from '../src/index.js';

describe('ranked accommodation sources', () => {
  it('ships at least twenty web and twenty Telegram candidates', () => {
    expect(DEFAULT_WEB_SOURCES.length >= 20).toBe(true);
    expect(DEFAULT_TELEGRAM_SOURCES.length >= 20).toBe(true);
  });

  it('keeps a popularity metric and evidence URL for every seed', () => {
    for (const source of [
      ...DEFAULT_WEB_SOURCES,
      ...DEFAULT_TELEGRAM_SOURCES,
    ]) {
      expect(Boolean(source.popularity.metric)).toBe(true);
      expect(Number.isFinite(source.popularity.value)).toBe(true);
      expect(source.popularity.evidenceUrl.startsWith('http')).toBe(true);
    }
  });

  it('updates, de-duplicates, ranks, and caps both source classes', async () => {
    const saved = [];
    const registry = new SourceRegistry({
      store: {
        loadSources: async () => [],
        saveSources: async (sources) => saved.push(sources),
      },
      discover: async (type, { focus }) =>
        Array.from({ length: 25 }, (_, index) => ({
          id: `${type}-${focus || 'general'}-${index}`,
          ...(focus ? { focus } : {}),
          name: `${type} ${index}`,
          type,
          url:
            type === 'telegram'
              ? `https://t.me/source_${index}`
              : `https://source-${index}.example`,
          popularity: {
            metric: type === 'telegram' ? 'members' : 'search-rank-score',
            value: index,
            evidenceUrl: 'https://evidence.example/ranking',
            observedAt: '2026-09-21T00:00:00.000Z',
          },
        })),
    });

    const updated = await registry.update({ count: 20 });

    expect(updated.web.length).toBe(20);
    expect(updated.telegram.length).toBe(40);
    expect(updated.web[0].popularity.value).toBe(24);
    expect(updated.telegram[0].popularity.value).toBe(24);
    expect(updated.telegram.filter((source) => source.focus).length).toBe(20);
    expect(saved[0].length).toBe(60);
    expect(saved.length).toBe(1);
  });
});

describe('browser-driven source discovery', () => {
  it('reranks website candidates from links in a live search UI', async () => {
    const navigated = [];
    const discoverer = new BrowserSourceDiscoverer({
      browserRuntime: {
        launchBrowser: async () => ({
          browser: { close: async () => {} },
          page: {},
        }),
        makeBrowserCommander: () => ({
          destroy: async () => {},
          evaluate: async () => [
            'https://www.booking.com/hotel/vn/example.html',
          ],
          goto: async ({ url }) => navigated.push(url),
        }),
      },
      now: () => new Date('2026-09-21T00:00:00Z'),
    });

    const ranked = await discoverer.discover('web', {
      candidates: DEFAULT_WEB_SOURCES.slice(0, 2),
    });

    expect(navigated[0]).toContain('google.com/search');
    expect(ranked[0].popularity.metric).toBe('google-search-rank-score');
    expect(ranked[0].popularity.value > ranked[1].popularity.value).toBe(true);
  });

  it('discovers Telegram handles and reads their visible audience', async () => {
    let currentUrl = '';
    const discoverer = new BrowserSourceDiscoverer({
      browserRuntime: {
        launchBrowser: async () => ({
          browser: { close: async () => {} },
          page: {},
        }),
        makeBrowserCommander: () => ({
          destroy: async () => {},
          evaluate: async (fn) =>
            fn.name === 'extractSearchLinks'
              ? ['https://t.me/new_vietnam_rentals']
              : currentUrl.includes('new_vietnam_rentals')
                ? '1.2K subscribers'
                : '500 members',
          goto: async ({ url }) => {
            currentUrl = url;
          },
        }),
      },
      now: () => new Date('2026-09-21T00:00:00Z'),
    });

    const ranked = await discoverer.discover('telegram', {
      candidates: DEFAULT_TELEGRAM_SOURCES.slice(0, 1),
    });
    const discovered = ranked.find((source) =>
      source.id.includes('new_vietnam_rentals')
    );

    expect(discovered.popularity.value).toBe(1200);
    expect(discovered.popularity.evidenceUrl).toBe(
      'https://t.me/new_vietnam_rentals'
    );
  });
});
