/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings:true}] -- Fixed dates are synthetic test inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  extractDetailStatus,
  WebDetailStatusCache,
  applyDetailStatus,
} from '../src/web-detail-status.js';
import { BrowserCollector } from '../src/browser-collector.js';

function detailDocument(
  text,
  { metadata = {}, fallback = false, body = false } = {}
) {
  const element = (parts) => ({
    cloneNode: () => element([...parts]),
    get innerText() {
      return fallback ? undefined : parts.join('\n');
    },
    get textContent() {
      return parts.join('\n');
    },
    querySelectorAll: () => [{ remove: () => parts.splice(1) }],
    querySelector: (selector) => {
      const name = selector.includes('datePublished')
        ? 'datePublished'
        : 'validThrough';
      const attrs = metadata[name];
      return attrs ? { getAttribute: (key) => attrs[key] } : null;
    },
  });
  const root = element([text, 'Related recommendation: Available now']);
  return { body: root, querySelector: () => (body ? null : root) };
}

it('extracts only primary detail text and dates without mutating recommendations', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    const fixtures = [
      [
        detailDocument(
          'Tin đăng đã hết hạn. Ngày đăng: 1/2/2024. Ngày hết hạn: 3-4-2025.'
        ),
        '2024-02-01T00:00:00Z',
        '2025-04-03T00:00:00Z',
      ],
      [
        detailDocument('Đã cho thuê', {
          fallback: true,
          body: true,
          metadata: {
            datePublished: { content: '2024-02-01' },
            validThrough: { datetime: '2025-04-03' },
          },
        }),
        '2024-02-01',
        '2025-04-03',
      ],
      [detailDocument('Price only'), undefined, undefined],
    ];
    for (const [document, publishedAt, expiresAt] of fixtures) {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: document,
      });
      const evidence = extractDetailStatus();
      assert.equal(evidence.publishedAt, publishedAt);
      assert.equal(evidence.expiresAt, expiresAt);
      assert(!evidence.text.includes('Available now'));
      assert(document.body.textContent.includes('Related recommendation'));
    }
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'document', original);
    } else {
      delete globalThis.document;
    }
  }
});

it('does not publish cancellation evidence or claim unknown availability', async () => {
  const rows = new Map();
  const cache = new WebDetailStatusCache({
    store: {
      loadRecords: async (kind) => rows.get(kind) || [],
      saveRecords: async (kind, values) => rows.set(kind, values),
    },
  });
  const controller = new AbortController();
  await assert.rejects(
    cache.inspect(
      'https://homedy.com/synthetic-es1',
      async () => {
        controller.abort();
        return { text: 'Available now' };
      },
      { signal: controller.signal }
    ),
    { name: 'AbortError' }
  );
  assert.equal(rows.size, 0);
  const url = 'https://homedy.com/synthetic-es1';
  const saved = await cache.inspect(url, async () => ({ text: 'Đã cho thuê' }));
  assert.equal(saved.status, 'rented');
  assert.equal(rows.get('web-detail-statuses')[0].url, url);
  assert.deepEqual(
    await cache.inspect(url, async () => {
      throw new Error('A fresh cached status must avoid another request.');
    }),
    saved
  );
  for (const [status, availability, availableNow] of [
    ['active', 'available', true],
    ['unknown', 'unknown', undefined],
  ]) {
    const offer = applyDetailStatus(
      { attributes: { availableNow: true } },
      { status }
    );
    assert.equal(offer.attributes.availability, availability);
    assert.equal(offer.attributes.availableNow, availableNow);
  }
});

function diagnosticFixture(state = { status: 200 }) {
  const events = [];
  const commander = {
    destroy: async () => events.push('destroy'),
    evaluate: async (operation) =>
      operation.name === 'extractPageState'
        ? state
        : { text: 'Tin đăng đã hết hạn' },
  };
  const collector = new BrowserCollector({
    browserRuntime: {
      launchBrowser: async () => ({
        browser: { close: async () => events.push('close') },
        page: {},
      }),
      makeBrowserCommander: () => commander,
    },
  });
  collector.navigate = async () => events.push('navigate');
  return { collector, events };
}

it('inspects only supported official detail URLs and closes its resources on failures', async () => {
  const { collector, events } = diagnosticFixture();
  await assert.rejects(
    collector.inspectDetail('https://example.com/foreign'),
    /supported detail URL/u
  );
  assert.equal(events.length, 0);
  assert.equal(
    (await collector.inspectDetail('https://homedy.com/synthetic-es1')).status,
    'expired'
  );
  assert.deepEqual(events, ['navigate', 'destroy', 'close']);
  const blocked = diagnosticFixture({ status: 403 });
  await assert.rejects(
    blocked.collector.inspectDetail('https://homedy.com/synthetic-es2')
  );
  assert.deepEqual(blocked.events, ['navigate', 'destroy', 'close']);
  const consent = diagnosticFixture({ status: 200, title: 'cookie-settings' });
  await assert.rejects(
    consent.collector.inspectDetail('https://homedy.com/synthetic-es3')
  );
  assert.deepEqual(consent.events, ['navigate', 'destroy', 'close']);
});

function sourceFixture({
  count = 1,
  state = { status: 200 },
  foreign = false,
} = {}) {
  const collector = new BrowserCollector();
  collector.collectListingRows = async () =>
    Array.from({ length: count }, (_, index) => ({
      title: `Studio ${index} for rent`,
      text: 'Studio for rent. 5 million VND/month.',
      url: `https://${foreign ? 'example.com' : 'homedy.com'}/synthetic-es${index}`,
    }));
  let requests = 0;
  collector.navigate = async () => {
    requests++;
  };
  const commander = {
    evaluate: async (operation) =>
      operation.name === 'extractPageState' ? state : { text: 'Available now' },
  };
  const collect = (options) =>
    collector.collectSource(
      commander,
      { id: 'synthetic', type: 'web', searchUrl: 'https://homedy.com/results' },
      '',
      { VND: 1 },
      options
    );
  return { collector, collect, requests: () => requests };
}

it('bounds detail requests and keeps foreign and blocked pages unverified', async () => {
  const bounded = sourceFixture({ count: 7 });
  const rows = await bounded.collect();
  assert.equal(bounded.requests(), 5);
  assert.deepEqual(
    rows.map((row) => row.attributes.availableNow),
    [true, true, true, true, true, undefined, undefined]
  );
  const foreign = sourceFixture({ foreign: true });
  assert.equal((await foreign.collect())[0].attributes.detailStatus, 'unknown');
  assert.equal(foreign.requests(), 0);
  for (const state of [
    { status: 403 },
    { status: 200, title: 'cookie-settings' },
  ]) {
    assert.equal(
      (await sourceFixture({ state }).collect())[0].attributes.detailStatus,
      'unknown'
    );
  }
});

it('retains unknown status at a detail deadline and propagates caller cancellation', async () => {
  const bounded = sourceFixture();
  bounded.collector.navigate = async (_commander, _url, { signal }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    signal.throwIfAborted();
  };
  assert.equal(
    (await bounded.collect({ deadline: Date.now() - 1 }))[0].attributes
      .detailStatus,
    'unknown'
  );
  const cancelled = sourceFixture();
  const controller = new AbortController();
  cancelled.collector.navigate = async () => {
    controller.abort();
    controller.signal.throwIfAborted();
  };
  await assert.rejects(cancelled.collect({ signal: controller.signal }), {
    name: 'AbortError',
  });
});

it('preserves status evidence when different detail requests complete concurrently', async () => {
  let records = [];
  const store = {
    loadRecords: async () => records,
    saveRecords: async (_kind, next) => {
      records = next;
    },
    updateRecords: async (_kind, update) => {
      records = update(records);
    },
  };
  for (const persistent of [true, false]) {
    const cache = new WebDetailStatusCache({
      store: persistent ? store : undefined,
    });
    const releases = [];
    const operations = ['one', 'two'].map((id) =>
      cache.inspect(
        `https://homedy.com/${id}`,
        () =>
          new Promise((resolve) =>
            releases.push(() => resolve({ text: 'Tin đăng đã hết hạn' }))
          )
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    releases[0]();
    await operations[0];
    releases[1]();
    await operations[1];
    assert.equal(persistent ? records.length : cache.memory.size, 2);
    for (const id of ['one', 'two']) {
      assert.equal(
        (
          await cache.inspect(`https://homedy.com/${id}`, async () => {
            throw new Error('Cached terminal evidence was lost.');
          })
        ).status,
        'expired'
      );
    }
  }
});
