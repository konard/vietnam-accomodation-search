#!/usr/bin/env node
// Counts the reviewed corpus offers that dedupe merges by their parsed
// source property ids alone. A label word read as an id ("Код квартиры" →
// "квартиры") gives every post of a channel one id and merges them.
//
//   node experiments/issue-94-property-id-merges.mjs
import { deduplicateOffers, parseListingText } from '../src/index.js';
import { loadCorpus } from './field-corpus-metrics.mjs';

export function propertyIdMerges(corpus) {
  const offers = corpus.cases
    .filter(({ expected }) => expected.offer)
    .map(({ id, input }) => ({
      attributes: {
        propertyId: parseListingText(input.text).attributes.propertyId,
      },
      id,
      sourceId: input.sourceId,
      url: `https://corpus.invalid/${id}`,
    }));
  const unique = deduplicateOffers(offers);
  return {
    merged: offers.length - unique.length,
    offers: offers.length,
    unique: unique.length,
  };
}

if (import.meta.main) {
  const result = propertyIdMerges(await loadCorpus());
  console.log(JSON.stringify(result));
  process.exitCode = result.merged ? 1 : 0;
}
