/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings:true}] -- Fixed dates are synthetic test inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LinksStore } from '../src/links-store.js';
import { withQaCleanup } from '../experiments/qa-cleanup.mjs';

it('resumes verified offline pages, reconciles chronology and preserves a complete cache after a checksum failure', async () => {
  if (typeof Deno !== 'undefined' || typeof Bun !== 'undefined') {
    return;
  }
  const { importCollectedCache } =
    await import('../experiments/import-collected-cache.mjs');
  const root = await mkdtemp(join(tmpdir(), 'vac-import-'));
  try {
    const directory = join(root, 'data');
    const page = JSON.stringify([
      {
        id: 'same',
        sourceId: 'source',
        title: 'Original',
        collectedAt: '2026-01-01',
        priceVnd: 10,
        raw: { text: 'original evidence' },
      },
      {
        id: 'same',
        sourceId: 'source',
        title: 'Edited',
        collectedAt: '2026-01-02',
        priceVnd: 20,
        raw: { text: 'edited evidence' },
      },
      {
        id: 'distinct',
        sourceId: 'source',
        title: 'Another',
        collectedAt: '2026-01-02',
        priceVnd: 30,
      },
    ]);
    await writeFile(join(root, 'page.json'), page);
    const manifestPath = join(root, 'manifest.json');
    const descriptor = {
      path: 'page.json',
      format: 'offers',
      sha256: createHash('sha256').update(page).digest('hex'),
    };
    await writeFile(
      manifestPath,
      JSON.stringify({ version: 1, pages: [descriptor] })
    );
    const guardFactory = async (_scope, { signal }) => ({
      signal,
      check: async () => {},
      owner: { synthetic: true },
    });
    const run = () =>
      withQaCleanup(
        (scope, signal) =>
          importCollectedCache({
            manifestPath,
            directory,
            scope,
            signal,
            guardFactory,
          }),
        { signals: false }
      );
    assert.equal((await run()).complete, true);
    assert.equal((await run()).complete, true);
    const store = new LinksStore({ directory });
    const offers = await store.listOffers();
    assert.equal(offers.length, 2);
    assert.equal(offers.find((offer) => offer.id === 'same').title, 'Edited');
    const before = await readFile(join(directory, 'offers.index.json'), 'utf8');
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        pages: [{ ...descriptor, sha256: 'a'.repeat(64) }],
      })
    );
    await assert.rejects(run(), /checksum/u);
    assert.equal(
      await readFile(join(directory, 'offers.index.json'), 'utf8'),
      before
    );
    assert.equal(
      await readFile(
        join(directory, '.offline-import', `${descriptor.sha256}.json`),
        'utf8'
      ),
      page
    );
    await store.saveOffers([
      ...offers,
      { id: 'live-addition', sourceId: 'live', title: 'Preserved live record' },
    ]);
    await assert.rejects(run(), /Canonical cache changed/u);
    assert.equal(
      (await new LinksStore({ directory }).listOffers()).some(
        (offer) => offer.id === 'live-addition'
      ),
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
