// Times a sharded offer save and an edit of one listing with a stand-in
// clink, to show where the per-batch projection time goes.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { LinkCliMirror } from '../src/link-cli-mirror.js';
import { LinksStore } from '../src/links-store.js';

const count = Number(process.argv[2] || 40);
const shardLinks = Number(process.argv[3] || 8);
const calls = [];
const run = async (_command, args) => {
  calls.push(args);
  const argument = (name) => args[args.indexOf(name) + 1];
  const notation = await readFile(argument('--import'), 'utf8');
  const digest = createHash('sha256').update(notation).digest('hex');
  await writeFile(argument('--db'), `binary:${digest}`);
  await writeFile(argument('--export'), notation);
};
const listing = (index, text = `Room ${index} near the beach`) => ({
  collectedAt: '2026-10-01T00:00:00.000Z',
  id: `offer-${String(index).padStart(3, '0')}`,
  postedAt: '2026-10-01T00:00:00.000Z',
  raw: { text },
  sourceId: 'telegram:test',
  title: `Room ${index}`,
});
const directory = await mkdtemp(join(tmpdir(), 'issue-85-timing-'));
try {
  const store = new LinksStore({
    directory,
    maxOfferShardBytes: 64_000,
    mirror: new LinkCliMirror({
      averageShardLinks: shardLinks,
      maxShardLinks: shardLinks * 2,
      minShardLinks: Math.max(1, shardLinks / 2),
      run,
    }),
  });
  let started = performance.now();
  await store.saveOffers(Array.from({ length: count }, (_, i) => listing(i)));
  console.log(
    `first save: ${calls.length} clink runs, ${Math.round(performance.now() - started)} ms`
  );
  calls.length = 0;
  started = performance.now();
  await store.saveOffers([listing(7, 'Room 7, price lowered')]);
  console.log(
    `edit one listing: ${calls.length} clink runs, ${Math.round(performance.now() - started)} ms`
  );
  started = performance.now();
  await store.listOffers();
  console.log(`read: ${Math.round(performance.now() - started)} ms`);
} finally {
  await rm(directory, { force: true, recursive: true });
}
