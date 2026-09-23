export const BROWSER_ADAPTER_SCHEMA_VERSION = 1;

export const PAGE_CLASSIFICATIONS = Object.freeze({
  CHALLENGE: 'challenge',
  CONSENT: 'consent-wall',
  EMPTY: 'empty',
  LANDING: 'landing',
  LOGIN: 'login',
  NAVIGATION_LOOP: 'navigation-loop',
  RENTAL: 'rental',
  SALE: 'sale',
  SELECTOR_DRIFT: 'selector-drift',
  WRONG_LOCATION: 'wrong-location',
});

// eslint-disable-next-line complexity -- Page outcomes are an explicit mutually exclusive adapter contract.
export function classifyListingPage({
  cards = 0,
  status = 200,
  title = '',
  url = '',
  expectedLocation,
} = {}) {
  const context = `${title}\n${url}`;
  if (
    [401, 403, 429].includes(status) ||
    /captcha|cloudflare|verify\s+(?:you|human)|access\s+denied/iu.test(context)
  ) {
    return PAGE_CLASSIFICATIONS.CHALLENGE;
  }
  if (/login|log-in|sign-in|đăng-nhập/iu.test(context)) {
    return PAGE_CLASSIFICATIONS.LOGIN;
  }
  if (
    /consent|cookie-settings|privacy-choices|quyền\s+riêng\s+tư/iu.test(context)
  ) {
    return PAGE_CLASSIFICATIONS.CONSENT;
  }
  if (
    /mua-ban|for-sale|\bsale\b|căn\s*hộ\s*bán|bán\s+(?:nhà|căn)/iu.test(context)
  ) {
    return PAGE_CLASSIFICATIONS.SALE;
  }
  if (
    expectedLocation === 'nha-trang' &&
    /da\s*nang|đà\s*nẵng|hanoi|hà\s*nội|ho\s*chi\s*minh|saigon|phu\s*quoc|đà\s*lạt/iu.test(
      context
    ) &&
    !/nha\s*trang|nhatrang|нячанг/iu.test(context)
  ) {
    return PAGE_CLASSIFICATIONS.WRONG_LOCATION;
  }
  if (cards > 0) {
    return PAGE_CLASSIFICATIONS.RENTAL;
  }
  if (/cho-thue|for-rent|\brent(?:al)?\b|аренд/iu.test(context)) {
    return PAGE_CLASSIFICATIONS.SELECTOR_DRIFT;
  }
  return /search|results|listing/iu.test(context)
    ? PAGE_CLASSIFICATIONS.EMPTY
    : PAGE_CLASSIFICATIONS.LANDING;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function cancellableDelay(milliseconds, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Browser collection cancelled.'));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason || new Error('Browser collection cancelled.'));
      },
      { once: true }
    );
  });
}

// eslint-disable-next-line complexity -- Browser transport and page outcomes have distinct cooldown policies.
export function classifyBrowserFailure(error) {
  const status = Number(error?.status ?? error?.statusCode);
  const context = `${error?.code || ''} ${error?.message || ''}`;
  if (
    error?.classification === PAGE_CLASSIFICATIONS.CHALLENGE ||
    status === 403 ||
    /captcha|challenge|access[\s_-]*denied|cloudflare/iu.test(context)
  ) {
    return { category: 'challenge', retryable: false, stopDomain: true };
  }
  if (error?.classification) {
    return {
      category: error.classification,
      retryable: false,
      stopDomain: false,
    };
  }
  if (status === 429 || /\b429\b|rate[\s_-]*limit/iu.test(context)) {
    return { category: 'rate-limit', retryable: true, stopDomain: false };
  }
  if (
    /ETIMEDOUT|ESOCKETTIMEDOUT|ERR_TIMED_OUT|timeout|timed out/iu.test(context)
  ) {
    return { category: 'timeout', retryable: true, stopDomain: false };
  }
  if (
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH/iu.test(context) ||
    status >= 500
  ) {
    return { category: 'transport', retryable: true, stopDomain: false };
  }
  return { category: 'transient', retryable: true, stopDomain: false };
}

export class DomainScheduler {
  constructor({
    delay = cancellableDelay,
    maxAttempts = 2,
    maxBackoffMs,
    maxCooldownMs = 60 * 60 * 1000,
    maxConcurrentDomains = 3,
    maxDelayMs = 0,
    maxRequestsPerDomain = 500,
    minDelayMs = 0,
    now = Date.now,
    random = Math.random,
    retryCooldownMs = 30_000,
    store,
  } = {}) {
    this.activeDomains = 0;
    this.delay = delay;
    this.domainTails = new Map();
    this.domainRequests = new Map();
    this.domainStates = new Map();
    this.maxAttempts = maxAttempts;
    this.maxBackoffMs = maxBackoffMs ?? Math.max(maxDelayMs, minDelayMs) * 4;
    this.maxCooldownMs = maxCooldownMs;
    this.maxConcurrentDomains = maxConcurrentDomains;
    this.maxDelayMs = maxDelayMs;
    this.maxRequestsPerDomain = maxRequestsPerDomain;
    this.minDelayMs = minDelayMs;
    this.now = now;
    this.random = random;
    this.retryCooldownMs = retryCooldownMs;
    this.stoppedDomains = new Set();
    this.store = store;
    this.waiters = [];
  }

  async #loadDomainState(domain) {
    if (this.domainStates.has(domain)) {
      return this.domainStates.get(domain);
    }
    const records =
      (await this.store?.loadRecords?.('browser-domain-cooldown')) || [];
    const state = records.find(
      (record) => record.id === domain || record.domain === domain
    ) || { blockedUntil: 0, consecutiveFailures: 0, domain, id: domain };
    this.domainStates.set(domain, state);
    return state;
  }

  async #saveDomainState(state) {
    this.domainStates.set(state.domain, state);
    if (this.store?.updateRecords) {
      await this.store.updateRecords('browser-domain-cooldown', (records) => [
        ...records.filter(
          (record) => record.id !== state.id && record.domain !== state.domain
        ),
        state,
      ]);
      return;
    }
    if (this.store?.saveRecords) {
      const records =
        (await this.store.loadRecords?.('browser-domain-cooldown')) || [];
      await this.store.saveRecords('browser-domain-cooldown', [
        ...records.filter(
          (record) => record.id !== state.id && record.domain !== state.domain
        ),
        state,
      ]);
    }
  }

  async #recordFailure(domain, error) {
    const policy = classifyBrowserFailure(error);
    if (!policy.retryable && !policy.stopDomain) {
      return policy;
    }
    const previous = await this.#loadDomainState(domain);
    const consecutiveFailures = previous.consecutiveFailures + 1;
    const requested = Number(error?.retryAfterMs);
    const exponential = this.retryCooldownMs * 2 ** (consecutiveFailures - 1);
    const cooldownMs = Math.min(
      this.maxCooldownMs,
      Number.isFinite(requested) && requested > 0 ? requested : exponential
    );
    await this.#saveDomainState({
      blockedUntil: this.now() + cooldownMs,
      category: policy.category,
      consecutiveFailures,
      domain,
      id: domain,
      schemaVersion: 1,
    });
    if (policy.stopDomain) {
      this.stoppedDomains.add(domain);
    }
    return policy;
  }

  async #acquireDomainSlot() {
    if (this.activeDomains >= this.maxConcurrentDomains) {
      const waiter = deferred();
      this.waiters.push(waiter.resolve);
      await waiter.promise;
    }
    this.activeDomains += 1;
  }

  #releaseDomainSlot() {
    this.activeDomains -= 1;
    this.waiters.shift()?.();
  }

  run(url, operation, { signal } = {}) {
    const domain = new globalThis.URL(url).hostname.toLocaleLowerCase('en');
    const previous = this.domainTails.get(domain) || Promise.resolve();
    const current = previous
      .catch(() => {})
      // eslint-disable-next-line complexity -- The serialized run owns cancellation, cooldown, budget, retry, and cleanup boundaries.
      .then(async () => {
        if (signal?.aborted) {
          throw signal.reason || new Error('Browser collection cancelled.');
        }
        await this.#acquireDomainSlot();
        try {
          if (this.stoppedDomains.has(domain)) {
            const error = new Error(
              `Browser domain stopped after a challenge: ${domain}.`
            );
            error.code = 'BROWSER_DOMAIN_CHALLENGED';
            throw error;
          }
          const state = await this.#loadDomainState(domain);
          const cooldown = Math.max(0, state.blockedUntil - this.now());
          if (cooldown > 0) {
            await this.delay(cooldown, { signal });
          }
          let lastError;
          for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            const requests = (this.domainRequests.get(domain) || 0) + 1;
            if (requests > this.maxRequestsPerDomain) {
              const error = new Error(
                `Browser request budget exhausted for ${domain}.`
              );
              error.code = 'BROWSER_DOMAIN_BUDGET_EXHAUSTED';
              throw error;
            }
            this.domainRequests.set(domain, requests);
            const spread = Math.max(0, this.maxDelayMs - this.minDelayMs);
            const jitter = this.minDelayMs + Math.round(this.random() * spread);
            const wait = Math.min(
              this.maxBackoffMs,
              jitter * 2 ** (attempt - 1)
            );
            if (wait > 0) {
              await this.delay(wait, { signal });
            }
            if (signal?.aborted) {
              throw signal.reason || new Error('Browser collection cancelled.');
            }
            try {
              const result = await operation({ attempt });
              if (
                (this.domainStates.get(domain)?.consecutiveFailures || 0) > 0
              ) {
                await this.#saveDomainState({
                  blockedUntil: 0,
                  consecutiveFailures: 0,
                  domain,
                  id: domain,
                  schemaVersion: 1,
                });
              }
              return result;
            } catch (error) {
              lastError = error;
              const policy = await this.#recordFailure(domain, error);
              if (!policy.retryable) {
                throw error;
              }
            }
          }
          throw lastError;
        } finally {
          this.#releaseDomainSlot();
        }
      });
    this.domainTails.set(domain, current);
    const releaseTail = () => {
      if (this.domainTails.get(domain) === current) {
        this.domainTails.delete(domain);
      }
    };
    void current.then(releaseTail, releaseTail);
    return current;
  }
}

function adapter(id, domains, searchPath) {
  return {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: `${id}-rental-v1`,
    domains,
    searchPath,
    selectors: {
      cards:
        '[data-testid="property-card"], [data-testid="card-container"], article, .property-card, [itemtype*="Hotel"]',
      details: 'main, article, [itemtype*="Accommodation"]',
    },
    capabilities: [
      'search',
      'redirect-validation',
      'result-cards',
      'listing-details',
      'stable-identity',
      'location',
      'price-period',
      'rooms-beds',
      'contacts',
      'media',
      'availability',
      'official-links',
    ],
    enabled: true,
  };
}

export const BROWSER_SOURCE_ADAPTERS = Object.freeze({
  agoda: adapter('agoda', ['agoda.com'], '/search'),
  airbnb: adapter('airbnb', ['airbnb.com'], '/s/'),
  batdongsan: adapter('batdongsan', ['batdongsan.com.vn'], '/nha-dat-cho-thue'),
  booking: adapter('booking', ['booking.com'], '/searchresults'),
  chotot: {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'chotot-rental-v1',
    domains: ['chotot.com'],
    searchPath: '/mua-ban-bat-dong-san',
    enabled: false,
    reason: 'sale-route-disabled-until-a-validated-rental-route-is-reviewed',
  },
  expedia: adapter('expedia', ['expedia.com'], '/Hotel-Search'),
  generic: {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'generic-rental-v1',
    enabled: true,
  },
  'google-hotels': adapter('google-hotels', ['google.com'], '/travel/'),
  'hotel-mix': adapter('hotel-mix', ['hotelmix.vn'], '/search'),
  hotels: adapter('hotels', ['hotels.com'], '/Hotel-Search'),
  hostelworld: adapter('hostelworld', ['hostelworld.com'], '/st/hostels/'),
  ivivu: adapter('ivivu', ['ivivu.com'], '/khach-san-'),
  kayak: adapter('kayak', ['kayak.com'], '/hotels/'),
  klook: adapter('klook', ['klook.com'], '/hotels/'),
  mytour: adapter('mytour', ['mytour.vn'], '/khach-san'),
  skyscanner: adapter('skyscanner', ['skyscanner.com'], '/hotels/'),
  traveloka: adapter('traveloka', ['traveloka.com'], '/hotel/search'),
  trip: adapter('trip', ['trip.com'], '/hotels/list'),
  tripadvisor: adapter('tripadvisor', ['tripadvisor.com'], '/Search'),
  trivago: adapter('trivago', ['trivago.com'], '/srl/'),
  vntrip: adapter('vntrip', ['vntrip.vn'], '/khach-san'),
  vrbo: adapter('vrbo', ['vrbo.com'], '/searchResults'),
});

export function browserAdapterFor(value) {
  let hostname;
  try {
    hostname = new globalThis.URL(value).hostname.replace(/^www\./u, '');
  } catch {
    return BROWSER_SOURCE_ADAPTERS.generic;
  }
  return (
    Object.values(BROWSER_SOURCE_ADAPTERS).find(({ domains }) =>
      domains?.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      )
    ) || BROWSER_SOURCE_ADAPTERS.generic
  );
}
