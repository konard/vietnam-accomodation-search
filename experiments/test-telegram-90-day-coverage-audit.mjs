#!/usr/bin/env node

// Offline controls for the manual/private collector; never opens Telegram.
import assert from 'node:assert/strict';
import { recognizeImage } from './telegram-90-day-media-audit.mjs';
import {
  analyzeHistoryMessages,
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
