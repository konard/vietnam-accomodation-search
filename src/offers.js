import { convertToVnd, parsePrice } from './pricing.js';
import { firstPresent, stableHash } from './utils.js';

function compact(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optional(key, value) {
  return value === undefined ? {} : { [key]: value };
}

function optionalDate(value) {
  return value ? new Date(value).toISOString() : undefined;
}

export function normalizeOffer(input, options = {}) {
  const text = firstPresent(compact(input.text), compact(input.title), '');
  const price = firstPresent(input.price, parsePrice(text));
  const rates = firstPresent(options.rates, { VND: 1 });
  const url = compact(input.url);
  const sourceId = firstPresent(compact(input.sourceId), 'unknown');
  const generatedId = `${sourceId}:${stableHash(
    `${firstPresent(url, '')}\n${text}\n${firstPresent(input.postedAt, '')}`
  )}`;
  const id = firstPresent(compact(input.id), generatedId);

  return {
    id,
    sourceId,
    ...optional('sourceType', compact(input.sourceType)),
    title: firstPresent(
      compact(input.title),
      text.split(/\r?\n/u)[0],
      'Accommodation'
    ),
    ...optional('kind', compact(input.kind)),
    ...optional('location', compact(input.location)),
    ...optional('attributes', input.attributes),
    ...optional('contacts', input.contacts),
    price,
    priceVnd: convertToVnd(price, rates),
    ...optional('url', url),
    ...optional('searchQuery', compact(input.searchQuery)),
    photos: [...new Set(firstPresent(input.photos, []))]
      .filter(Boolean)
      .slice(0, 10),
    ...optional('postedAt', optionalDate(input.postedAt)),
    collectedAt: firstPresent(options.now, new Date()).toISOString(),
    raw: firstPresent(input.raw, { ...input }),
  };
}

export function deduplicateOffers(offers) {
  const unique = new Map();
  for (const offer of offers) {
    unique.set(offer.id, offer);
  }
  return [...unique.values()];
}
