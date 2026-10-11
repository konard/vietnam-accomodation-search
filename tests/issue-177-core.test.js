/* eslint local/no-changelog-comments: ["warn", {"allowDatesInStrings": true}] -- Dates are fixed fixture inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { readdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LinkCliMirror } from '../src/link-cli-mirror.js';
import { classifyPage } from '../experiments/browser-real-estate-audit-lib.mjs';
import { predictCase } from '../experiments/field-corpus-metrics.mjs';
import { SearchService, parseSearchCommand } from '../src/index.js';

it('removes failed capability builds including renamed retirement paths', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  let probe;
  const mirror = new LinkCliMirror({
    run: async (_command, args) => {
      if (args.includes('--db')) {
        probe = dirname(args[args.indexOf('--db') + 1]);
      }
    },
  });
  await assert.rejects(mirror.preflight(), { code: 'CLINK_INCOMPATIBLE' });
  await assert.rejects(access(probe));
  const parent = dirname(probe);
  const siblings = await readdir(parent).catch(() => []);
  assert.equal(
    siblings.some((name) => name.startsWith(probe.split(/[\\/]/u).at(-1))),
    false
  );
});

it('rejects HTTP errors and pending pages before counting rental cards', () => {
  for (const [status, category] of [
    [404, 'http_not_found'],
    [502, 'http_server_error'],
    [503, 'http_server_error'],
    [202, 'http_pending'],
  ]) {
    for (const cardCount of [0, 1]) {
      assert.equal(
        classifyPage({ status, cardCount, url: 'https://fixture.invalid' }),
        category
      );
    }
  }
  assert.equal(
    classifyPage({ status: 200, cardCount: 1, url: 'https://fixture.invalid' }),
    'success'
  );
  assert.equal(classifyPage({ status: 200 }), 'zero_cards');
});

it('measures independent bedroom, room and bed denominators', async () => {
  const result = await predictCase({
    input: {
      sourceId: 'fixture',
      sourceType: 'web',
      postedAt: '2025-01-01',
      text: 'Apartment for rent in Nha Trang: 12 million VND/month. 2 bedrooms, 3 rooms, 4 beds.',
    },
  });
  assert.equal(result.bedrooms, 2);
  assert.equal(result.rooms, 3);
  assert.equal(result.beds, 4);
});

it('applies bedroom ceilings and unit ordering through the shared command contract', async () => {
  const offers = [1, 3].map((bedrooms, i) => ({
    id: String(i),
    price: { amount: i ? 12e6 : 6e6, currency: 'VND', period: 'month' },
    priceVnd: i ? 12e6 : 6e6,
    attributes: { bedrooms },
    collectedAt: new Date().toISOString(),
  }));
  const search = new SearchService({
    collector: {},
    registry: { list: async () => [] },
    store: { listOffers: async () => offers },
  });
  const options = parseSearchCommand(
    '--sort-by pricePerBedroomVnd --max-per-bedroom-vnd 5000000'
  );
  assert.equal(options.sortBy, 'pricePerBedroomVnd');
  assert.equal(options.maxPerBedroomVnd, 5e6);
  assert.deepEqual(
    (await search.search({ ...options, refresh: false })).map(({ id }) => id),
    ['1']
  );
});
