#!/usr/bin/env node

// Offline controls for the manual/private collector; never opens Telegram.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recognizeImage,
  sourceMessageReader,
} from './telegram-90-day-media-audit.mjs';
import {
  analyzeHistoryMessages,
  collectSource,
  historySourceWorkers,
  historySourcePlan,
  normalizedHistoryMessage,
  parseHistoryAuditArguments,
} from './telegram-90-day-coverage-audit.mjs';

const NOW = new Date('2026-10-07T00:00:00Z');
assert.deepEqual(parseHistoryAuditArguments(['--help']), { help: true });
assert.equal(
  parseHistoryAuditArguments([
    '--user-env',
    'u',
    '--cohort-directory',
    'c',
    '--state-directory',
    's',
  ]).days,
  90
);
assert.throws(
  () =>
    parseHistoryAuditArguments([
      '--days',
      '60',
      '--user-env',
      'u',
      '--cohort-directory',
      'c',
      '--state-directory',
      's',
    ]),
  RangeError
);
assert.throws(() => parseHistoryAuditArguments([]), TypeError);
assert.throws(
  () =>
    parseHistoryAuditArguments([
      '--concurrency',
      '5',
      '--user-env',
      'u',
      '--cohort-directory',
      'c',
      '--state-directory',
      's',
    ]),
  RangeError
);
let active = 0;
let maximumActive = 0;
const worked = await historySourceWorkers([1, 2, 3, 4, 5], 3, async (value) => {
  active++;
  maximumActive = Math.max(maximumActive, active);
  await new Promise((fulfill) => setTimeout(fulfill, (6 - value) * 2));
  active--;
  return value * 2;
});
assert.deepEqual(worked, [2, 4, 6, 8, 10]);
assert.equal(maximumActive, 3);
assert.deepEqual(
  historySourcePlan([
    { type: 'group' },
    { type: 'channel' },
    { type: 'group' },
    { type: 'channel' },
  ]).map(({ index }) => index),
  [1, 3, 0, 2]
);
await assert.rejects(
  recognizeImage(
    '/nonexistent-vac-offline-ocr-command',
    Buffer.from('not-an-image')
  ),
  { code: 'ENOENT' }
);
const requestedBatches = [];
const mediaMaterials = Array.from({ length: 205 }, (_, index) => ({
  messageIds: [index + 1],
}));
const readMessages = sourceMessageReader(
  {
    getMessages(_source, { ids }) {
      requestedBatches.push(ids);
      return ids.map((id) => ({ id }));
    },
  },
  { username: 'qa_public' },
  mediaMaterials
);
for (const [index, material] of mediaMaterials.entries()) {
  assert.deepEqual(await readMessages(material, index), [{ id: index + 1 }]);
}
assert.deepEqual(
  requestedBatches.map((ids) => ids.length),
  [100, 100, 5]
);
const peerControlDirectory = await mkdtemp(
  join(tmpdir(), 'vac-public-peer-control-')
);
let privateHistoryCalls = 0;
try {
  await assert.rejects(
    collectSource(
      {
        getEntity() {
          return { className: 'User', username: 'qa_user' };
        },
        getMessages() {
          privateHistoryCalls++;
          return [];
        },
      },
      { username: 'qa_user' },
      {
        startedAt: NOW.toISOString(),
        cutoff: new Date(NOW.getTime() - 90 * 86400000).toISOString(),
      },
      peerControlDirectory,
      1
    ),
    /public Telegram community/u
  );
  assert.equal(privateHistoryCalls, 0);
} finally {
  await rm(peerControlDirectory, { recursive: true, force: true });
}
const otherCity = {
  id: 100,
  date: NOW.toISOString(),
  text: 'For rent: apartment in Da Nang, 8 million VND/month.',
};
assert.equal(
  analyzeHistoryMessages([otherCity], { username: 'qa_public', now: NOW })
    .counts.historicalTextOffers,
  0
);
assert.equal(
  analyzeHistoryMessages([otherCity], {
    username: 'qa_public',
    now: NOW,
    targetLocation: null,
  }).counts.historicalTextOffers,
  1
);
assert.throws(
  () => normalizedHistoryMessage({ id: 1, date: 'not-a-date' }, 'qa_public'),
  Error
);
const historical = normalizedHistoryMessage(
  {
    id: 1,
    date: new Date('2026-07-10T00:00:00Z'),
    message: 'For rent: 2 bedroom apartment in Nha Trang, 8 million VND/month.',
  },
  'qa_public'
);
const recent = normalizedHistoryMessage(
  {
    id: 2,
    date: new Date('2026-10-01T00:00:00Z'),
    message: 'For rent: studio in Nha Trang, 6 million VND/month.',
  },
  'qa_public'
);
const text = analyzeHistoryMessages([recent, historical], {
  username: 'qa_public',
  now: NOW,
});
assert.equal(text.counts.accountedMessages, 2);
assert.equal(text.counts.uniqueMessageIds, 2);
assert.equal(text.counts.historicalTextOffers, 2);
assert.equal(text.counts.parserErrors, 0);
// The defect experiment tests policy. This harness test verifies that its
// two independent parsing outcomes always reconcile, even after a future fix.
assert.equal(text.counts.productionOffers + text.counts.ageGateRejections, 2);
const album = analyzeHistoryMessages(
  [
    { ...recent, id: 3, groupedId: 'album', mediaId: 'photo:1' },
    { ...recent, id: 4, groupedId: 'album', text: '', mediaId: 'photo:2' },
  ],
  { username: 'qa_public', now: NOW }
);
assert.equal(album.counts.materials, 1);
assert.equal(album.counts.accountedMessages, 2);
assert.equal(album.counts.historicalTextOffers, 1);
const media = analyzeHistoryMessages(
  [{ ...recent, id: 5, text: '', mediaId: 'photo:3' }],
  { username: 'qa_public', now: NOW }
);
assert.equal(media.counts.photoOnlyUnresolved, 1);
assert.equal(media.counts.accountedMessages, 1);
assert.equal(media.counts.historicalTextOffers, 0);
const multipleCaptions = analyzeHistoryMessages(
  [
    { ...recent, id: 6, groupedId: 'captions' },
    { ...historical, id: 7, groupedId: 'captions' },
  ],
  { username: 'qa_public', now: NOW }
);
assert.equal(multipleCaptions.counts.multipleDifferentAlbumCaptions, 1);
assert.equal(multipleCaptions.counts.accountedMessages, 2);
console.log(
  'Offline history-audit controls passed; no network, credentials or private data used.'
);
