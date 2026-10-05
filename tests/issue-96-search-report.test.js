import { describe, expect, it } from 'test-anywhere';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../bin/vietnam-accomodation-search.js';
import {
  LinksStore,
  SearchService,
  createApplication,
  createTelegramBot,
  formatSearchFailures,
  registerTelegramHandlers,
} from '../src/index.js';
import { positiveSetting } from '../src/application.js';

const NOW = new Date('2026-10-05T00:00:00Z');

async function withDirectory(run) {
  // Deno runs with read access only; these cases write a temp directory.
  if (typeof globalThis.Deno !== 'undefined') {
    return undefined;
  }
  const directory = await mkdtemp(join(tmpdir(), 'issue-96-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

const offer = (id, sourceId, extra = {}) => ({
  collectedAt: NOW.toISOString(),
  id,
  priceVnd: 1_000_000,
  sourceId,
  title: `${id} room`,
  url: `https://${sourceId}.example/${id}`,
  ...extra,
});

const outcome = (sourceId, status, extra = {}) => ({
  offers: status === 'offers' ? 1 : 0,
  sourceId,
  status,
  ...extra,
});

const summaryOf = (outcomes) => {
  const failed = outcomes.filter(
    (entry) => !['offers', 'empty'].includes(entry.status)
  );
  const failedCategories = {};
  for (const entry of failed) {
    const category = entry.category || entry.status;
    failedCategories[category] = (failedCategories[category] || 0) + 1;
  }
  return {
    allFailed: outcomes.length > 0 && failed.length === outcomes.length,
    byStatus: {},
    failed: failed.length,
    failedCategories,
    succeeded: outcomes.length - failed.length,
    total: outcomes.length,
  };
};

const reportFor = (outcomes) => ({
  budgetElapsed: false,
  outcomes,
  summary: summaryOf(outcomes),
});

describe('SearchService.searchWithReport', () => {
  it('persists each source as it finishes and returns the source report', async () => {
    await withDirectory(async (directory) => {
      const store = new LinksStore({ directory });
      const seen = [];
      const collector = {
        collectWithReport: async (sources, _query, { onSourceComplete }) => {
          seen.push(sources.map((source) => source.id));
          await onSourceComplete({
            offers: [offer('one', 'alpha')],
            outcome: outcome('alpha', 'offers'),
          });
          // The first source is already stored while the next one runs.
          expect((await store.listOffers()).map((entry) => entry.id)).toEqual([
            'one',
          ]);
          await onSourceComplete({
            offers: [],
            outcome: outcome('beta', 'blocked', { category: 'http-403' }),
          });
          return {
            ...reportFor([
              outcome('alpha', 'offers'),
              outcome('beta', 'blocked', { category: 'http-403' }),
            ]),
            offers: [offer('one', 'alpha')],
          };
        },
      };
      const service = new SearchService({
        collector,
        now: () => NOW,
        registry: {
          list: async () => [{ id: 'alpha' }, { id: 'beta' }],
        },
        store,
      });
      const { offers, report } = await service.searchWithReport({
        refresh: true,
      });
      expect(offers.map((entry) => entry.id)).toEqual(['one']);
      expect(report.summary.failed).toBe(1);
      expect(report.outcomes.length).toBe(2);
      expect(seen).toEqual([['alpha', 'beta']]);
    });
  });

  it('refreshes sources without fresh coverage first', async () => {
    const order = [];
    const service = new SearchService({
      collector: {
        collectWithReport: async (sources) => {
          order.push(...sources.map((source) => source.id));
          return { ...reportFor([]), offers: [] };
        },
      },
      now: () => NOW,
      registry: {
        list: async () => [{ id: 'covered' }, { id: 'missing' }],
      },
      store: {
        listOffers: async () => [offer('old', 'covered')],
        saveOffers: async () => {},
      },
      traceRecorder: { persist: async () => {}, record: () => {} },
    });
    await service.search({ refresh: true });
    expect(order).toEqual(['missing', 'covered']);
  });

  it('refreshes sources focused on the queried city first', async () => {
    const order = [];
    const service = new SearchService({
      collector: {
        collectWithReport: async (sources) => {
          order.push(sources.map((source) => source.id));
          return { ...reportFor([]), offers: [] };
        },
      },
      now: () => NOW,
      registry: {
        list: async () => [
          { id: 'danang' },
          { focus: 'nha-trang', id: 'covered' },
          { focus: 'nha-trang', id: 'channel' },
          { geographicFocus: 'nha-trang', id: 'site' },
        ],
      },
      store: {
        listOffers: async () => [
          offer('old', 'covered', { searchQuery: 'Nha Trang apartment' }),
        ],
        saveOffers: async () => {},
      },
      traceRecorder: { persist: async () => {}, record: () => {} },
    });
    await service.search({ query: 'Nha Trang apartment', refresh: true });
    await service.search({ query: 'Đà Nẵng', refresh: true });
    expect(order).toEqual([
      ['channel', 'site', 'danang', 'covered'],
      ['danang', 'covered', 'channel', 'site'],
    ]);
  });

  it('traces a refresh where every source failed as degraded', async () => {
    const events = [];
    const service = new SearchService({
      collector: {
        collectWithReport: async () => ({
          ...reportFor([outcome('alpha', 'timeout')]),
          offers: [],
        }),
      },
      mediaCache: {
        cacheOffers: async (offers) => offers,
        enforceBudget: async () => ({ removed: [] }),
      },
      now: () => NOW,
      registry: { list: async () => [{ id: 'alpha' }] },
      store: { listOffers: async () => [], saveOffers: async () => {} },
      traceRecorder: {
        persist: async () => {},
        record: (event) => events.push(event),
      },
    });
    const { offers, report } = await service.searchWithReport({
      refresh: true,
    });
    expect(offers).toEqual([]);
    expect(report.summary.allFailed).toBe(true);
    const search = events.findLast((event) => event.stage === 'search');
    expect(search.status).toBe('degraded');
    expect(search.metadata.failedSources).toBe(1);
  });

  it('caches media for each finished source before saving it', async () => {
    const saved = [];
    const service = new SearchService({
      collector: {
        collectWithReport: async (_sources, _query, { onSourceComplete }) => {
          await onSourceComplete({
            offers: [offer('one', 'alpha')],
            outcome: outcome('alpha', 'offers'),
          });
          return { ...reportFor([outcome('alpha', 'offers')]), offers: [] };
        },
      },
      mediaCache: {
        cacheOffers: async (offers) =>
          offers.map((entry) => ({ ...entry, cachedPhotos: ['cached'] })),
        enforceBudget: async () => ({ removed: [] }),
      },
      now: () => NOW,
      registry: { list: async () => [{ id: 'alpha' }] },
      store: {
        listOffers: async () => [],
        saveOffers: async (offers) => saved.push(...offers),
      },
      traceRecorder: { persist: async () => {}, record: () => {} },
    });
    await service.search({ refresh: true });
    expect(saved[0].cachedPhotos).toEqual(['cached']);
  });
});

describe('search failure messages', () => {
  it('describes total and partial failures', () => {
    expect(formatSearchFailures(undefined)).toBe(undefined);
    expect(formatSearchFailures(reportFor([outcome('alpha', 'offers')]))).toBe(
      undefined
    );
    expect(
      formatSearchFailures(
        reportFor([
          outcome('alpha', 'blocked', { category: 'http-403' }),
          outcome('beta', 'timeout', { category: 'SOURCE_TIMEOUT' }),
        ])
      )
    ).toBe(
      'No fresh offers could be collected. All 2 sources failed: http-403 ×1, SOURCE_TIMEOUT ×1.'
    );
    expect(
      formatSearchFailures(
        reportFor([outcome('alpha', 'offers'), outcome('beta', 'pending')])
      )
    ).toBe('1 of 2 sources failed or did not finish.');
  });
});

function fakeBot() {
  const commands = new Map();
  return {
    command: (name, handler) => commands.set(name, handler),
    commands,
    on: () => {},
  };
}

async function botSearch(service, searchSignal) {
  const bot = fakeBot();
  const replies = [];
  registerTelegramHandlers(bot, {
    registry: {},
    searchSignal,
    service,
  });
  await bot.commands.get('search')({
    match: 'Nha Trang',
    reply: async (text) => replies.push(text),
  });
  return replies;
}

describe('Telegram /search with a source report', () => {
  it('says sources failed when nothing could be collected', async () => {
    const replies = await botSearch({
      searchWithReport: async () => ({
        offers: [],
        report: reportFor([
          outcome('alpha', 'challenge', { category: 'challenge' }),
        ]),
      }),
    });
    expect(replies).toEqual([
      'No fresh offers could be collected. All 1 sources failed: challenge ×1.',
    ]);
  });

  it('keeps the no-offers reply when sources answered with nothing', async () => {
    const replies = await botSearch({
      searchWithReport: async () => ({
        offers: [],
        report: reportFor([outcome('alpha', 'empty')]),
      }),
    });
    expect(replies[0]).toContain('No current offers');
  });

  it('notes partial failures after delivering offers', async () => {
    const replies = await botSearch({
      searchWithReport: async () => ({
        offers: [offer('one', 'alpha', { photos: [] })],
        report: reportFor([
          outcome('alpha', 'offers'),
          outcome('beta', 'timeout'),
        ]),
      }),
    });
    expect(replies[0]).toBe('1 of 2 sources failed or did not finish.');
    expect(replies.at(-1)).toContain('one room');
  });

  it('passes the shutdown signal to the search', async () => {
    const controller = new AbortController();
    let received;
    await botSearch(
      {
        searchWithReport: async (options) => {
          received = options.signal;
          return { offers: [] };
        },
      },
      controller.signal
    );
    expect(received).toBe(controller.signal);
  });

  it('aborts in-flight searches when the concrete bot stops', async () => {
    // grammY reads process.env at import, which the read-only Deno leg
    // does not grant.
    if (typeof Deno !== 'undefined') {
      return;
    }
    const signals = [];
    const records = [];
    const bot = await createTelegramBot(
      '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
      {
        presetService: { listSubscriptions: async () => [] },
        registry: {},
        service: {
          search: async (options) => {
            signals.push(options.signal);
            return [];
          },
        },
        store: {
          loadRecords: async () => records,
          saveRecords: async () => {},
        },
      }
    );
    await bot.subscriptionScheduler.search({});
    expect(signals[0].aborted).toBe(false);
    await bot.subscriptionScheduler.stop();
    expect(signals[0].aborted).toBe(true);
    expect(signals[0].reason.name).toBe('AbortError');
    await bot.stop();
    expect(signals[0].reason.message).toBe(
      'Search interrupted by bot shutdown.'
    );
  });
});

function fakeProcess() {
  const handlers = new Map();
  return {
    emit: (signal) => handlers.get(signal)?.(),
    handlers,
    off: (signal, handler) => {
      if (handlers.get(signal) === handler) {
        handlers.delete(signal);
      }
    },
    once: (signal, handler) => handlers.set(signal, handler),
  };
}

async function cliSearch(service, processRef = fakeProcess()) {
  const stdout = [];
  const stderr = [];
  const code = await runCli(['search', 'Nha', 'Trang'], {
    application: { service },
    processRef,
    stderr: (text) => stderr.push(text),
    stdout: (text) => stdout.push(text),
  });
  return { code, processRef, stderr, stdout };
}

describe('CLI search exit status', () => {
  it('exits 1 with the failure summary when every source failed', async () => {
    const result = await cliSearch({
      searchWithReport: async () => ({
        offers: [],
        report: reportFor([
          outcome('alpha', 'blocked', { category: 'http-403' }),
        ]),
      }),
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([
      'No fresh offers could be collected. All 1 sources failed: http-403 ×1.',
    ]);
    expect(result.processRef.handlers.size).toBe(0);
  });

  it('exits 0 and prints stored offers when only the refresh failed', async () => {
    const result = await cliSearch({
      searchWithReport: async () => ({
        offers: [offer('kept', 'alpha')],
        report: reportFor([outcome('alpha', 'timeout')]),
      }),
    });
    expect(result.code).toBe(0);
    expect(result.stdout[0]).toContain('kept room');
    expect(result.stderr[0]).toContain('All 1 sources failed');
  });

  it('keeps services without a report API working', async () => {
    const result = await cliSearch({ search: async () => [] });
    expect(result.code).toBe(0);
    expect(result.stdout[0]).toContain('No current offers');
    expect(result.stderr).toEqual([]);
  });

  it('exits 130 when SIGINT interrupts the search', async () => {
    const processRef = fakeProcess();
    const result = await cliSearch(
      {
        searchWithReport: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
            processRef.emit('SIGINT');
          }),
      },
      processRef
    );
    expect(result.code).toBe(130);
    expect(result.stderr).toEqual(['Search interrupted by SIGINT.']);
    expect(processRef.handlers.size).toBe(0);
  });

  it('reports other search errors through the usual failure path', async () => {
    const result = await cliSearch({
      searchWithReport: async () => {
        throw new Error('store unreadable');
      },
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr.join('\n')).toContain('store unreadable');
  });
});

describe('createApplication collection settings', () => {
  it('reads positive numeric settings and ignores invalid ones', () => {
    expect(positiveSetting('5', 1)).toBe(5);
    expect(positiveSetting(undefined, 1)).toBe(1);
    expect(positiveSetting('0', 1)).toBe(1);
    expect(positiveSetting('-3', 1)).toBe(1);
    expect(positiveSetting('fast', 1)).toBe(1);
  });

  it('applies concurrency, timeout, and budget overrides', async () => {
    await withDirectory(async (directory) => {
      const application = createApplication({
        directory,
        environment: {
          BROWSER_CONCURRENCY: '2.7',
          BROWSER_SOURCE_TIMEOUT_MS: '1500',
          SEARCH_BUDGET_MS: '60000',
        },
      });
      expect(application.collector.concurrency).toBe(2);
      expect(application.collector.sourceTimeoutMs).toBe(1500);
      expect(application.collector.budgetMs).toBe(60000);
      expect(application.collector.scheduler.maxConcurrentDomains).toBe(2);
      const defaults = createApplication({ directory, environment: {} });
      expect(defaults.collector.concurrency).toBe(4);
      expect(defaults.collector.sourceTimeoutMs).toBe(90_000);
      expect(defaults.collector.budgetMs).toBe(180_000);
    });
  });

  it('searches end to end and persists offers and cooldown state', async () => {
    await withDirectory(async (directory) => {
      const page = {};
      const browserRuntime = {
        launchBrowser: async () => ({
          browser: { close: async () => {} },
          page,
        }),
        makeBrowserCommander: () => {
          let url;
          return {
            destroy: async () => {},
            evaluate: async (operation) =>
              operation.name === 'extractPageState'
                ? { status: url.includes('limited') ? 429 : 200, url }
                : url.includes('limited')
                  ? []
                  : [
                      {
                        text: 'Sea view studio 9,000,000 VND/month',
                        title: 'Sea view studio',
                        url: 'https://rent.example/studio',
                      },
                    ],
            goto: async ({ url: target }) => {
              url = target;
            },
          };
        },
      };
      const application = createApplication({
        browserRuntime,
        directory,
        environment: {
          BROWSER_MIN_INTERVAL_MS: '1',
          BROWSER_MAX_INTERVAL_MS: '1',
        },
        rateProvider: { getRates: async () => ({ VND: 1 }) },
      });
      application.registry.list = async () => [
        {
          id: 'rent',
          searchUrl: 'https://rent.example/search?q={query}',
          type: 'web',
        },
        {
          id: 'limited',
          searchUrl: 'https://limited.example/search?q={query}',
          type: 'web',
        },
      ];
      const { offers, report } = await application.service.searchWithReport({
        query: 'Nha Trang',
        refresh: true,
      });
      expect(offers.map((entry) => entry.title)).toEqual(['Sea view studio']);
      expect(
        Object.fromEntries(
          report.outcomes.map((entry) => [entry.sourceId, entry.status])
        )
      ).toEqual({ limited: 'challenge', rent: 'offers' });
      const files = await readdir(directory);
      expect(files).toContain('offers.lino');
      expect(files).toContain('traces.lino');
      expect(files).toContain('browser-domain-cooldowns.lino');
    });
  });
});

describe('CLI search interruption with a real browser process', () => {
  it('closes the spawned browser process before exiting with 130', async () => {
    // The read-only Deno leg cannot spawn processes.
    if (typeof Deno !== 'undefined') {
      return;
    }
    const { spawn } = await import('node:child_process');
    await withDirectory(async (directory) => {
      let child;
      const exited = () => child.exitCode !== null || child.signalCode !== null;
      const browserRuntime = {
        launchBrowser: async () => {
          child = spawn(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'],
            {
              stdio: 'ignore',
            }
          );
          return {
            browser: {
              close: () =>
                new Promise((resolve) => {
                  child.once('exit', resolve);
                  child.kill('SIGTERM');
                }),
            },
            page: {},
          };
        },
        makeBrowserCommander: () => ({
          destroy: async () => {},
          evaluate: async () => [],
          // A page that never finishes loading.
          goto: () => new Promise(() => {}),
        }),
      };
      const application = createApplication({
        browserRuntime,
        directory,
        environment: {},
        rateProvider: { getRates: async () => ({ VND: 1 }) },
      });
      application.registry.list = async () => [
        {
          id: 'slow',
          searchUrl: 'https://slow.example/search?q={query}',
          type: 'web',
        },
      ];
      const processRef = fakeProcess();
      setTimeout(() => processRef.emit('SIGINT'), 100);
      const stderr = [];
      const code = await runCli(['search', 'Nha', 'Trang'], {
        application,
        processRef,
        stderr: (text) => stderr.push(text),
        stdout: () => {},
      });
      expect(code).toBe(130);
      expect(stderr).toEqual(['Search interrupted by SIGINT.']);
      expect(exited()).toBe(true);
    });
  });
});
