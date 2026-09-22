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

export class DomainScheduler {
  constructor({
    delay = cancellableDelay,
    maxAttempts = 2,
    maxBackoffMs,
    maxConcurrentDomains = 3,
    maxDelayMs = 0,
    maxRequestsPerDomain = 500,
    minDelayMs = 0,
    random = Math.random,
  } = {}) {
    this.activeDomains = 0;
    this.delay = delay;
    this.domainTails = new Map();
    this.domainRequests = new Map();
    this.maxAttempts = maxAttempts;
    this.maxBackoffMs = maxBackoffMs ?? Math.max(maxDelayMs, minDelayMs) * 4;
    this.maxConcurrentDomains = maxConcurrentDomains;
    this.maxDelayMs = maxDelayMs;
    this.maxRequestsPerDomain = maxRequestsPerDomain;
    this.minDelayMs = minDelayMs;
    this.random = random;
    this.waiters = [];
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
      .then(async () => {
        if (signal?.aborted) {
          throw signal.reason || new Error('Browser collection cancelled.');
        }
        await this.#acquireDomainSlot();
        try {
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
              return await operation({ attempt });
            } catch (error) {
              lastError = error;
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
