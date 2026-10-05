import { describe, expect, it } from 'test-anywhere';

import { BrowserCollector, DomainScheduler } from '../src/index.js';

function hold(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function rowsBefore(before, count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date().toISOString(),
    text: `Room ${before - index} for rent`,
    url: `https://t.me/rentals/${before - index}`,
  }));
}

describe('scheduler queue cancellation', () => {
  it('stops waiting for the domain when the caller signal aborts', async () => {
    const scheduler = new DomainScheduler();
    const order = [];
    const first = scheduler.run('https://t.me/a', async () => {
      await hold(300);
      order.push('first');
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('soft deadline')), 20);
    const started = Date.now();
    const queued = await scheduler
      .run('https://t.me/b', () => order.push('queued'), {
        signal: controller.signal,
      })
      .catch((error) => error);
    expect(queued.message).toBe('soft deadline');
    expect(Date.now() - started < 200).toBe(true);

    await scheduler.run('https://t.me/c', () => order.push('third'));
    await first;
    expect(order).toEqual(['first', 'third']);
  });
});

describe('telegram paging deadline', () => {
  it('returns the pages read so far once the paging deadline passes', async () => {
    const collector = new BrowserCollector();
    let pages = 0;
    const commander = {
      evaluate: async () => {
        pages += 1;
        if (pages === 1) {
          // Another source takes the t.me lane while this one pages.
          void collector.scheduler.run('https://t.me/s/other', () =>
            hold(2_000)
          );
        }
        return rowsBefore(100 - (pages - 1) * 3);
      },
      goto: async () => {},
    };
    const started = Date.now();
    const rows = await collector.collectTelegramRows(
      commander,
      { id: 'telegram:rentals', searchUrl: 'https://t.me/s/rentals' },
      '',
      { deadline: Date.now() + 150 }
    );
    expect(Date.now() - started < 1_000).toBe(true);
    expect(rows.map(({ url }) => url)).toEqual([
      'https://t.me/rentals/100',
      'https://t.me/rentals/99',
      'https://t.me/rentals/98',
    ]);
  });

  it('keeps failing when the source itself is cancelled', async () => {
    const collector = new BrowserCollector();
    const controller = new AbortController();
    const commander = {
      evaluate: async () => {
        void collector.scheduler.run('https://t.me/s/other', () => hold(500));
        setTimeout(() => controller.abort(new Error('source timeout')), 20);
        return rowsBefore(100);
      },
      goto: async () => {},
    };
    const failure = await collector
      .collectTelegramRows(
        commander,
        { id: 'telegram:rentals', searchUrl: 'https://t.me/s/rentals' },
        '',
        { deadline: Date.now() + 60_000, signal: controller.signal }
      )
      .catch((error) => error);
    expect(failure.message).toBe('source timeout');
  });

  it('ends paging a reserve before the source timeout', async () => {
    const page = { close: async () => {} };
    const collector = new BrowserCollector({
      browserRuntime: {
        launchBrowser: async () => ({
          browser: { close: async () => {}, newPage: async () => page },
          page,
        }),
        makeBrowserCommander: () => ({ destroy: async () => {} }),
      },
      budgetMs: 60_000,
      sourceTimeoutMs: 40_000,
      telegramPageReserveMs: 15_000,
    });
    const deadlines = [];
    collector.collectSource = (
      _commander,
      _source,
      _query,
      _rates,
      options
    ) => {
      deadlines.push(options.deadline - Date.now());
      return [];
    };
    await collector.collectWithReport(
      [{ id: 'telegram:rentals', searchUrl: 'https://t.me/s/rentals' }],
      '',
      { traceRecorder: { persist: async () => {}, record: () => {} } }
    );
    expect(deadlines.length).toBe(1);
    expect(deadlines[0] > 24_000 && deadlines[0] <= 25_000).toBe(true);
  });
});
