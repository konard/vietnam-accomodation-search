import { normalizeOffer } from './offers.js';
import { parseTelegramOffer } from './telegram-parser.js';
import { classifyTelegramPost } from './telegram-pipeline.js';
import { TraceRecorder } from './trace.js';
import { settleCleanup } from './utils.js';
import {
  DomainScheduler,
  PAGE_CLASSIFICATIONS,
  browserAdapterFor,
  classifyListingPage,
} from './browser-adapters.js';

export function buildSearchUrl(source, query = '') {
  return source.searchUrl.replaceAll('{query}', encodeURIComponent(query));
}

export function loadDefaultBrowserRuntime() {
  return import('browser-commander');
}

// eslint-disable-next-line max-lines-per-function -- This self-contained function executes in the isolated browser page realm.
export function extractPageListings(sourceType, selectors = {}) {
  const documentRef = globalThis.document;
  if (sourceType === 'telegram') {
    return [...documentRef.querySelectorAll('.tgme_widget_message')]
      .slice(-100)
      .map((element) => {
        const link = element.querySelector('.tgme_widget_message_date')?.href;
        const time = element.querySelector('time')?.dateTime;
        return {
          date: time,
          photos: [
            ...element.querySelectorAll('a.tgme_widget_message_photo_wrap'),
          ]
            .map(
              (photo) =>
                photo.style.backgroundImage.match(
                  /url\(["']?(.*?)["']?\)/u
                )?.[1]
            )
            .filter(Boolean),
          text:
            element.querySelector('.tgme_widget_message_text')?.innerText || '',
          url: link,
        };
      });
  }

  // Keep these helpers inside the evaluated function. Browser Commander sends
  // the function into the page realm, where module-scope closures do not exist.
  const selectedText = (element, selector) => {
    if (!selector) {
      return undefined;
    }
    const selected = [...element.querySelectorAll(selector)];
    if (!selected.length) {
      const fallback = element.querySelector(selector);
      if (fallback) {
        selected.push(fallback);
      }
    }
    const values = selected
      .map(
        (entry) =>
          entry?.innerText ||
          entry?.textContent ||
          entry?.content ||
          entry?.getAttribute?.('content') ||
          entry?.getAttribute?.('href') ||
          entry?.getAttribute?.('aria-label')
      )
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim());
    return values.length ? [...new Set(values)].join('\n') : undefined;
  };
  const numericSemantic = (value) => {
    const match = String(value || '').match(/\d+(?:[.,]\d+)?/u)?.[0];
    const result = Number(match?.replace(',', '.'));
    return Number.isFinite(result) ? result : undefined;
  };
  const backgroundImage = (element) =>
    element?.style?.backgroundImage?.match(/url\(["']?(.*?)["']?\)/u)?.[1] ||
    element
      ?.getAttribute?.('style')
      ?.match(/background-image\s*:\s*url\(["']?(.*?)["']?\)/iu)?.[1];
  const availabilityState = (value) => {
    if (/\bsold\b|rented\s*out|сдано|недоступ|đã\s*thuê/iu.test(value || '')) {
      return false;
    }
    if (
      /for\s*rent|available|in\s*stock|свобод|доступ|сда[её]т|cho\s*thuê|còn\s*trống/iu.test(
        value || ''
      )
    ) {
      return true;
    }
    return undefined;
  };
  const pageIdentity = (element, anchor) => {
    for (const attribute of selectors.identityAttributes || []) {
      const value = element.getAttribute(attribute);
      if (value) {
        return value;
      }
    }
    const context = `${anchor?.href || ''}\n${element.innerText || ''}`;
    return (
      anchor?.href.match(
        /(?:\/rooms\/|[?&](?:hotel|property|listing)_id=)([\p{L}\d_-]{1,64})/iu
      )?.[1] ||
      context.match(
        /(?:\bID|\bpr-|\btg-|\bproperty[-_/]|\blisting[-_/]|\.html\D{0,8})([\p{L}\d_-]{2,64})/iu
      )?.[1]
    );
  };
  const accountedSegments = (element, semantic, title) => {
    const normalized = (value) =>
      String(value || '')
        .replace(/\s+/gu, ' ')
        .trim();
    const recognized = Object.entries({ title, ...semantic }).flatMap(
      ([category, value]) =>
        String(value || '')
          .split(/\r?\n/u)
          .map((line) => [category, normalized(line)])
          .filter(([, line]) => line.length >= 1)
    );
    return String(element.innerText || '')
      .split(/\r?\n/u)
      .map(normalized)
      .filter((line) => /[\p{L}\p{N}]/u.test(line))
      .map((text) => ({
        category:
          recognized.find(
            ([, value]) =>
              value === text || value.includes(text) || text.includes(value)
          )?.[0] || 'unknown',
        text,
      }));
  };

  const cards = [
    ...documentRef.querySelectorAll(
      selectors.cards ||
        '[data-testid="property-card"], [data-testid="card-container"], article, .property-card, [itemtype*="Hotel"]'
    ),
  ]
    .filter(
      (element) =>
        !selectors.locationTerms?.length ||
        selectors.locationTerms.some((term) =>
          String(selectedText(element, selectors.fields?.location) || '')
            .toLocaleLowerCase('en')
            .includes(term.toLocaleLowerCase('en'))
        )
    )
    .slice(0, 100);
  return cards.map((element) => {
    const anchor = element.querySelector(selectors.link || 'a[href]');
    const officialAnchor = element.querySelector(
      '[data-official-site][href], a[rel~="external"][href]'
    );
    const titleElement = element.querySelector(
      selectors.title || 'h1, h2, h3, [data-testid="title"], [itemprop="name"]'
    );
    const semantic = Object.fromEntries(
      Object.entries(selectors.fields || {})
        .map(([field, selector]) => [field, selectedText(element, selector)])
        .filter(([, value]) => value !== undefined)
    );
    if (!semantic.availability && selectors.availabilityFallback) {
      semantic.availability = selectors.availabilityFallback;
    }
    const title = titleElement?.textContent?.trim();
    const propertyId = pageIdentity(element, anchor);
    const bedrooms = numericSemantic(semantic.bedrooms);
    const bathrooms = numericSemantic(semantic.bathrooms);
    const areaM2 = numericSemantic(semantic.area);
    const availableNow = availabilityState(semantic.availability);
    const attributes = Object.fromEntries(
      Object.entries({
        areaM2,
        availableNow,
        bathrooms,
        bedrooms,
        propertyId,
      }).filter(([, value]) => value !== undefined)
    );
    const semanticText = Object.entries(semantic)
      .map(([field, value]) => `${field}: ${value}`)
      .join('\n');
    return {
      attributes: Object.keys(attributes).length ? attributes : undefined,
      photos: [...element.querySelectorAll(selectors.media || 'img[src]')]
        .map((image) => image.currentSrc || image.src || backgroundImage(image))
        .filter(Boolean),
      semantic,
      segments: accountedSegments(element, semantic, title),
      text: [element.innerText, semanticText].filter(Boolean).join('\n'),
      title,
      url: anchor?.href,
      officialUrl: officialAnchor?.href,
      ...(semantic.location ? { location: semantic.location } : {}),
    };
  });
}

function extractOfficialListing() {
  const documentRef = globalThis.document;
  const metaImage = documentRef.querySelector(
    'meta[property="og:image"], meta[name="twitter:image"]'
  )?.content;
  return {
    photos: [
      metaImage,
      ...[...documentRef.querySelectorAll('main img[src], article img[src]')]
        .slice(0, 10)
        .map((image) => image.currentSrc || image.src),
    ].filter(Boolean),
    text: documentRef.body?.innerText || '',
    title:
      documentRef.querySelector('h1')?.textContent?.trim() || documentRef.title,
  };
}

function extractPageState() {
  const documentRef = globalThis.document;
  return {
    status: 200,
    title: documentRef?.title || '',
    url: documentRef?.location?.href || globalThis.location?.href || '',
  };
}

export class BrowserPageError extends Error {
  constructor(classification, url) {
    super(`Browser page rejected as ${classification}: ${url}`);
    this.code = `BROWSER_PAGE_${classification.toLocaleUpperCase('en').replaceAll('-', '_')}`;
    this.classification = classification;
    this.url = url;
  }
}

function telegramMessage(item, source) {
  const messageId = item.url?.match(/\/(\d+)(?:\?.*)?$/u)?.[1];
  const username = source.url.match(/t\.me\/(?:s\/)?([^/?]+)/u)?.[1];
  return {
    ...item,
    chat: { title: source.name, username },
    date: item.date,
    ...(source.location || source.focus === 'nha-trang'
      ? {
          inheritedLocation: source.location || 'Nha Trang, Vietnam',
          inheritedLocationSource: source.id,
        }
      : {}),
    messageId,
    sourceId: source.id,
  };
}

function messageId(row) {
  const value = row.url?.match(/\/(\d+)(?:\?.*)?$/u)?.[1];
  return value ? Number(value) : undefined;
}

function cutoffDate(now) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  return cutoff;
}

function beforeUrl(url, id) {
  const parsed = new globalThis.URL(url);
  parsed.searchParams.set('before', String(id));
  return parsed.toString();
}

function privateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

function safeOfficialUrl(value) {
  try {
    const url = new globalThis.URL(value);
    const hostname = url.hostname.toLocaleLowerCase('en');
    const bareHostname = hostname.replace(/^\[|\]$/gu, '');
    return (
      /^https?:$/u.test(url.protocol) &&
      !url.username &&
      !url.password &&
      hostname !== 'localhost' &&
      !hostname.endsWith('.localhost') &&
      !hostname.endsWith('.local') &&
      !privateIpv4(hostname) &&
      !/^(?:::$|::1$|::ffff:|f[cd]|fe[89ab]|ff)/u.test(bareHostname)
    );
  } catch {
    return false;
  }
}

export class BrowserCollector {
  constructor({
    browserLaunchOptions,
    browserRuntime,
    logger,
    maxTelegramPages = 200,
    now,
    rateProvider,
    rates,
    scheduler,
    store,
    traceRecorder,
  } = {}) {
    this.browserLaunchOptions = browserLaunchOptions || {};
    this.browserRuntime = browserRuntime;
    this.logger = logger || { debug: () => {} };
    this.maxTelegramPages = maxTelegramPages;
    this.now = now || (() => new Date());
    this.rateProvider = rateProvider;
    this.rates = rates || { VND: 1 };
    this.scheduler = scheduler || new DomainScheduler();
    this.trace =
      traceRecorder || new TraceRecorder({ maxEvents: 2_000, now, store });
  }

  async navigate(commander, url, { signal } = {}) {
    await this.scheduler.run(
      url,
      () => commander.goto({ url, waitForNetworkIdle: false }),
      { signal }
    );
  }

  collectListingRows(
    commander,
    url,
    sourceType,
    adapter,
    { expectedLocation, signal } = {}
  ) {
    return this.scheduler.run(
      url,
      async () => {
        await commander.goto({ url, waitForNetworkIdle: false });
        const rows =
          (await commander.evaluate(
            extractPageListings,
            sourceType,
            adapter.selectors
          )) || [];
        await this.assertListingPage(commander, url, rows.length, {
          expectedLocation,
        });
        return rows;
      },
      { signal }
    );
  }

  async assertListingPage(commander, url, cards, { expectedLocation } = {}) {
    const extracted = await commander.evaluate(extractPageState);
    const state = Array.isArray(extracted) ? {} : extracted || {};
    const classification = classifyListingPage({
      cards,
      ...state,
      expectedLocation,
      url: state.url || url,
    });
    if (
      [
        PAGE_CLASSIFICATIONS.CHALLENGE,
        PAGE_CLASSIFICATIONS.CONSENT,
        PAGE_CLASSIFICATIONS.EMPTY,
        PAGE_CLASSIFICATIONS.LANDING,
        PAGE_CLASSIFICATIONS.LOGIN,
        PAGE_CLASSIFICATIONS.SALE,
        PAGE_CLASSIFICATIONS.SELECTOR_DRIFT,
        PAGE_CLASSIFICATIONS.WRONG_LOCATION,
      ].includes(classification)
    ) {
      throw new BrowserPageError(classification, state.url || url);
    }
    return classification;
  }

  async collectTelegramRows(commander, source, query, { signal } = {}) {
    const firstUrl = buildSearchUrl(source, query);
    const rowsByUrl = new Map();
    const visited = new Set();
    const cutoff = cutoffDate(this.now());
    let url = firstUrl;

    for (
      let page = 0;
      page < this.maxTelegramPages && !visited.has(url);
      page += 1
    ) {
      visited.add(url);
      await this.navigate(commander, url, { signal });
      const rows =
        (await commander.evaluate(extractPageListings, 'telegram')) || [];
      for (const row of rows) {
        const key = row.url || `${row.date || ''}\n${row.text || ''}`;
        rowsByUrl.set(key, row);
      }
      if (!rows.length) {
        break;
      }

      const dates = rows
        .map((row) => new Date(row.date))
        .filter((date) => Number.isFinite(date.getTime()));
      if (dates.some((date) => date <= cutoff)) {
        break;
      }
      const ids = rows.map(messageId).filter(Number.isFinite);
      if (!ids.length) {
        break;
      }
      const nextUrl = beforeUrl(firstUrl, Math.min(...ids));
      if (visited.has(nextUrl)) {
        throw new BrowserPageError(
          PAGE_CLASSIFICATIONS.NAVIGATION_LOOP,
          nextUrl
        );
      }
      url = nextUrl;
    }
    return [...rowsByUrl.values()];
  }

  // eslint-disable-next-line complexity -- Source collection keeps transport, paging, and parser failure boundaries together.
  async collectSource(commander, source, query, rates, { signal } = {}) {
    const requestedUrl = buildSearchUrl(source, query);
    const adapter = browserAdapterFor(requestedUrl);
    if (!adapter.enabled) {
      throw new BrowserPageError('disabled-adapter', requestedUrl);
    }
    let rows;
    if (source.type === 'telegram') {
      rows = await this.collectTelegramRows(commander, source, query, {
        signal,
      });
    } else {
      const url = requestedUrl;
      rows = await this.collectListingRows(
        commander,
        url,
        source.type,
        adapter,
        {
          expectedLocation: /nha\s*trang|nhatrang|нячанг/iu.test(query)
            ? 'nha-trang'
            : undefined,
          signal,
        }
      );
    }
    const offers = [];

    for (const row of rows || []) {
      if (row.attributes?.availableNow === false) {
        continue;
      }
      const raw = { ...row };
      if (source.type === 'telegram') {
        const relevance = classifyTelegramPost(row.text, {
          targetLocation: source.focus === 'nha-trang' ? 'nha-trang' : null,
        });
        if (!relevance.eligible) {
          continue;
        }
        raw.relevance = relevance;
      }
      const offer =
        source.type === 'telegram'
          ? await parseTelegramOffer(telegramMessage(row, source), {
              now: this.now(),
              rates,
            })
          : await normalizeOffer(
              {
                ...row,
                identifiers: row.attributes?.propertyId
                  ? { [source.id]: row.attributes.propertyId }
                  : undefined,
                raw,
                searchQuery: query,
                sourceId: source.id,
                sourceType: source.type,
              },
              { now: this.now(), rates }
            );
      if (Number.isFinite(offer?.priceVnd) || offer?.officialUrl) {
        offer.provenance = {
          sourceId: source.id,
          transport: 'browser-preview',
        };
        offers.push(offer);
      }
    }
    return offers;
  }

  // eslint-disable-next-line complexity -- Official-page reconciliation isolates every per-offer failure in one pass.
  async collectOfficialOffers(
    commander,
    offers,
    query,
    rates,
    { signal } = {}
  ) {
    const targets = new Map();
    for (const offer of offers) {
      if (
        offer.officialUrl &&
        offer.officialUrl !== offer.url &&
        safeOfficialUrl(offer.officialUrl)
      ) {
        targets.set(offer.officialUrl, offer);
      }
    }
    const officialOffers = [];
    for (const [url, parent] of [...targets].slice(0, 100)) {
      try {
        const row = await this.scheduler.run(
          url,
          async () => {
            await commander.goto({ url, waitForNetworkIdle: false });
            const extracted =
              (await commander.evaluate(extractOfficialListing)) || {};
            await this.assertListingPage(commander, url, 1, {
              expectedLocation: /nha\s*trang|nhatrang|нячанг/iu.test(query)
                ? 'nha-trang'
                : undefined,
            });
            return extracted;
          },
          { signal }
        );
        const hostname = new globalThis.URL(url).hostname.replace(
          /^www\./u,
          ''
        );
        const offer = await normalizeOffer(
          {
            ...row,
            identifiers: parent.identifiers,
            officialUrl: url,
            raw: { ...row, discoveredFrom: parent.url },
            searchQuery: query,
            sourceId: `official:${hostname}`,
            sourceType: 'official-web',
            title: row.title || parent.title,
            url,
          },
          { now: this.now(), rates }
        );
        if (Number.isFinite(offer.priceVnd)) {
          officialOffers.push(offer);
        }
      } catch (error) {
        if (
          signal?.aborted ||
          error?.name === 'AbortError' ||
          error?.code === 'ABORT_ERR'
        ) {
          throw error;
        }
        this.logger.debug(`Official price check failed for ${url}`, error);
      }
    }
    return officialOffers;
  }

  // eslint-disable-next-line complexity -- The collection coordinator owns the complete browser lifecycle and trace outcome.
  async collect(
    sources,
    query = '',
    { runId: parentRunId, signal, traceRecorder } = {}
  ) {
    const trace = traceRecorder || this.trace;
    const runtime = this.browserRuntime || (await loadDefaultBrowserRuntime());
    const rates = this.rateProvider
      ? await this.rateProvider.getRates()
      : this.rates;
    const { browser, page } = await runtime.launchBrowser({
      engine: 'playwright',
      headless: true,
      ...this.browserLaunchOptions,
    });
    const commander = runtime.makeBrowserCommander({ page });
    const offers = [];

    try {
      for (const source of sources.filter(({ enabled }) => enabled !== false)) {
        const runId =
          parentRunId || `browser:${source.id}:${this.now().toISOString()}`;
        trace.record({
          runId,
          sourceId: source.id,
          stage: 'collection',
          status: 'start',
        });
        try {
          trace.record({
            runId,
            sourceId: source.id,
            stage: 'normalization',
            status: 'start',
          });
          const collected = await this.collectSource(
            commander,
            source,
            query,
            rates,
            { signal }
          );
          offers.push(...collected);
          trace.record({
            runId,
            sourceId: source.id,
            stage: 'normalization',
            status: 'success',
            metadata: { offers: collected.length },
          });
          trace.record({
            runId,
            sourceId: source.id,
            stage: 'collection',
            status: 'success',
            metadata: { offers: collected.length },
          });
        } catch (error) {
          const cancelled =
            signal?.aborted ||
            error?.name === 'AbortError' ||
            error?.code === 'ABORT_ERR';
          trace.record({
            runId,
            sourceId: source.id,
            stage: 'collection',
            status: cancelled ? 'cancelled' : 'failure',
            metadata: {
              category:
                error?.classification || error?.code || 'collection-failure',
              message: error?.message,
              retry: 'source-stopped',
            },
          });
          trace.record({
            runId,
            sourceId: source.id,
            stage: 'normalization',
            status: cancelled ? 'cancelled' : 'failure',
            metadata: {
              category:
                error?.classification || error?.code || 'normalization-failure',
            },
          });
          this.logger.debug(`Collection failed for ${source.id}`, error);
          if (cancelled) {
            throw error;
          }
        }
      }
      offers.push(
        ...(await this.collectOfficialOffers(commander, offers, query, rates, {
          signal,
        }))
      );
    } finally {
      await settleCleanup(
        [
          () => trace.persist(),
          () => commander.destroy(),
          () => browser.close(),
        ],
        'Browser collection cleanup was incomplete.'
      );
    }
    return offers;
  }
}
