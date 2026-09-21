import { normalizeOffer } from './offers.js';
import { parseTelegramOffer } from './telegram-parser.js';

export function buildSearchUrl(source, query = '') {
  return source.searchUrl.replaceAll('{query}', encodeURIComponent(query));
}

export function loadDefaultBrowserRuntime() {
  return import('browser-commander');
}

function extractPageListings(sourceType) {
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

  const cards = [
    ...documentRef.querySelectorAll(
      '[data-testid="property-card"], [data-testid="card-container"], article, .property-card, [itemtype*="Hotel"]'
    ),
  ].slice(0, 100);
  return cards.map((element) => {
    const anchor = element.querySelector('a[href]');
    const officialAnchor = element.querySelector(
      '[data-official-site][href], a[rel~="external"][href]'
    );
    const titleElement = element.querySelector(
      'h1, h2, h3, [data-testid="title"], [itemprop="name"]'
    );
    const propertyId =
      element.getAttribute('data-hotelid') ||
      element.getAttribute('data-property-id') ||
      element.getAttribute('data-listing-id') ||
      anchor?.href.match(
        /(?:\/rooms\/|[?&](?:hotel|property|listing)_id=)([\p{L}\d_-]{1,64})/iu
      )?.[1];
    return {
      attributes: propertyId ? { propertyId } : undefined,
      photos: [...element.querySelectorAll('img[src]')]
        .map((image) => image.currentSrc || image.src)
        .filter(Boolean),
      text: element.innerText,
      title: titleElement?.textContent?.trim(),
      url: anchor?.href,
      officialUrl: officialAnchor?.href,
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

function telegramMessage(item, source) {
  const messageId = item.url?.match(/\/(\d+)(?:\?.*)?$/u)?.[1];
  const username = source.url.match(/t\.me\/(?:s\/)?([^/?]+)/u)?.[1];
  return {
    ...item,
    chat: { title: source.name, username },
    date: item.date,
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
    now,
    rateProvider,
    rates,
  } = {}) {
    this.browserLaunchOptions = browserLaunchOptions || {};
    this.browserRuntime = browserRuntime;
    this.logger = logger || { debug: () => {} };
    this.now = now || (() => new Date());
    this.rateProvider = rateProvider;
    this.rates = rates || { VND: 1 };
  }

  async collectTelegramRows(commander, source, query) {
    const firstUrl = buildSearchUrl(source, query);
    const rowsByUrl = new Map();
    const visited = new Set();
    const cutoff = cutoffDate(this.now());
    let url = firstUrl;

    for (let page = 0; page < 200 && !visited.has(url); page += 1) {
      visited.add(url);
      await commander.goto({ url, waitForNetworkIdle: false });
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
      url = beforeUrl(firstUrl, Math.min(...ids));
    }
    return [...rowsByUrl.values()];
  }

  async collectSource(commander, source, query, rates) {
    let rows;
    if (source.type === 'telegram') {
      rows = await this.collectTelegramRows(commander, source, query);
    } else {
      await commander.goto({
        url: buildSearchUrl(source, query),
        waitForNetworkIdle: false,
      });
      rows = await commander.evaluate(extractPageListings, source.type);
    }
    const offers = [];

    for (const row of rows || []) {
      const raw = { ...row };
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
        offers.push(offer);
      }
    }
    return offers;
  }

  async collectOfficialOffers(commander, offers, query, rates) {
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
        await commander.goto({ url, waitForNetworkIdle: false });
        const row = (await commander.evaluate(extractOfficialListing)) || {};
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
        this.logger.debug(`Official price check failed for ${url}`, error);
      }
    }
    return officialOffers;
  }

  async collect(sources, query = '') {
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
      for (const source of sources) {
        try {
          offers.push(
            ...(await this.collectSource(commander, source, query, rates))
          );
        } catch (error) {
          this.logger.debug(`Collection failed for ${source.id}`, error);
        }
      }
      offers.push(
        ...(await this.collectOfficialOffers(commander, offers, query, rates))
      );
    } finally {
      await commander.destroy();
      await browser.close();
    }
    return offers;
  }
}
