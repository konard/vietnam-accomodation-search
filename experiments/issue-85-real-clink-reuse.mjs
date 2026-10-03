// Saves a sharded offer collection through the real `clink`, edits one
// listing, and reports how many sub-shards clink imported for the edit.
// Usage: PATH=/path/to/clink/bin:$PATH node \
//   experiments/issue-85-real-clink-reuse.mjs [listings] [chunkBytes]
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LinkCliMirror, runClink } from '../src/link-cli-mirror.js';
import { LinksStore } from '../src/links-store.js';

const count = Number(process.argv[2] || 40);
const chunkBytes = Number(process.argv[3] || 64_000);
const runs = [];
const run = (command, args, options) => {
  runs.push(args);
  return runClink(command, args, options);
};
const listing = (index, text = `Room ${index} near the beach`) => ({
  collectedAt: '2026-10-01T00:00:00.000Z',
  id: `offer-${String(index).padStart(3, '0')}`,
  postedAt: '2026-10-01T00:00:00.000Z',
  raw: { text },
  sourceId: 'telegram:test',
  title: `Room ${index}`,
});
const directory = await mkdtemp(join(tmpdir(), 'issue-85-real-'));
try {
  const store = new LinksStore({
    directory,
    maxOfferShardBytes: chunkBytes,
    mirror: new LinkCliMirror({ run }),
  });
  await store.saveOffers(Array.from({ length: count }, (_, i) => listing(i)));
  const index = JSON.parse(
    await readFile(join(directory, 'offers.index.json'), 'utf8')
  );
  const subShards = (
    await readdir(join(directory, 'offers.chunks'), {
      recursive: true,
    })
  ).filter((entry) => entry.endsWith('data.links')).length;
  console.log(
    `first save: ${runs.length} clink runs, ${index.shards.length} chunks, ${subShards} databases`
  );
  runs.length = 0;
  await store.saveOffers([
    listing(Math.floor(count / 2), 'Room price lowered'),
  ]);
  console.log(`edit one listing: ${runs.length} clink runs`);
  runs.length = 0;
  const offers = await store.listOffers();
  console.log(`read: ${offers.length} offers, ${runs.length} clink runs`);
} finally {
  await rm(directory, { force: true, recursive: true });
}
