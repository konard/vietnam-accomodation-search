#!/usr/bin/env node

// Aggregate-only reproduction of a retained Telegram audit offer merge.
// Never prints an offer, source, identity, journal path, or raw field.
// Usage: node experiments/profile-private-offer-merge.mjs OFFERS_LINO_OR_DIRECTORY JOURNAL_JSON

import { readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import {
  LinksStore,
  deserializeOffers,
  serializeRecords,
} from '../src/links-store.js';
import { deduplicateOffers } from '../src/offers.js';

if (!process.argv[2] || !process.argv[3]) {
  throw new TypeError('Pass a private offers snapshot and source journal.');
}

const inputPath = process.argv[2];
const [details, journalText] = await Promise.all([
  stat(inputPath),
  readFile(process.argv[3], 'utf8'),
]);
const existing =
  details.isDirectory() || basename(inputPath) === 'offers.lino'
    ? await new LinksStore({
        directory: details.isDirectory() ? inputPath : dirname(inputPath),
      }).listOffers()
    : deserializeOffers(await readFile(inputPath, 'utf8'));
const incoming = JSON.parse(journalText).payload.batch.offers;
const merged = deduplicateOffers([...existing, ...incoming]);

function aggregate(offers) {
  let jsonCharacters = 0;
  let maxOfferCharacters = 0;
  let maxNotationCharacters = 0;
  let notationCharacters = 0;
  let maxVariants = 0;
  let totalVariants = 0;
  for (const offer of offers) {
    const characters = JSON.stringify(offer).length;
    const formatted = serializeRecords('offer', [offer]).length;
    const variants = offer.variants?.length || 0;
    jsonCharacters += characters;
    maxOfferCharacters = Math.max(maxOfferCharacters, characters);
    maxNotationCharacters = Math.max(maxNotationCharacters, formatted);
    notationCharacters += formatted;
    maxVariants = Math.max(maxVariants, variants);
    totalVariants += variants;
  }
  return {
    count: offers.length,
    jsonCharacters,
    maxOfferCharacters,
    maxNotationCharacters,
    maxVariants,
    notationCharacters,
    totalVariants,
  };
}

console.log(
  JSON.stringify({
    existing: aggregate(existing),
    incoming: aggregate(incoming),
    merged: aggregate(merged),
  })
);
