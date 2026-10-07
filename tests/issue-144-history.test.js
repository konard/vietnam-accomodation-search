import { describe, expect, it } from 'test-anywhere';
import {
  BrowserCollector,
  SearchService,
  formatSearchFailures,
  summarizeOutcomes,
} from '../src/index.js';
import { runSourcePool } from '../src/source-pool.js';
import { TelegramPreviewProgress } from '../src/telegram-preview-progress.js';
import { collectionKey, refreshSources } from '../src/search-refresh.js';

describe('partial public-preview coverage (#142)', () => {
  it('preserves partial offers while reporting incomplete sources and warning the user', async () => {
    const partial = Object.defineProperty(
      [{ id: 'useful' }],
      'historyComplete',
      { value: false }
    );
    const pool = await runSourcePool([{ id: 'partial' }], {
      run: async () => partial,
    });
    expect(pool.outcomes[0].status).toBe('partial');
    const summary = summarizeOutcomes(pool.outcomes);
    expect(summary.succeeded).toBe(0);
    expect(summary.incomplete).toBe(1);
    expect(summary.allFailed).toBe(false);
    expect(summary.failedCategories['incomplete-history']).toBe(1);
    const warning = formatSearchFailures({ outcomes: pool.outcomes, summary });
    expect(warning.includes('history')).toBe(true);
    expect(warning.includes('partial')).toBe(true);
    expect(warning.includes('No fresh offers')).toBe(false);
  });

  it('warns for legacy partial outcomes and cached refreshes, but accepts complete empty history', () => {
    const outcomes = [
      { sourceId: 'qa', status: 'empty', offers: 0, historyComplete: false },
    ];
    expect(
      Boolean(
        formatSearchFailures({
          outcomes,
          summary: { failed: 0 },
          refreshingSources: ['qa'],
        })
      )
    ).toBe(true);
    expect(
      formatSearchFailures({ outcomes, summary: { failed: 0 } }).includes(
        'history'
      )
    ).toBe(true);
    expect(
      summarizeOutcomes([{ ...outcomes[0], historyComplete: true }]).succeeded
    ).toBe(1);
  });

  it('resumes older pages after restart and catches new posts after reaching the frozen cutoff', async () => {
    const records = [];
    const store = {
      queryRecords: async () => records,
      updateRecords: async (_kind, update) => {
        records.splice(0, records.length, ...update(records));
      },
    };
    const now = new Date('2026-10-07T00:00:00Z');
    const source = { id: 'qa', searchUrl: 'https://t.me/s/qa' };
    const visits = [];
    const commander = {
      goto: async ({ url }) => visits.push(url),
      evaluate: async () => [
        {
          url: `https://t.me/qa/${visits.length === 2 ? 20 : 50}`,
          date:
            visits.length === 2 ? '2026-07-01T00:00:00Z' : now.toISOString(),
          text: 'qa',
        },
      ],
    };
    let collector = new BrowserCollector({
      now: () => now,
      store,
      maxTelegramPages: 1,
    });
    const first = await collector.collectTelegramRows(commander, source, '');
    expect(first.historyComplete).toBe(false);
    await collector.previewProgress.commit(first.historyCheckpoint);
    collector = new BrowserCollector({
      now: () => now,
      store,
      maxTelegramPages: 1,
    });
    const older = await collector.collectTelegramRows(commander, source, '');
    expect(visits[1]).toBe('https://t.me/s/qa?before=50');
    expect(older.historyComplete).toBe(true);
    await collector.previewProgress.commit(older.historyCheckpoint);
    const refreshed = await collector.collectTelegramRows(
      commander,
      source,
      ''
    );
    expect(visits[2]).toBe('https://t.me/s/qa');
    expect(refreshed.historyComplete).toBe(true);
  });

  it('rejects mismatched windows/cursors and does not commit after a storage failure', async () => {
    const window = { since: new Date('2026-07-09T00:00:00Z') };
    const progress = new TelegramPreviewProgress({
      queryRecords: async () => [{ firstUrl: 'wrong' }],
    });
    expect((await progress.load('https://t.me/s/qa', window)).cutoff).toBe(
      window.since.toISOString()
    );
    progress.store.updateRecords = async () => {
      throw new Error('disk full');
    };
    let failed = false;
    try {
      await progress.commit({ id: 'qa' });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(progress.entries.size).toBe(0);
    await progress.commit(undefined);
    for (const invalid of [
      { firstUrl: 'https://t.me/s/qa', cutoff: 'invalid', newestId: 10 },
      {
        firstUrl: 'https://t.me/s/qa',
        cutoff: '2026-07-10T00:00:00Z',
        newestId: 10,
      },
      {
        firstUrl: 'https://t.me/s/qa',
        cutoff: '2026-07-01T00:00:00Z',
        newestId: 0.5,
      },
    ]) {
      const reset = new TelegramPreviewProgress({
        queryRecords: async () => [invalid],
      });
      expect((await reset.load('https://t.me/s/qa', window)).newestId).toBe(
        undefined
      );
    }
  });

  it('replays the same slice when saving offers fails before the cursor commit', async () => {
    const now = new Date('2026-10-07T00:00:00Z');
    let checkpoints = [];
    const visits = [];
    const collector = new BrowserCollector({
      now: () => now,
      maxTelegramPages: 1,
      traceRecorder: { record: () => {}, persist: async () => {} },
      store: {
        queryRecords: async () => checkpoints,
        updateRecords: async (_kind, update) => {
          checkpoints = update(checkpoints);
        },
      },
      scheduler: { run: (_url, action) => action() },
      browserRuntime: {
        launchBrowser: async () => ({
          page: {},
          browser: { close: () => Promise.resolve() },
        }),
        makeBrowserCommander: () => ({
          goto: async ({ url }) => visits.push(url),
          evaluate: async () => [
            {
              url: 'https://t.me/qa/50',
              date: now.toISOString(),
              text: 'For rent: studio apartment in Nha Trang, 13 million VND/month.',
            },
          ],
          destroy: async () => {},
        }),
      },
    });
    const source = {
      id: 'qa',
      type: 'telegram',
      url: 'https://t.me/qa',
      searchUrl: 'https://t.me/s/qa',
    };
    await collector.collectWithReport([source], '', {
      onSourceComplete: async () => {
        throw new Error('disk full');
      },
    });
    expect(checkpoints.length).toBe(0);
    await collector.collectWithReport([source], '', {
      onSourceComplete: async () => {},
    });
    expect(visits).toEqual(['https://t.me/s/qa', 'https://t.me/s/qa']);
    expect(checkpoints[0].beforeId).toBe(50);
  });

  it('keeps partial history stale even when an earlier complete scan and fresh offers exist', () => {
    const now = new Date('2026-10-07T00:00:00Z');
    expect(
      refreshSources({
        offers: [{ sourceId: 'qa', collectedAt: now.toISOString() }],
        sources: [{ id: 'qa' }],
        query: '',
        now,
        maxAgeMs: 3600000,
        states: [
          {
            id: collectionKey('qa', ''),
            historyComplete: false,
            collectedAt: now.toISOString(),
          },
        ],
      }).map(({ id }) => id)
    ).toEqual(['qa']);
  });

  it('warns in cache-first reports after restart and retries the incomplete source', async () => {
    const now = new Date('2026-10-07T00:00:00Z');
    const records = [
      {
        id: collectionKey('qa', ''),
        query: '',
        sourceId: 'qa',
        status: 'partial',
        historyComplete: false,
        collectedAt: now.toISOString(),
      },
    ];
    const store = {
      listOffers: async () => [
        {
          id: 'cached',
          sourceId: 'qa',
          priceVnd: 13,
          collectedAt: now.toISOString(),
        },
      ],
      loadRecords: async () => records,
      saveRecords: async (_kind, values) =>
        records.splice(0, records.length, ...values),
    };
    let calls = 0;
    const service = new SearchService({
      store,
      now: () => now,
      registry: { list: async () => [{ id: 'qa' }] },
      collector: {
        collectWithReport: async () => {
          calls += 1;
          return {
            offers: [],
            outcomes: [
              {
                sourceId: 'qa',
                status: 'partial',
                historyComplete: false,
                offers: 0,
              },
            ],
          };
        },
      },
      traceRecorder: { record: () => {}, persist: async () => {} },
    });
    const result = await service.searchWithReport({ cacheFirst: true });
    await service.waitForRefresh();
    expect(calls).toBe(1);
    expect(
      formatSearchFailures(result.report).includes('History is incomplete')
    ).toBe(true);
    expect(result.offers[0].id).toBe('cached');
    expect(records[0].historyComplete).toBe(false);
    const retained = await service.searchWithReport({ refresh: false });
    expect(
      formatSearchFailures(retained.report)?.includes('History is incomplete')
    ).toBe(true);
    expect(calls).toBe(1);
  });
});
