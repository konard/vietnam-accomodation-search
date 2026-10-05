import { normalizeOffer } from './offers.js';
import { parseTelegramOffer } from './telegram-parser.js';
import { classifyTelegramPost } from './telegram-pipeline.js';
import { TraceRecorder } from './trace.js';
import {
  isLostPageError,
  launchSettings,
  NAVIGATION_TIMEOUT_MS,
  gotoPage,
  openCommander,
  settleCleanup,
} from './utils.js';
import {
  SOURCE_STATUSES,
  runSourcePool,
  summarizeOutcomes,
  untilAborted,
} from './source-pool.js';
import {
  DomainScheduler,
  PAGE_CLASSIFICATIONS,
  browserAdapterFor,
  classifyListingPage,
} from './browser-adapters.js';

// Web search pages already list rentals, so only clear non-rental intent
// drops a card; a card without rental words is still kept.
const WEB_EXCLUDED_LABELS = new Set([
  'commercial',
  'request',
  'sale',
  'service',
]);

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
  // A facts line such as "Студия · 35㎡" or "2BR · 70㎡" also states the
  // area, so the area is no bedroom count and a studio has no bedroom.
  const bedroomSemantic = (value) => {
    const facts = String(value || '');
    if (/\bstudio\b|студи(?:я|ю|ей)(?!\p{L})/iu.test(facts)) {
      return 0;
    }
    return numericSemantic(
      facts.replace(/\d+(?:[.,]\d+)?\s*(?:㎡|m²|m2|м²|кв\.?\s*м)/giu, '')
    );
  };
  const backgroundImage = (element) =>
    element?.style?.backgroundImage?.match(/url\(["']?(.*?)["']?\)/u)?.[1] ||
    element
      ?.getAttribute?.('style')
      ?.match(/background-image\s*:\s*url\(["']?(.*?)["']?\)/iu)?.[1];
  const availabilityState = (value) => {
    if (
      /\bsold\b|rented\s*out|сдано|недоступ|đã\s*thuê|đã\s*hết|hết\s*(?:phòng|chỗ)|không\s+còn\s+(?:phòng\s+)?trống/iu.test(
        value || ''
      )
    ) {
      return false;
    }
    if (
      /for\s*rent|available|in\s*stock|свобод|доступ|сда[её]т|cho\s*thuê|trống/iu.test(
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
    const href = anchor?.href || '';
    const context = `${href}\n${element.innerText || ''}`;
    // A page such as ".../cho-thue-nha-13735772.html" names the listing id
    // right before ".html"; the card text after the link holds no id.
    return (
      href.match(
        /(?:\/rooms\/|[?&](?:hotel|property|listing)_id=)([\p{L}\d_-]{1,64})/iu
      )?.[1] ||
      href.match(/[-_/](\d{3,64})\.html?(?:[?#]|$)/iu)?.[1] ||
      context.match(
        /(?:\bID(?!\p{L})|\bpr-|\btg-|\bproperty[-_/]|\blisting[-_/])([\p{L}\d_-]{2,64})/iu
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
  const semanticFor = (element) => {
    const semantic = Object.fromEntries(
      Object.entries(selectors.fields || {})
        .map(([field, selector]) => [field, selectedText(element, selector)])
        .filter(([, value]) => value !== undefined)
    );
    // Some rental sites only state rooms in a free-text title. Keep that
    // evidence when present without labelling every title as a room count.
    if (
      semantic.rooms &&
      !/(?:\d+\s*(?:pn\b|phòng\s*ngủ|beds?|bedrooms?|спальн\w*|комнат\w*)|\bstudio\b|студи)/iu.test(
        semantic.rooms
      )
    ) {
      delete semantic.rooms;
    }
    if (!semantic.availability) {
      semantic.availability = String(element.innerText || '').match(
        /rented\s*out|\bsold\b|đã\s*thuê|đã\s*hết|hết\s*(?:phòng|chỗ)|không\s+còn\s+(?:phòng\s+)?trống|còn\s*trống|trống|\bavailable\b|in\s*stock|сдано|недоступ|свобод|доступ/iu
      )?.[0];
    }
    if (!semantic.availability && selectors.availabilityFallback) {
      semantic.availability = selectors.availabilityFallback;
    }
    if (!semantic.location && selectors.locationFallback) {
      semantic.location = selectors.locationFallback;
    }
    return semantic;
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
    const linkSelector = selectors.link || 'a[href]';
    const anchor = element.matches?.(linkSelector)
      ? element
      : element.querySelector(linkSelector);
    const officialAnchor = element.querySelector(
      '[data-official-site][href], a[rel~="external"][href]'
    );
    const titleElement = element.querySelector(
      selectors.title || 'h1, h2, h3, [data-testid="title"], [itemprop="name"]'
    );
    const semantic = semanticFor(element);
    const title = titleElement?.textContent?.trim();
    const propertyId = pageIdentity(element, anchor);
    const bedrooms = bedroomSemantic(semantic.bedrooms);
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
      .filter(([, value]) => value !== undefined)
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
    budgetMs = 3 * 60 * 1000,
    concurrency = 4,
    logger,
    maxTelegramPages = 200,
    navigationTimeoutMs = NAVIGATION_TIMEOUT_MS,
    now,
    rateProvider,
    rates,
    scheduler,
    sourceTimeoutMs = 90 * 1000,
    store,
    telegramPageReserveMs = 15 * 1000,
    traceRecorder,
  } = {}) {
    this.browserLaunchOptions = browserLaunchOptions || {};
    this.browserRuntime = browserRuntime;
    this.budgetMs = budgetMs;
    this.concurrency = concurrency;
    this.sourceTimeoutMs = sourceTimeoutMs;
    this.telegramPageReserveMs = telegramPageReserveMs;
    this.logger = logger || { debug: () => {} };
    this.maxTelegramPages = maxTelegramPages;
    this.navigationTimeoutMs = navigationTimeoutMs;
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
      () => gotoPage(commander, url, this.navigationTimeoutMs),
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
        await gotoPage(commander, url, this.navigationTimeoutMs);
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

  // Navigates to `url`, or resolves false when `deadline` (epoch
  // milliseconds) passes first. The caller's own signal still rejects.
  async #navigatePage(commander, url, { deadline, signal }) {
    if (!Number.isFinite(deadline)) {
      await this.navigate(commander, url, { signal });
      return true;
    }
    const paging = AbortSignal.timeout(Math.max(0, deadline - Date.now()));
    try {
      await this.navigate(commander, url, {
        signal: AbortSignal.any([paging, signal].filter(Boolean)),
      });
      return true;
    } catch (error) {
      if (!paging.aborted || signal?.aborted) {
        throw error;
      }
      return false;
    }
  }

  // Paging stops at `deadline` (epoch milliseconds) and keeps the pages
  // already read, so a channel deeper than the time left still yields its
  // newest posts. The first page has no such limit.
  async collectTelegramRows(
    commander,
    source,
    query,
    { deadline = Infinity, signal } = {}
  ) {
    const firstUrl = buildSearchUrl(source, query);
    const rowsByUrl = new Map();
    const visited = new Set();
    const cutoff = cutoffDate(this.now());
    let pageDeadline = Infinity;
    let url = firstUrl;

    for (
      let page = 0;
      page < this.maxTelegramPages && !visited.has(url);
      page += 1
    ) {
      visited.add(url);
      const reached = await this.#navigatePage(commander, url, {
        deadline: pageDeadline,
        signal,
      });
      if (!reached) {
        this.logger.debug(
          `Stopped paging ${source.id} at the paging deadline after ${page} pages`
        );
        break;
      }
      const rows =
        (await commander.evaluate(extractPageListings, 'telegram')) || [];
      for (const row of rows) {
        const key = row.url || `${row.date || ''}\n${row.text || ''}`;
        rowsByUrl.set(key, row);
      }
      pageDeadline = deadline;
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
  async collectSource(
    commander,
    source,
    query,
    rates,
    { deadline, signal } = {}
  ) {
    const requestedUrl = buildSearchUrl(source, query);
    const adapter = browserAdapterFor(requestedUrl);
    if (!adapter.enabled) {
      throw new BrowserPageError('disabled-adapter', requestedUrl);
    }
    let rows;
    if (source.type === 'telegram') {
      rows = await this.collectTelegramRows(commander, source, query, {
        deadline,
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
      } else if (
        WEB_EXCLUDED_LABELS.has(
          classifyTelegramPost(row.text, { targetLocation: null }).label
        )
      ) {
        continue;
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
            await gotoPage(commander, url, this.navigationTimeoutMs);
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

  // Opens one commander per worker. The first worker reuses the launched
  // page; further workers need `browser.newPage()`, so a runtime without it
  // collects serially.
  #workerFactory(runtime, browser, page) {
    const live = new Set();
    let launchedPageFree = true;
    const open = async () => {
      let workerPage;
      if (launchedPageFree) {
        launchedPageFree = false;
        workerPage = page;
      } else if (typeof browser.newPage === 'function') {
        try {
          workerPage = await browser.newPage();
        } catch (error) {
          // The pool keeps running on the workers it already has.
          this.logger.debug('Opening another browser page failed', error);
          return undefined;
        }
      } else {
        return undefined;
      }
      const worker = {
        commander: openCommander(runtime, workerPage),
        page: workerPage,
      };
      live.add(worker);
      return worker;
    };
    const retire = async (worker) => {
      live.delete(worker);
      await settleCleanup(
        [
          () => worker.commander.destroy(),
          () => (worker.page === page ? undefined : worker.page?.close?.()),
        ],
        'Browser worker cleanup was incomplete.'
      );
    };
    return { live, open, retire };
  }

  #recordOutcome(trace, runId, outcome) {
    const success = [SOURCE_STATUSES.OFFERS, SOURCE_STATUSES.EMPTY].includes(
      outcome.status
    );
    const status = success
      ? 'success'
      : outcome.status === SOURCE_STATUSES.CANCELLED
        ? 'cancelled'
        : 'failure';
    const metadata = success
      ? { durationMs: outcome.durationMs, offers: outcome.offers }
      : {
          category: outcome.category,
          durationMs: outcome.durationMs,
          message: outcome.message,
          outcome: outcome.status,
          retry: 'source-stopped',
        };
    for (const stage of ['normalization', 'collection']) {
      trace.record({
        runId,
        sourceId: outcome.sourceId,
        stage,
        status,
        metadata: success
          ? metadata
          : stage === 'collection'
            ? metadata
            : { category: outcome.category, outcome: outcome.status },
      });
    }
  }

  async #officialOffers(
    workers,
    offers,
    query,
    rates,
    { remainingMs, signal }
  ) {
    const [worker] = workers.live;
    if (!worker || !(remainingMs > 0)) {
      return [];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    timer.unref?.();
    const relay = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', relay, { once: true });
    try {
      return await untilAborted(
        this.collectOfficialOffers(worker.commander, offers, query, rates, {
          signal: controller.signal,
        }),
        controller.signal
      );
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.logger.debug('Official price checks stopped at the budget', error);
      return [];
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  }

  async #launch() {
    const runtime = this.browserRuntime || (await loadDefaultBrowserRuntime());
    const { browser, page } = await runtime.launchBrowser(
      launchSettings(this.browserLaunchOptions)
    );
    return { browser, page, runtime };
  }

  // Launches the browser exactly as a search does, renders a `data:` page,
  // and returns its title. Deploy and CI checks call this so a browser that
  // cannot start fails them the same way it would fail a search.
  async checkLaunch() {
    const { browser, page, runtime } = await this.#launch();
    const commander = openCommander(runtime, page);
    try {
      await commander.goto({
        url: 'data:text/html,<title>browser-check</title>',
        waitForNetworkIdle: false,
      });
      return await commander.evaluate(() => globalThis.document.title);
    } finally {
      await settleCleanup(
        [() => commander.destroy(), () => browser.close()],
        'Browser check cleanup was incomplete.'
      );
    }
  }

  // Paging ends a reserve before the source or search deadline so the pages
  // read so far are parsed and kept.
  #pagingDeadline(startedAt) {
    return (
      Math.min(Date.now() + this.sourceTimeoutMs, startedAt + this.budgetMs) -
      this.telegramPageReserveMs
    );
  }

  #saveSource(trace, onSourceComplete, completed) {
    return Promise.resolve()
      .then(() => onSourceComplete?.(completed))
      .then(() => trace.persist())
      .catch((error) =>
        this.logger.debug(
          `Persisting ${completed.outcome.sourceId} results failed`,
          error
        )
      );
  }

  async collect(sources, query = '', options = {}) {
    return (await this.collectWithReport(sources, query, options)).offers;
  }

  // Collects every enabled source through a bounded worker pool. Each
  // finished source is traced, persisted through `onSourceComplete`, and
  // reported with its outcome, so an interrupted run keeps finished work.
  async collectWithReport(
    sources,
    query = '',
    { onSourceComplete, runId: parentRunId, signal, traceRecorder } = {}
  ) {
    const trace = traceRecorder || this.trace;
    const rates = this.rateProvider
      ? await this.rateProvider.getRates()
      : this.rates;
    const startedAt = Date.now();
    const { browser, page, runtime } = await this.#launch();
    const workers = this.#workerFactory(runtime, browser, page);
    const offers = [];
    const runIds = new Map();
    const runIdFor = (source) => {
      if (!runIds.has(source.id)) {
        runIds.set(
          source.id,
          parentRunId || `browser:${source.id}:${this.now().toISOString()}`
        );
      }
      return runIds.get(source.id);
    };
    const enabled = sources.filter(({ enabled }) => enabled !== false);
    // Each finished source is saved, photo downloads included, beside the
    // pool, so a slow save never holds a worker back from the next source.
    // The deadline tells saves to stop downloading photos when the search
    // budget is spent.
    const deadline = AbortSignal.any(
      [AbortSignal.timeout(this.budgetMs), signal].filter(Boolean)
    );
    const saves = [];
    const save = (outcome, collected) =>
      this.#saveSource(trace, onSourceComplete, {
        offers: collected,
        outcome,
        signal: deadline,
      });

    try {
      const pool = await runSourcePool(enabled, {
        budgetMs: this.budgetMs,
        concurrency: this.concurrency,
        isWorkerLost: isLostPageError,
        onSettled: (outcome, value) => {
          const collected = Array.isArray(value) ? value : [];
          offers.push(...collected);
          this.#recordOutcome(
            trace,
            runIdFor({ id: outcome.sourceId }),
            outcome
          );
          if (!Array.isArray(value)) {
            this.logger.debug(
              `Collection failed for ${outcome.sourceId}`,
              value
            );
          }
          saves.push(save(outcome, collected));
        },
        openWorker: () => workers.open(),
        retireWorker: (worker) =>
          workers
            .retire(worker)
            .catch((error) =>
              this.logger.debug('Retiring a browser worker failed', error)
            ),
        run: (source, { signal: sourceSignal, worker }) => {
          const runId = runIdFor(source);
          for (const stage of ['collection', 'normalization']) {
            trace.record({
              runId,
              sourceId: source.id,
              stage,
              status: 'start',
            });
          }
          return this.collectSource(worker.commander, source, query, rates, {
            deadline: this.#pagingDeadline(startedAt),
            signal: sourceSignal,
          });
        },
        signal,
        sourceTimeoutMs: this.sourceTimeoutMs,
      });
      for (const outcome of pool.outcomes) {
        if (outcome.status === SOURCE_STATUSES.PENDING) {
          trace.record({
            runId: runIdFor({ id: outcome.sourceId }),
            sourceId: outcome.sourceId,
            stage: 'collection',
            status: 'degraded',
            metadata: { category: outcome.category, outcome: outcome.status },
          });
        }
      }
      const summary = summarizeOutcomes(pool.outcomes);
      trace.record({
        runId: parentRunId || `browser:${this.now().toISOString()}`,
        stage: 'collection-summary',
        status: summary.allFailed
          ? 'failure'
          : summary.failed
            ? 'degraded'
            : 'success',
        metadata: {
          budgetElapsed: pool.budgetElapsed,
          byStatus: summary.byStatus,
          failedCategories: summary.failedCategories,
          total: summary.total,
        },
      });
      const official = await this.#officialOffers(
        workers,
        offers,
        query,
        rates,
        {
          remainingMs: pool.budgetElapsed
            ? 0
            : this.budgetMs - (Date.now() - startedAt),
          signal,
        }
      );
      offers.push(...official);
      if (official.length) {
        await onSourceComplete?.({
          offers: official,
          outcome: undefined,
          signal: deadline,
        });
      }
      return {
        budgetElapsed: pool.budgetElapsed,
        offers,
        outcomes: pool.outcomes,
        summary,
      };
    } finally {
      await Promise.all(saves);
      await settleCleanup(
        [
          () => trace.persist(),
          ...[...workers.live].map((worker) => () => workers.retire(worker)),
          () => browser.close(),
        ],
        'Browser collection cleanup was incomplete.'
      );
    }
  }
}
