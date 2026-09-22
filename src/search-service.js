import { deduplicateOffers } from './offers.js';

function isFresh(offer, now, maxAgeMs) {
  const collectedAt = new Date(offer.collectedAt).getTime();
  return (
    Number.isFinite(collectedAt) && now.getTime() - collectedAt <= maxAgeMs
  );
}

function normalizedQuery(value) {
  return value.trim().toLocaleLowerCase('en');
}

function isForQuery(offer, query) {
  const queries = offer.searchQueries || [offer.searchQuery];
  return (
    queries.every((value) => !value) ||
    queries.some(
      (value) => value && normalizedQuery(value) === normalizedQuery(query)
    )
  );
}

function telegramOfferMatches(offer, query) {
  const sourceTypes = offer.sourceTypes || [offer.sourceType];
  if (!sourceTypes.includes('telegram') || !query.trim()) {
    return true;
  }
  const searchable = [
    offer.title,
    offer.location,
    offer.raw?.text,
    offer.raw?.caption,
    ...(offer.variants || []).flatMap((variant) => [
      variant.raw?.text,
      variant.raw?.caption,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en');
  const tokens = query
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .split(/\s+/u)
    .filter(Boolean);
  return tokens.every((token) => searchable.includes(token));
}

function normalizedValue(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('en')
    : value;
}

function valueMatches(actual, expected) {
  if (typeof actual === 'string' && typeof expected === 'string') {
    return normalizedValue(actual).includes(normalizedValue(expected));
  }
  return actual === expected;
}

function filterValue(offer, key) {
  const segments = key.split('.');
  let value = Object.hasOwn(offer, segments[0]) ? offer : offer.attributes;
  for (const segment of segments) {
    value = value?.[segment];
  }
  return value ?? offer.attributes?.labeledFields?.[key];
}

function matchesFilters(offer, filters) {
  return Object.entries(filters).every(([key, expected]) => {
    const actual = filterValue(offer, key);
    if (Array.isArray(actual)) {
      return actual.some((value) => valueMatches(value, expected));
    }
    return valueMatches(actual, expected);
  });
}

function withinRange(value, minimum, maximum) {
  if (!Number.isFinite(minimum) && !Number.isFinite(maximum)) {
    return true;
  }
  return (
    Number.isFinite(value) &&
    (!Number.isFinite(minimum) || value >= minimum) &&
    (!Number.isFinite(maximum) || value <= maximum)
  );
}

function roomCount(offer) {
  const rooms = offer.attributes?.rooms;
  if (Number.isFinite(rooms)) {
    return rooms;
  }
  const bedrooms = offer.attributes?.bedrooms;
  return bedrooms === 0 ? 1 : bedrooms;
}

function matchesStructuredFilters(offer, options) {
  const rooms = roomCount(offer);
  const beds = offer.attributes?.beds;
  const kind = normalizedValue(offer.kind || 'accommodation');
  const types = (options.types || []).map(normalizedValue);
  return (
    (!types.length || types.includes(kind)) &&
    withinRange(rooms, options.minRooms, options.maxRooms) &&
    withinRange(
      Number.isFinite(rooms) ? offer.priceVnd / rooms : undefined,
      options.minPricePerRoomVnd,
      options.maxPricePerRoomVnd
    ) &&
    withinRange(
      Number.isFinite(beds) && beds > 0 ? offer.priceVnd / beds : undefined,
      options.minPricePerBedVnd,
      options.maxPricePerBedVnd
    ) &&
    withinRange(
      offer.priceVnd,
      options.minTotalPriceVnd,
      options.maxTotalPriceVnd
    )
  );
}

function sourceCoverageIsComplete(offers, sources, query) {
  if (!sources.length) {
    return offers.length > 0;
  }
  const covered = new Set(
    offers
      .filter((offer) => isForQuery(offer, query))
      .flatMap((offer) => offer.sourceIds || [offer.sourceId])
  );
  return sources.every((source) => covered.has(source.id));
}

export class SearchService {
  constructor({
    collector,
    maxAgeMs = 6 * 60 * 60 * 1000,
    mediaCache,
    now,
    registry,
    store,
  }) {
    this.collector = collector;
    this.maxAgeMs = maxAgeMs;
    this.mediaCache = mediaCache;
    this.now = now || (() => new Date());
    this.registry = registry;
    this.store = store;
  }

  shouldRefresh(offers, sources, refresh, query) {
    if (refresh !== null && refresh !== undefined) {
      return refresh;
    }
    return (
      !offers.some(
        (offer) =>
          isForQuery(offer, query) && isFresh(offer, this.now(), this.maxAgeMs)
      ) || !sourceCoverageIsComplete(offers, sources, query)
    );
  }

  async search(options = {}) {
    const {
      cheapest = false,
      filters = {},
      limit = 10,
      query = '',
      refresh,
    } = options;
    let offers = await this.store.listOffers();
    const sources = await this.registry.list();

    if (this.shouldRefresh(offers, sources, refresh, query)) {
      let collected = await this.collector.collect(sources, query);
      if (this.mediaCache) {
        collected = await this.mediaCache.cacheOffers(collected);
      }
      await this.store.saveOffers(collected);
      const budget = await this.mediaCache?.enforceBudget(collected);
      if (budget?.removed.length) {
        await this.store.saveOffers(collected);
      }
      offers = await this.store.listOffers();
    }

    const unique = deduplicateOffers(offers).filter(
      (offer) =>
        Number.isFinite(offer.priceVnd) &&
        isForQuery(offer, query) &&
        telegramOfferMatches(offer, query) &&
        matchesFilters(offer, filters) &&
        matchesStructuredFilters(offer, options)
    );
    unique.sort((left, right) =>
      cheapest
        ? left.priceVnd - right.priceVnd
        : new Date(right.collectedAt || 0) - new Date(left.collectedAt || 0)
    );
    return unique.slice(0, limit);
  }
}
