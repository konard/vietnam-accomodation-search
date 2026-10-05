import { describe, expect, it } from 'test-anywhere';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BrowserCollector, MediaCache } from '../src/index.js';

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// A fetch that never answers until its request signal aborts, like a photo
// host that accepts the connection and then stalls.
const stalledFetch =
  (calls) =>
  (url, { signal } = {}) => {
    calls.push({ signal, url });
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  };

function fakeRuntime() {
  const page = { close: async () => {} };
  return {
    launchBrowser: async () => ({
      browser: { close: async () => {}, newPage: async () => ({ ...page }) },
      page,
    }),
    makeBrowserCommander: () => {
      let url;
      return {
        destroy: async () => {},
        evaluate: async (operation) => {
          if (operation.name === 'extractPageState') {
            return { status: 200, url };
          }
          const host = new globalThis.URL(url).hostname.split('.')[0];
          return [
            {
              text: `${host} room 1,000,000 VND/night`,
              title: `${host} room`,
              url: `https://${host}.example/room`,
            },
          ];
        },
        goto: async ({ url: target }) => {
          url = target;
          await wait(2);
        },
      };
    },
  };
}

const webSource = (id) => ({
  id,
  searchUrl: `https://${id}.example/search?q={query}`,
  type: 'web',
});

describe('result persistence cannot stall a search', () => {
  it('gives up on a stalled photo after the photo timeout', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'stalled-photo-'));
    const calls = [];
    try {
      const cache = new MediaCache({
        directory,
        fetchImpl: stalledFetch(calls),
        photoTimeoutMs: 20,
      });
      const offers = [
        { photos: ['https://img.example/a.jpg', 'https://img.example/b.jpg'] },
      ];
      const started = Date.now();
      await cache.cacheOffers(offers);
      expect(Date.now() - started < 1_000).toBe(true);
      expect(offers[0].cachedPhotos).toEqual([]);
      expect(calls.length).toBe(2);
      expect(calls.every(({ signal }) => signal)).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('skips photo downloads after the caller signal aborts', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'stalled-photo-'));
    const calls = [];
    try {
      const cache = new MediaCache({
        directory,
        fetchImpl: stalledFetch(calls),
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('budget')), 20);
      const offers = [
        { photos: ['https://img.example/a.jpg'] },
        { photos: ['https://img.example/b.jpg'] },
      ];
      await cache.cacheOffers(offers, { signal: controller.signal });
      expect(calls.length).toBe(1);
      expect(offers.map(({ cachedPhotos }) => cachedPhotos)).toEqual([[], []]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps collecting while a finished source is still being saved', async () => {
    const started = [];
    const saved = [];
    const collector = new BrowserCollector({
      browserRuntime: fakeRuntime(),
      budgetMs: 2_000,
      concurrency: 1,
      logger: { debug: () => {} },
      rates: { VND: 1 },
      scheduler: {
        run: (url, operation) => {
          started.push(new globalThis.URL(url).hostname);
          return operation();
        },
      },
    });
    const report = await collector.collectWithReport(
      [webSource('alpha'), webSource('beta')],
      '',
      {
        // The first save stalls until the search deadline aborts it.
        onSourceComplete: ({ outcome, signal }) =>
          outcome?.sourceId === 'alpha'
            ? new Promise((resolve) => {
                signal.addEventListener(
                  'abort',
                  () => resolve(saved.push('alpha')),
                  { once: true }
                );
              })
            : saved.push(outcome?.sourceId),
        traceRecorder: { persist: async () => {}, record: () => {} },
      }
    );
    expect(report.summary.byStatus).toEqual({ offers: 2 });
    expect(started).toEqual(['alpha.example', 'beta.example']);
    expect(saved).toEqual(['beta', 'alpha']);
  });
});
