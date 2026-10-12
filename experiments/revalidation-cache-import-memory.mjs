/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings:true}] -- Fixed dates are synthetic test inputs. */
// Synthetic, finite scaling fixture. No network and no production guard changes.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { importCollectedCache } from './import-collected-cache.mjs';
import { withQaCleanup } from './qa-cleanup.mjs';
import { LinksStore } from '../src/links-store.js';
const count = Number(process.argv[2] || 400);
if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
  throw new RangeError('Finite synthetic input required.');
}
const root = await mkdtemp(join(tmpdir(), 'vac-scaling-'));
let peakHeap = 0;
try {
  const pages = [];
  for (let offset = 0; offset < count; offset += 20) {
    const rows = Array.from(
      { length: Math.min(20, count - offset) },
      (_, index) => ({
        id: `synthetic-${offset + index}`,
        sourceId: 'synthetic',
        title: `Unit ${offset + index}`,
        collectedAt: '2026-10-12',
        priceVnd: 1000000 + offset + index,
        raw: { text: 'evidence '.repeat(512) },
      })
    );
    const text = JSON.stringify(rows);
    const path = `page-${offset}.json`;
    await writeFile(join(root, path), text);
    pages.push({
      path,
      sha256: createHash('sha256').update(text).digest('hex'),
      format: 'offers',
    });
  }
  const manifestPath = join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ version: 1, pages }));
  const directory = join(root, 'data');
  await withQaCleanup(
    (scope, signal) =>
      importCollectedCache({
        manifestPath,
        directory,
        scope,
        signal,
        memoryBytes: 96 * 1024 * 1024,
        guardFactory: () => ({
          signal,
          check: () => {
            peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
          },
          owner: { synthetic: true },
        }),
      }),
    { signals: false }
  );
  const store = new LinksStore({ directory, maxOfferShardBytes: 256 * 1024 });
  let retained = 0;
  for await (const offer of store.iterOffers()) {
    if (!offer.raw.text) {
      throw new Error('Evidence lost');
    }
    retained++;
  }
  const top = await store.topOffers({
    limit: 3,
    compare: (a, b) => a.priceVnd - b.priceVnd,
    project: (offer) => offer.id,
  });
  console.log(
    JSON.stringify({ synthetic: true, count, retained, peakHeap, top })
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
