import { normalizeOffer } from './offers.js';
import { parseTelegramOffer } from './telegram-parser.js';

export function buildSearchUrl(source, query = '') {
  return source.searchUrl.replaceAll('{query}', encodeURIComponent(query));
}

function defaultBrowserRuntime() {
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
    const titleElement = element.querySelector(
      'h1, h2, h3, [data-testid="title"], [itemprop="name"]'
    );
    return {
      photos: [...element.querySelectorAll('img[src]')]
        .map((image) => image.currentSrc || image.src)
        .filter(Boolean),
      text: element.innerText,
      title: titleElement?.textContent?.trim(),
      url: anchor?.href,
    };
  });
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

  async collectSource(commander, source, query, rates) {
    await commander.goto({
      url: buildSearchUrl(source, query),
      waitForNetworkIdle: false,
    });
    const rows = await commander.evaluate(extractPageListings, source.type);
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
                raw,
                searchQuery: query,
                sourceId: source.id,
                sourceType: source.type,
              },
              { now: this.now(), rates }
            );
      if (Number.isFinite(offer?.priceVnd)) {
        offers.push(offer);
      }
    }
    return offers;
  }

  async collect(sources, query = '') {
    const runtime = this.browserRuntime || (await defaultBrowserRuntime());
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
    } finally {
      await commander.destroy();
      await browser.close();
    }
    return offers;
  }
}
