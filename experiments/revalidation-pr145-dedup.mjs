#!/usr/bin/env node

// Self-authored diagnostic, not live channel data or a passing CI assertion.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LinksStore,
  deduplicateOffers,
  parseTelegramOffer,
} from '../src/index.js';

const now = new Date();
const offer = (
  id,
  propertyId,
  floor,
  amount = 8,
  { date = now, availability = '' } = {}
) =>
  parseTelegramOffer(
    {
      id,
      chatId: 'qa-dedup',
      sourceId: 'telegram:qa-dedup',
      date,
      text:
        'For rent: Ocean Home studio apartment in Nha Trang.\n' +
        `ID: ${propertyId}\n` +
        `50 m², 1 bedroom, floor: ${floor}.\n` +
        `${amount} million VND/month. Contact: @qa_rental_agent\n${availability}`,
    },
    { now }
  );
const first = offer(1, 'A1702', 17);
const second = offer(2, 'A1802', 18);
const repost = offer(3, 'A1702', 17, 9);
const recentSold = offer(4, 'A1702', 17, 8, {
  availability: 'Sold out. No longer available.',
});
const olderAvailable = offer(5, 'A1702', 17, 9, {
  date: new Date(now.getTime() - 86_400_000),
  availability: 'Available now.',
});
const descending = deduplicateOffers([recentSold, olderAvailable])[0];
const ascending = deduplicateOffers([olderAvailable, recentSold])[0];
const controls = [
  {
    name: 'both-unit-identifiers-survive-parsing',
    expected: true,
    actual:
      first?.attributes?.propertyId === 'A1702' &&
      second?.attributes?.propertyId === 'A1802',
  },
  {
    name: 'same-unit-repost-still-deduplicates',
    expected: 1,
    actual: deduplicateOffers([first, repost]).length,
  },
  {
    name: 'distinct-explicit-units-with-shared-agent-stay-separate',
    expected: 2,
    actual: deduplicateOffers([first, second]).length,
  },
  {
    name: 'newer-sold-and-older-available-parse-correctly',
    expected: true,
    actual:
      recentSold.attributes.availableNow === false &&
      olderAvailable.attributes.availableNow === true,
  },
  {
    name: 'descending-history-retains-newer-unavailable-state',
    expected: false,
    actual: descending.attributes.availableNow,
  },
  {
    name: 'descending-history-retains-newer-post-price',
    expected: 8_000_000,
    actual: descending.priceVnd,
  },
  {
    name: 'ascending-control-retains-newer-unavailable-state',
    expected: false,
    actual: ascending.attributes.availableNow,
  },
  {
    name: 'ascending-control-retains-newer-post-price',
    expected: 8_000_000,
    actual: ascending.priceVnd,
  },
];
const realBinaryStorage = process.env.QA_DEDUP_STORAGE === '1';
if (realBinaryStorage) {
  if (
    execFileSync('clink', ['--version'], { encoding: 'utf8' }).trim() !==
    'clink 0.2.11'
  ) {
    throw new Error(
      'Actual clink 0.2.11 is required for storage verification.'
    );
  }
  const directory = await mkdtemp(join(tmpdir(), 'pr145-dedup-e2e-'));
  try {
    for (const [name, input] of [
      ['distinct', [first, second]],
      ['history', [recentSold, olderAvailable]],
    ]) {
      const path = join(directory, name);
      await new LinksStore({ directory: path, binaryMirror: true }).saveOffers(
        input
      );
      const stored = await new LinksStore({
        directory: path,
        binaryMirror: true,
      }).listOffers();
      controls.push(
        ...(name === 'distinct'
          ? [
              {
                name: 'persisted-distinct-units-stay-separate',
                expected: 2,
                actual: stored.length,
              },
            ]
          : [
              {
                name: 'persisted-history-retains-newer-unavailable-state',
                expected: false,
                actual: stored[0].attributes.availableNow,
              },
              {
                name: 'persisted-history-retains-newer-post-price',
                expected: 8_000_000,
                actual: stored[0].priceVnd,
              },
            ])
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const checks = controls.map((check) => ({
  ...check,
  pass: Object.is(check.expected, check.actual),
}));
console.log(
  JSON.stringify(
    { mode: 'offline-diagnostic', realBinaryStorage, checks },
    null,
    2
  )
);
process.exitCode = checks.every((check) => check.pass) ? 0 : 1;
