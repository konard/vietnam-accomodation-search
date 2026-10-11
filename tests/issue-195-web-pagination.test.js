import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { BrowserCollector } from '../src/browser-collector.js';
import {
  collectWebPages,
  extractWebPagination,
  WebPaginationProgress,
} from '../src/web-pagination.js';

function fixture(pages, maxWebPages = 25) {
  const records = new Map();
  const store = {
    loadRecords: async (kind) => records.get(kind) || [],
    updateRecords: async (kind, update) =>
      records.set(kind, await update(records.get(kind) || [])),
  };
  let current;
  const visits = [];
  const commander = {
    goto: async ({ url }) => {
      visits.push(url);
      current = url;
      if (pages[url]?.failure) {
        throw pages[url].failure;
      }
      return { httpStatus: 200 };
    },
    evaluate: async (fn) => {
      if (fn.name === 'extractPageListings') {
        return pages[current].rows;
      }
      if (fn.name === 'extractWebPagination') {
        return pages[current].pagination;
      }
      return { status: 200, url: current };
    },
  };
  const collector = new BrowserCollector({
    store,
    maxWebPages,
    scheduler: { run: (_url, action) => action() },
  });
  return { collector, commander, records, visits };
}

const first = 'https://self-authored.invalid/search';
const second = `${first}?page=2`;
const row = (id) => ({
  url: `${first}/${id}`,
  title: 'Self-authored Nha Trang apartment',
  text: 'Apartment for rent, 8 million VND/month.',
});

describe('explicit resumable web pagination', () => {
  it('restores a source through indexed storage while bounding the raw-row cache', async () => {
    const records = new Map();
    const store = {
      appendRecords: async (_kind, [checkpoint]) =>
        records.set(checkpoint.id, checkpoint),
      queryRecords: async (_kind, { value }) =>
        records.has(value) ? [records.get(value)] : [],
    };
    const progress = new WebPaginationProgress(store);
    for (let index = 0; index < 5; index += 1) {
      const firstUrl = `${first}?source=${index}`;
      await collectWebPages({
        firstUrl,
        progress,
        fetchPage: async () => ({
          rows: [row(index)],
          pagination: { nextUrl: `${firstUrl}&page=2` },
        }),
        maxPages: 1,
      });
    }
    assert.equal(progress.entries.size, 4);
    const restored = await new WebPaginationProgress(store).load(
      `${first}?source=0`
    );
    assert.equal(restored.rows[0].url, row(0).url);
    assert.equal(restored.nextUrl, `${first}?source=0&page=2`);
  });

  it('recognizes next links and explicit terminal controls in the page DOM', () => {
    const previous = globalThis.document;
    const control = (attributes = {}, classes = [], parent = []) => ({
      hasAttribute: (name) => Object.hasOwn(attributes, name),
      getAttribute: (name) => attributes[name],
      classList: { contains: (name) => classes.includes(name) },
      parentElement: {
        classList: { contains: (name) => parent.includes(name) },
      },
    });
    let controls = [control({ href: '?page=2' })];
    let pager;
    globalThis.document = {
      location: { href: first, pathname: '/search' },
      querySelectorAll: () => controls,
      querySelector: () => pager,
    };
    try {
      assert.equal(extractWebPagination().nextUrl, second);
      controls = [
        control({ disabled: '' }),
        control({ 'aria-disabled': 'true' }),
        control({}, ['disabled']),
        control({}, [], ['disabled']),
      ];
      assert.equal(extractWebPagination().complete, true);
      controls = [];
      pager = {
        querySelector: () => ({ textContent: '2' }),
        querySelectorAll: () =>
          ['1', '2', 'bad', '0'].map((textContent) => ({ textContent })),
      };
      assert.equal(extractWebPagination().evidence, 'last-numbered-page');
      pager = undefined;
      assert.equal(extractWebPagination().complete, false);
      assert.equal(
        extractWebPagination({ detailPath: '^/search$' }).complete,
        true
      );
    } finally {
      globalThis.document = previous;
    }
  });

  it('does not certify deadline, row-budget or malformed-cursor loss', async () => {
    const progress = new WebPaginationProgress();
    let fetched = 0;
    const fetchPage = async () => {
      fetched += 1;
      return { rows: [row(1), row(2)], pagination: { complete: true } };
    };
    const deadline = await collectWebPages({
      firstUrl: first,
      progress,
      fetchPage,
      deadline: 0,
    });
    assert.equal(fetched, 0);
    assert.equal(deadline.paginationCheckpoint.reason, 'paging-deadline');
    const bounded = await collectWebPages({
      firstUrl: first,
      progress,
      fetchPage,
      maxRows: 1,
    });
    assert.equal(bounded.length, 1);
    assert.equal(bounded.paginationComplete, false);
    assert.equal(bounded.paginationCheckpoint.retentionLoss, true);
    const malformed = await collectWebPages({
      firstUrl: first,
      progress: new WebPaginationProgress(),
      fetchPage: async () => ({
        rows: [row(1)],
        pagination: { nextUrl: 'https://[' },
      }),
    });
    assert.equal(
      malformed.paginationCheckpoint.reason,
      'invalid-pagination-url'
    );
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await assert.rejects(
      collectWebPages({
        firstUrl: first,
        progress,
        fetchPage,
        signal: controller.signal,
      }),
      /cancelled/u
    );
  });

  it('refreshes completed or stale progress and retries unrecognized pagination', async () => {
    const fixture_ = fixture({ [first]: { rows: [row(1)], pagination: {} } });
    await fixture_.collector.collectListingRows(
      fixture_.commander,
      first,
      'web',
      {}
    );
    await fixture_.collector.collectListingRows(
      fixture_.commander,
      first,
      'web',
      {}
    );
    assert.deepEqual(fixture_.visits, [first, first]);
    const progress = new WebPaginationProgress({
      loadRecords: async () => [
        {
          id: fixture_.records.get('web-pagination-checkpoints')[0].id,
          firstUrl: first,
          complete: false,
          updatedAt: 'invalid',
          rows: [row(2)],
        },
      ],
    });
    assert.deepEqual((await progress.load(first)).rows, []);
    await assert.rejects(
      collectWebPages({
        firstUrl: first,
        progress,
        fetchPage: async () => {
          throw new Error('first page failed');
        },
      }),
      /first page failed/u
    );
  });

  it('reads every linked page and requires an explicit terminal page', async () => {
    const fixture_ = fixture({
      [first]: {
        rows: [row(1)],
        pagination: { nextUrl: second, evidence: 'next-link' },
      },
      [second]: {
        rows: [row(2)],
        pagination: { complete: true, evidence: 'last-page' },
      },
    });
    const rows = await fixture_.collector.collectListingRows(
      fixture_.commander,
      first,
      'web',
      {}
    );
    assert.equal(rows.length, 2);
    assert.equal(rows.paginationComplete, true);
    assert.deepEqual(fixture_.visits, [first, second]);
  });

  it('resumes a bounded slice without losing the earlier durably recorded page', async () => {
    const fixture_ = fixture(
      {
        [first]: {
          rows: [row(1)],
          pagination: { nextUrl: second, evidence: 'next-link' },
        },
        [second]: {
          rows: [row(2)],
          pagination: { complete: true, evidence: 'last-page' },
        },
      },
      1
    );
    const partial = await fixture_.collector.collectListingRows(
      fixture_.commander,
      first,
      'web',
      {}
    );
    assert.equal(partial.paginationComplete, false);
    assert.equal(partial.length, 1);
    const complete = await fixture_.collector.collectListingRows(
      fixture_.commander,
      first,
      'web',
      {}
    );
    assert.equal(complete.paginationComplete, true);
    assert.equal(complete.length, 2);
    assert.deepEqual(fixture_.visits, [first, second]);
  });

  it('keeps unknown, looping and cross-origin pagination incomplete', async () => {
    for (const pagination of [
      {},
      { nextUrl: first },
      { nextUrl: 'https://unrelated.invalid/private' },
    ]) {
      const fixture_ = fixture({ [first]: { rows: [row(1)], pagination } });
      const rows = await fixture_.collector.collectListingRows(
        fixture_.commander,
        first,
        'web',
        {}
      );
      assert.equal(rows.paginationComplete, false);
      assert.deepEqual(fixture_.visits, [first]);
    }
  });

  it('retains first-page evidence after a challenged tail without claiming exhaustion', async () => {
    const error = Object.assign(new Error('Self-authored challenge'), {
      classification: 'access-challenge',
    });
    const fixture_ = fixture({
      [first]: { rows: [row(1)], pagination: { nextUrl: second } },
      [second]: { failure: error },
    });
    const rows = await fixture_.collector.collectListingRows(
      fixture_.commander,
      first,
      'web',
      {}
    );
    assert.equal(rows.length, 1);
    assert.equal(rows.paginationComplete, false);
    assert.equal(rows.paginationCheckpoint.reason, 'access-challenge');
  });
});
