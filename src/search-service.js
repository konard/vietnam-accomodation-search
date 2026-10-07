import { telegramHistoryWindow } from './telegram-window.js';
import { deduplicateOffers } from './offers.js';
import { TraceRecorder } from './trace.js';
import { summarizeOutcomes } from './source-pool.js';
import {
  collectionKey,
  matchingSources,
  refreshSources,
} from './search-refresh.js';

function isFresh(offer, now, maxAgeMs) {
  const collectedAt = new Date(offer.collectedAt).getTime();
  const age = now.getTime() - collectedAt;
  return Number.isFinite(collectedAt) && age >= 0 && age <= maxAgeMs;
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

function normalizedType(offer) {
  return normalizedValue(
    offer.kind || offer.type || offer.attributes?.type || ''
  );
}

function finiteCount(offer, name) {
  const direct = offer.attributes?.[name];
  if (Number.isFinite(direct)) {
    return direct;
  }
  const labeled = offer.attributes?.labeledFields?.[name];
  const first = Array.isArray(labeled) ? labeled[0] : labeled;
  const match = String(first || '').match(/\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : undefined;
}

function inRange(value, minimum, maximum) {
  if (minimum === undefined && maximum === undefined) {
    return true;
  }
  return (
    Number.isFinite(value) &&
    (minimum === undefined || value >= minimum) &&
    (maximum === undefined || value <= maximum)
  );
}

function effectiveRange(options, minimum, maximum, minimumAlias, maximumAlias) {
  return [
    options[minimum] ?? options[minimumAlias],
    options[maximum] ?? options[maximumAlias],
  ];
}

function matchesNamedFilters(offer, options) {
  const rooms = finiteCount(offer, 'rooms');
  const beds = finiteCount(offer, 'beds');
  const total = offer.priceVnd;
  const totalRange = effectiveRange(
    options,
    'minTotalVnd',
    'maxTotalVnd',
    'minTotalPriceVnd',
    'maxTotalPriceVnd'
  );
  const roomRange = effectiveRange(
    options,
    'minPerRoomVnd',
    'maxPerRoomVnd',
    'minPricePerRoomVnd',
    'maxPricePerRoomVnd'
  );
  const bedRange = effectiveRange(
    options,
    'minPerBedVnd',
    'maxPerBedVnd',
    'minPricePerBedVnd',
    'maxPricePerBedVnd'
  );
  return (
    (!options.types?.length ||
      options.types.map(normalizedValue).includes(normalizedType(offer))) &&
    inRange(rooms, options.minRooms, options.maxRooms) &&
    inRange(total, ...totalRange) &&
    inRange(
      Number.isFinite(rooms) && rooms > 0 ? total / rooms : undefined,
      ...roomRange
    ) &&
    inRange(
      Number.isFinite(beds) && beds > 0 ? total / beds : undefined,
      ...bedRange
    )
  );
}

// Sold-out, rented, and occupied listings stay stored so a later copy can
// update them, but search and subscriptions skip them unless asked.
function isAvailable(offer, options, since) {
  return (
    options.includeUnavailable === true ||
    ((offer.sourceType !== 'telegram' ||
      !offer.postedAt ||
      new Date(offer.postedAt) >= since) &&
      offer.attributes?.reviewRequired !== true &&
      offer.attributes?.availability !== 'unavailable' &&
      offer.attributes?.availableNow !== false)
  );
}

export class SearchService {
  constructor({
    collector,
    historyDays = 90,
    maxAgeMs = 6 * 60 * 60 * 1000,
    mediaCache,
    now,
    registry,
    store,
    traceRecorder,
  }) {
    this.collector = collector;
    this.historyDays = historyDays;
    this.maxAgeMs = maxAgeMs;
    this.mediaCache = mediaCache;
    this.now = now || (() => new Date());
    this.registry = registry;
    this.store = store;
    this.trace = traceRecorder || new TraceRecorder({ now, store });
    this.traceSequence = 0;
    this.collectionStates = [];
    this.refreshTasks = new Map();
  }

  shouldRefresh(offers, sources, refresh, query) {
    if (refresh !== null && refresh !== undefined) {
      return refresh;
    }
    return sources.length
      ? this.#staleSources(offers, matchingSources(sources, query), query)
          .length > 0
      : !offers.some(
          (offer) =>
            isForQuery(offer, query) &&
            isFresh(offer, this.now(), this.maxAgeMs)
        );
  }

  #staleSources(offers, sources, query, force = false) {
    return refreshSources({
      offers,
      sources,
      query,
      states: this.collectionStates,
      now: this.now(),
      maxAgeMs: this.maxAgeMs,
      force,
    });
  }

  async #rememberOutcome(outcome, query) {
    if (!outcome || ['pending', 'cancelled'].includes(outcome.status)) {
      return;
    }
    const id = collectionKey(outcome.sourceId, query);
    const timestamp = this.now().toISOString();
    const update = (current) => {
      const previous = current.find((state) => state.id === id);
      const state = {
        ...previous,
        id,
        sourceId: outcome.sourceId,
        query,
        attemptedAt: timestamp,
        status: outcome.status,
        ...(outcome.historyComplete === undefined
          ? {}
          : { historyComplete: outcome.historyComplete }),
      };
      if (
        ['offers', 'empty'].includes(outcome.status) &&
        outcome.historyComplete !== false
      ) {
        state.collectedAt = timestamp;
      }
      return [...current.filter((entry) => entry.id !== id), state];
    };
    if (this.store.updateRecords) {
      this.collectionStates = await this.store.updateRecords(
        'search-collections',
        update
      );
    } else {
      this.collectionStates = update(this.collectionStates);
      await this.store.saveRecords?.(
        'search-collections',
        this.collectionStates
      );
    }
  }

  async waitForRefresh() {
    await Promise.all(
      [...this.refreshTasks.values()].map(({ promise }) => promise)
    );
  }

  async search(options = {}) {
    return (await this.searchWithReport(options)).offers;
  }

  #cachedReport(refreshingSources, query) {
    const incomplete = this.collectionStates.filter(
      (state) =>
        normalizedQuery(state.query || '') === normalizedQuery(query) &&
        refreshingSources.includes(state.sourceId) &&
        state.historyComplete === false
    );
    const outcomes = incomplete.map(({ sourceId }) => ({
      sourceId,
      status: 'partial',
      historyComplete: false,
      offers: 0,
    }));
    return {
      refreshingSources,
      ...(outcomes.length
        ? { outcomes, summary: summarizeOutcomes(outcomes) }
        : {}),
    };
  }

  // Saves each finished source as it completes, so an interrupted refresh
  // keeps finished work; writes are chained to keep them ordered.
  #sourcePersister(query) {
    let chain = Promise.resolve();
    const persist = async ({ offers, outcome, signal }) => {
      if (!offers.length) {
        await this.#rememberOutcome(outcome, query);
        return;
      }
      const cached = this.mediaCache
        ? await this.mediaCache.cacheOffers(offers, { signal })
        : offers;
      await this.store.saveOffers(cached);
      await this.#rememberOutcome(outcome, query);
    };
    return (completion) => {
      chain = chain.then(() => persist(completion));
      return chain;
    };
  }

  async #refresh(sources, query, { runId, signal }) {
    const options = { runId, signal, traceRecorder: this.trace };
    if (typeof this.collector.collectWithReport !== 'function') {
      let collected = await this.collector.collect(sources, query, options);
      if (this.mediaCache) {
        collected = await this.mediaCache.cacheOffers(collected);
      }
      await this.store.saveOffers(collected);
      for (const source of sources) {
        await this.#rememberOutcome(
          { sourceId: source.id, status: 'empty' },
          query
        );
      }
      return { collected, report: undefined };
    }
    const report = await this.collector.collectWithReport(sources, query, {
      ...options,
      onSourceComplete: this.#sourcePersister(query),
    });
    return { collected: report.offers, report };
  }

  // eslint-disable-next-line complexity -- Search owns one correlated lifecycle across refresh, cache, ranking, and trace outcomes.
  async searchWithReport(options = {}) {
    const {
      cheapest = false,
      filters = {},
      limit = 10,
      query = '',
      refresh,
      signal,
      traceRunId,
    } = options;
    const runId =
      traceRunId ||
      `search:${this.now().toISOString()}:${(this.traceSequence += 1)}`;
    this.trace.record({ runId, stage: 'search', status: 'start' });
    try {
      let offers = await this.store.listOffers();
      const sources = matchingSources(await this.registry.list(), query);
      this.collectionStates =
        (await this.store.loadRecords?.('search-collections')) ||
        this.collectionStates;
      const shouldRefresh = this.shouldRefresh(offers, sources, refresh, query);
      let report;

      if (shouldRefresh) {
        const ordered = this.#staleSources(
          offers,
          sources,
          query,
          refresh === true
        );
        const key = normalizedQuery(query);
        const cached =
          options.cacheFirst &&
          refresh !== true &&
          offers.some((offer) => isForQuery(offer, query));
        let task = this.refreshTasks.get(key);
        if (!task) {
          const promise = (async () => {
            const refreshed = await this.#refresh(ordered, query, {
              runId,
              signal,
            });
            const budget = await this.mediaCache?.enforceBudget(
              refreshed.collected
            );
            if (budget?.removed.length) {
              await this.store.saveOffers(refreshed.collected);
            }
            return refreshed.report;
          })();
          task = { sourceIds: ordered.map(({ id }) => id), promise };
          this.refreshTasks.set(key, task);
          // Keep failures observed while a cache-first caller has already left.
          task.promise = promise
            .catch((error) => {
              if (!cached) {
                throw error;
              }
              this.trace.record({
                runId,
                stage: 'background-refresh',
                status: 'failure',
                metadata: { code: error?.code },
              });
              return undefined;
            })
            .finally(async () => {
              try {
                if (cached) {
                  await this.trace.persist();
                }
              } finally {
                this.refreshTasks.delete(key);
              }
            })
            .catch((error) => {
              if (!cached) {
                throw error;
              }
              // Observe trace persistence failures after the caller returned.
              this.trace.record({
                runId,
                stage: 'background-trace',
                status: 'failure',
                metadata: { code: error?.code },
              });
              return undefined;
            });
        }
        if (cached) {
          report = this.#cachedReport(task.sourceIds, query);
        } else {
          report = await task.promise;
          offers = await this.store.listOffers();
        }
      }

      const since = telegramHistoryWindow({
        now: this.now(),
        historyDays: this.historyDays,
      }).since;
      const unique = deduplicateOffers(offers).filter(
        (offer) =>
          Number.isFinite(offer.priceVnd) &&
          isAvailable(offer, options, since) &&
          isForQuery(offer, query) &&
          telegramOfferMatches(offer, query) &&
          matchesFilters(offer, filters) &&
          matchesNamedFilters(offer, options)
      );
      unique.sort((left, right) =>
        cheapest
          ? left.priceVnd - right.priceVnd
          : new Date(right.collectedAt || 0) - new Date(left.collectedAt || 0)
      );
      const result = unique.slice(0, limit);
      this.trace.record({
        runId,
        stage: 'search',
        status: report?.summary?.failed ? 'degraded' : 'success',
        metadata: {
          candidates: unique.length,
          failedSources: report?.summary?.failed,
          refresh: shouldRefresh,
          returned: result.length,
          sources: sources.length,
        },
      });
      return {
        offers: result,
        report: report && {
          refreshingSources: report.refreshingSources,
          budgetElapsed: report.budgetElapsed,
          outcomes: report.outcomes,
          summary: report.summary,
        },
      };
    } catch (error) {
      this.trace.record({
        runId,
        stage: 'search',
        status:
          error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
            ? 'cancelled'
            : 'failure',
        metadata: { code: error?.code, message: error?.message },
      });
      throw error;
    } finally {
      await this.trace.persist();
    }
  }
}
