export const BROWSER_ADAPTER_SCHEMA_VERSION = 2;

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

// Settles with `operation`, or rejects with the signal reason as soon as the
// signal aborts, so work that ignores its signal cannot hold the caller.
export async function untilAborted(operation, signal) {
  const pending = Promise.resolve(operation);
  pending.catch(() => {});
  if (signal.aborted) {
    throw signal.reason;
  }
  let listener;
  const aborted = new Promise((_resolve, reject) => {
    listener = () => reject(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener('abort', listener);
  }
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
      (await this.store?.loadRecords?.('browser-domain-cooldowns')) || [];
    const state = records.find(
      (record) => record.id === domain || record.domain === domain
    ) || { blockedUntil: 0, consecutiveFailures: 0, domain, id: domain };
    this.domainStates.set(domain, state);
    return state;
  }

  async #saveDomainState(state) {
    this.domainStates.set(state.domain, state);
    if (this.store?.updateRecords) {
      await this.store.updateRecords('browser-domain-cooldowns', (records) => [
        ...records.filter(
          (record) => record.id !== state.id && record.domain !== state.domain
        ),
        state,
      ]);
      return;
    }
    if (this.store?.saveRecords) {
      const records =
        (await this.store.loadRecords?.('browser-domain-cooldowns')) || [];
      await this.store.saveRecords('browser-domain-cooldowns', [
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
    const work = previous
      .catch(() => {})
      // eslint-disable-next-line complexity -- The serialized run owns cancellation, cooldown, budget, retry, and cleanup boundaries.
      .then(async () => {
        if (signal?.aborted) {
          throw signal.reason || new Error('Browser collection cancelled.');
        }
        await this.#acquireDomainSlot();
        try {
          const state = await this.#loadDomainState(domain);
          const cooldown = Math.max(0, state.blockedUntil - this.now());
          if (this.stoppedDomains.has(domain)) {
            if (cooldown > 0) {
              const error = new Error(
                `Browser domain stopped after a challenge: ${domain}.`
              );
              error.code = 'BROWSER_DOMAIN_CHALLENGED';
              error.retryAfterMs = cooldown;
              throw error;
            }
            this.stoppedDomains.delete(domain);
          }
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
    // Later requests to the domain wait for this one's turn to settle, but
    // the caller stops waiting as soon as its own signal aborts.
    this.domainTails.set(domain, work);
    const releaseTail = () => {
      if (this.domainTails.get(domain) === work) {
        this.domainTails.delete(domain);
      }
    };
    void work.then(releaseTail, releaseTail);
    return signal ? untilAborted(work, signal) : work;
  }
}

const DEFAULT_CARD_SELECTORS = {
  cards:
    '[data-testid="property-card"], [data-testid="card-container"], article, .property-card, [itemtype*="Hotel"]',
  details: 'main, article, [itemtype*="Accommodation"]',
  fields: {
    availability:
      '[itemprop="availability"], [data-testid*="availability"], [class*="availability"], [class*="status"]',
    bathrooms:
      '[data-testid*="bath"], [class*="bath"], [itemprop="numberOfBathroomsTotal"]',
    bedrooms:
      '[data-testid*="bed"], [class*="bed"], [itemprop="numberOfBedrooms"]',
    contact:
      '[href^="tel:"], [href^="mailto:"], [href*="t.me/"], [class*="contact"]',
    description:
      '[itemprop="description"], [data-testid*="description"], [class*="description"]',
    location:
      '[itemprop="address"], [data-testid*="location"], [class*="location"], [class*="address"]',
    price: '[itemprop="price"], [data-testid*="price"], [class*="price"]',
  },
  identityAttributes: [
    'data-hotelid',
    'data-property-id',
    'data-listing-id',
    'pr-id',
    'id',
  ],
  link: 'a[href]',
  media: 'img[src], [style*="background-image"]',
  title: 'h1, h2, h3, h4, h5, [data-testid="title"], [itemprop="name"]',
};

function adapter(id, domains, searchPath, selectors = {}) {
  return {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: `${id}-rental-v1`,
    domains,
    searchPath,
    selectors: {
      ...DEFAULT_CARD_SELECTORS,
      ...selectors,
      fields: {
        ...DEFAULT_CARD_SELECTORS.fields,
        ...(selectors.fields || {}),
      },
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
      'semantic-segment-accounting',
    ],
    enabled: true,
  };
}

export const BROWSER_SOURCE_ADAPTERS = Object.freeze({
  agoda: adapter('agoda', ['agoda.com'], '/search'),
  airbnb: adapter('airbnb', ['airbnb.com'], '/s/'),
  alonhadat: adapter(
    'alonhadat',
    ['alonhadat.com.vn'],
    '/cho-thue-nha/khanh-hoa/nha-trang',
    {
      cards: '.property-item',
      details: '[itemtype="https://schema.org/RealEstateListing"], main',
      fields: {
        availability: '[itemprop="availability"]',
        bathrooms: '.toilet, [itemprop="numberOfBathroomsTotal"]',
        bedrooms: '.bedroom, [itemprop="numberOfBedrooms"]',
        contact: '.contact-info',
        description: '.brief, [itemprop="description"]',
        location: '.property-address, [itemprop="address"]',
        metadata: '.created-date, .property-details',
        price: '.price, [itemprop="price"]',
      },
      link: 'a.link[href]',
      media: '.thumbnail img[src], [itemprop="image"]',
      title: '.property-title, [itemprop="name"]',
    }
  ),
  batdongsan: {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'batdongsan-rental-v1',
    domains: ['batdongsan.com.vn'],
    searchPath: '/nha-dat-cho-thue',
    enabled: false,
    reason: 'rental-route-disabled-after-access-challenge',
  },
  booking: adapter('booking', ['booking.com'], '/searchresults'),
  'be-jib': adapter('be-jib', ['be-jib.com'], '/ru/nha-trang/rentals', {
    cards: '.bj-listing-card[data-listing-id]',
    details: 'main, .bj-listing-detail, article',
    fields: {
      availability:
        '.bj-listing-card__status, .bj-listing-card__sold-stamp, [class*="status"]',
      bathrooms: '[class*="bath"], [data-field="bathrooms"]',
      bedrooms: '.bj-listing-card__facts, [data-field="bedrooms"]',
      contact: '[href^="tel:"], [href*="t.me/"]',
      description: '.bj-listing-card__summary, [class*="description"]',
      location: '.bj-listing-card__area, [class*="address"]',
      metadata:
        '.bj-listing-card__facts, .bj-listing-card__pill, .bj-listing-card__type',
      price:
        '.bj-listing-card__price-row, .bj-listing-card__price-aux, [class*="price"]',
    },
    identityAttributes: ['data-listing-id'],
    link: 'a[href*="/listings/"]',
    media: '.bj-listing-card__media img[src]',
    title: '.bj-listing-card__title',
  }),
  chotot: {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'nhatot-rental-v2',
    domains: ['nhatot.com', 'chotot.com'],
    searchPath: '/thue-bat-dong-san',
    enabled: false,
    reason: 'rental-route-disabled-after-access-challenge',
  },
  'dot-property': {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'dot-property-rental-v1',
    domains: ['dotproperty.com.vn'],
    enabled: false,
    reason: 'rental-route-disabled-after-access-challenge',
  },
  icekem: adapter('icekem', ['icekem.com'], '/ru/s/rent-nhatrang', {
    availabilityFallback: 'not stated on source card',
    cards: 'article.listing-card[pr-id]',
    details: 'main, article.listing-card',
    fields: {
      availability: '.sr-content',
      bedrooms: '.sr-title',
      contact: '.listing-meta .sr-user, .listing-actions',
      description: '.sr-content',
      location: '.listing-geo',
      metadata: '.sr-title-meta, .listing-badge, .pr-brand-new-chip, .sr-date',
      price: '.sr-price',
    },
    identityAttributes: ['pr-id'],
    link: 'a.sr-title[href]',
    media: '.listing-photo img[src]',
    title: 'a.sr-title',
  }),
  expedia: adapter('expedia', ['expedia.com'], '/Hotel-Search'),
  generic: {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'generic-rental-v1',
    enabled: true,
  },
  'google-hotels': adapter('google-hotels', ['google.com'], '/travel/'),
  'hotel-mix': adapter('hotel-mix', ['hotelmix.vn'], '/search'),
  homedy: adapter(
    'homedy',
    ['homedy.com'],
    '/cho-thue-can-ho-thanh-pho-nha-trang-khanh-hoa',
    {
      availabilityFallback: 'not stated on source card',
      cards: '.product-item',
      fields: {
        area: '.product-unit .acreage',
        contact: 'a[href^="tel:"], a[href^="mailto:"]',
        description: '.description',
        location: '.product-unit .address',
        metadata: '.product-item-top .distance, .box-price-agency, .time',
        price: '.product-unit .price',
        rooms: 'a.title',
      },
      link: 'a.title[href]',
      media: 'img.lazy',
      title: 'a.title',
    }
  ),
  hotels: adapter('hotels', ['hotels.com'], '/Hotel-Search'),
  hostelworld: adapter('hostelworld', ['hostelworld.com'], '/st/hostels/'),
  ivivu: adapter('ivivu', ['ivivu.com'], '/khach-san-'),
  kayak: adapter('kayak', ['kayak.com'], '/hotels/'),
  klook: adapter('klook', ['klook.com'], '/hotels/'),
  mytour: adapter('mytour', ['mytour.vn'], '/khach-san'),
  newhome: adapter('newhome', ['newhomenhatrang.com'], '/', {
    cards: '.feat_property',
    fields: {
      area: '.prop_details li:nth-child(3) .text-thm3',
      author: '.fp_meta',
      availability: '.tag-stock',
      bathrooms: '.prop_details li:nth-child(2) .text-thm3',
      bedrooms: '.prop_details li:first-child .text-thm3',
      contact: 'a[href^="tel:"], a[href^="mailto:"]',
      flags: '.icon',
      listedPrice: '.fp_price',
      location: '.text-thm',
      posted: '.fp_pdate',
      price: '.tc_content h4',
      type: '.tag-housing-type',
    },
    link: 'a.thumb[href]',
    media: 'a.thumb img[src]',
    title: '.tc_content h4',
  }),
  'nha-trang-renting': adapter(
    'nha-trang-renting',
    ['nhatrangrenting.com'],
    '/estate-contract/for-rent/',
    {
      cards: '.property-container.property-container-grid',
      details: 'main, article, .properties-single',
      fields: {
        availability:
          '.property-photo-tag-rental, .agenta_stamp_rubber, [class*="status"]',
        bathrooms: '.label_bath',
        bedrooms: '.label_bed',
        contact: '.contact-card-container',
        description: '.property-hover-txt, [class*="description"]',
        location: '.property-hover-txt li:first-child, [class*="address"]',
        metadata: '.property-hover-txt, .property-details',
        price: '.property-details, [class*="price"]',
      },
      link: 'h5 a[href], a.property-photo[href]',
      media: 'a.property-photo[style*="background-image"], img[src]',
      title: 'h5',
    }
  ),
  'nha-trang-vn': adapter('nha-trang-vn', ['nha-trang.vn'], '/en/rentals', {
    availabilityFallback: 'not stated on source card',
    cards: 'a[href*="/en/rentals/"]',
    fields: {
      contact: 'a[href^="tel:"], a[href^="mailto:"]',
      location: 'span.truncate',
      metadata: '.absolute.top-2.left-2, .mt-2, .mt-3',
      price: '.text-primary',
      rooms: '.line-clamp-2',
    },
    link: 'a[href*="/en/rentals/"]',
    locationFallback: 'Nha Trang',
    media: 'img[src]',
    title: '.line-clamp-2',
  }),
  nhatrangland: adapter(
    'nhatrangland',
    ['nhatrangland.org'],
    '/cho-thue/can-ho',
    {
      availabilityFallback: 'not stated on source card',
      cards: '.ui-commercial-card[data-commercial-card="rental"]',
      fields: {
        contact: 'a[href^="tel:"], a[href^="mailto:"]',
        location: '.ui-commercial-meta',
        metadata: '.ui-commercial-badge, .ui-commercial-meta',
        price: '.ui-commercial-price',
        rooms: '.ui-commercial-title',
      },
      link: 'a.ui-commercial-card[href]',
      media: '.ui-commercial-media img[src]',
      title: '.ui-commercial-title',
    }
  ),
  vietdom: {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'vietdom-rental-v1',
    domains: ['vietdom.com'],
    enabled: false,
    reason: 'rental-route-disabled-after-incomplete-semantics',
  },
  yourhome: adapter('yourhome', ['yourhomenhatrang.com'], '/can-ho', {
    availabilityFallback: 'not stated on source card',
    cards: 'article',
    fields: {
      contact: 'a[href^="tel:"], a[href^="mailto:"]',
      location: 'span.line-clamp-1',
      metadata:
        'span.absolute.top-2.left-2, div.absolute.bottom-2.left-2, span.text-slate-500, div.flex.items-center.gap-2',
      price: 'span.font-extrabold',
      rooms: 'h3',
    },
    link: 'a[href*="/cho-thue-"]',
    locationFallback: 'Nha Trang',
    media: 'img[src]',
    title: 'h3',
  }),
  xmetr: {
    schemaVersion: BROWSER_ADAPTER_SCHEMA_VERSION,
    id: 'xmetr-rental-v1',
    domains: ['xmetr.com'],
    enabled: false,
    reason: 'rental-route-disabled-after-access-challenge',
  },
  'vietnam-real-estate': adapter(
    'vietnam-real-estate',
    ['vietnam-real.estate'],
    '/ru/rent/',
    {
      availabilityFallback: 'not stated on source card',
      cards:
        '.catalogy__items-blocks > .good-item, .objects-list ul > li[data-object]',
      detailCards: '.object',
      detailPath: '/(?:ru/)?property/',
      searchLocationTerms: ['Нячанг', 'Nha Trang'],
      details: '.object, .object-page',
      fields: {
        area: '.tag:has(.ruler), .object-bottom__badges .badge-decor:has(.ruler)',
        bathrooms:
          '.params .bathrooms, .tag:has(.bath), .object-bottom__badges .badge-decor:has(.bath)',
        bedrooms:
          '.params .bedrooms, .tag:has(.bed), .object-bottom__badges .badge-decor:has(.bed)',
        contact:
          '.links, a[href^="tel:"], a[href^="mailto:"], a[href*="t.me/"]:not([href*="/share/"])',
        description: '.excerpt, .good-item__text, .object-bottom__description',
        location: '.title, .good-item__desc, .object-bottom h1',
        metadata:
          '.params, .good-item__tags, .list-info, .object-bottom__badges',
        price:
          '.good-item__top--rental, .good-item__content > .price, .price__top, .price__block > p.medium-font, .objects-list .price',
      },
      identityAttributes: ['data-object'],
      link: '.good-item__desc[href], .title a[href]',
      media:
        '.image img[src], .good-item__img img, .gallery-simple__img-box img',
      title: '.title, .good-item__desc, .object-bottom h1',
    }
  ),
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
