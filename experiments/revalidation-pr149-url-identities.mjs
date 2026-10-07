#!/usr/bin/env node

// Self-authored manual acceptance diagnostic, not a passing CI assertion.
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
if (
  execFileSync('clink', ['--version'], { encoding: 'utf8' }).trim() !==
  'clink 0.2.11'
) {
  throw new Error('Actual clink 0.2.11 is required.');
}
const unit = (messageId, propertyId, floor, website = true) =>
  parseTelegramOffer(
    {
      id: messageId,
      messageId,
      chat: { username: 'qa_unit_source' },
      sourceId: 'telegram:qa-unit-source',
      date: now,
      text: `For rent: Ocean Home apartment in Nha Trang.
ID: ${propertyId}
50 m², 1 bedroom, floor: ${floor}.
8 million VND/month. Contact: @qa_rental_agent
${website ? 'Official website: https://ocean-home.example.invalid/' : ''}`,
    },
    { now }
  );
const first = unit(1, 'A1702', 17);
const second = unit(2, 'A1802', 18);
const repost = unit(3, 'A1702', 17);
const checks = [
  {
    name: 'distinct-unit-ids-and-post-urls-with-shared-property-website',
    expected: true,
    actual:
      first.attributes.propertyId !== second.attributes.propertyId &&
      first.url !== second.url &&
      first.officialUrl === second.officialUrl,
  },
  {
    name: 'same-unit-repost-with-common-website-still-merges',
    expected: 1,
    actual: deduplicateOffers([first, repost]).length,
  },
  {
    name: 'distinct-units-without-common-website-control',
    expected: 2,
    actual: deduplicateOffers([
      unit(1, 'A1702', 17, false),
      unit(2, 'A1802', 18, false),
    ]).length,
  },
  {
    name: 'distinct-units-with-common-property-website-stay-separate',
    expected: 2,
    actual: deduplicateOffers([first, second]).length,
  },
];
const directory = await mkdtemp(join(tmpdir(), 'pr149-url-identities-e2e-'));
try {
  await new LinksStore({ directory, binaryMirror: true }).saveOffers([
    first,
    second,
  ]);
  const stored = await new LinksStore({
    directory,
    binaryMirror: true,
  }).listOffers();
  checks.push({
    name: 'persisted-distinct-units-with-common-website-stay-separate',
    expected: 2,
    actual: stored.length,
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
const results = checks.map((check) => ({
  ...check,
  pass: Object.is(check.actual, check.expected),
}));
console.log(
  JSON.stringify({ mode: 'offline-diagnostic', checks: results }, null, 2)
);
process.exitCode = results.every((check) => check.pass) ? 0 : 1;
