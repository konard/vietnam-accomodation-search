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
  return (
    !offer.searchQuery ||
    normalizedQuery(offer.searchQuery) === normalizedQuery(query)
  );
}

function telegramOfferMatches(offer, query) {
  if (offer.sourceType !== 'telegram' || !query.trim()) {
    return true;
  }
  const searchable = [
    offer.title,
    offer.location,
    offer.raw?.text,
    offer.raw?.caption,
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

function sourceCoverageIsComplete(offers, sources, query) {
  if (!sources.length) {
    return offers.length > 0;
  }
  const covered = new Set(
    offers
      .filter((offer) => isForQuery(offer, query))
      .map((offer) => offer.sourceId)
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

  async search({ cheapest = false, limit = 10, query = '', refresh } = {}) {
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
        telegramOfferMatches(offer, query)
    );
    unique.sort((left, right) =>
      cheapest
        ? left.priceVnd - right.priceVnd
        : new Date(right.collectedAt || 0) - new Date(left.collectedAt || 0)
    );
    return unique.slice(0, limit);
  }
}
