import { settleCleanup } from './utils.js';
import { TELEGRAM_DISCOVERY_QUERIES } from './telegram-discovery.js';
import { DomainScheduler } from './browser-adapters.js';

function extractSearchLinks() {
  return [...globalThis.document.querySelectorAll('a[href]')]
    .map((anchor) => anchor.href)
    .filter((href) => href.startsWith('http'));
}

function extractTelegramAudience() {
  return (
    globalThis.document.querySelector(
      '.tgme_page_extra, .tgme_channel_info_counter .counter_value'
    )?.textContent || ''
  ).trim();
}

function compactAudience(value) {
  const match = value.match(/([\d\s.,]+)\s*([KMB])?/iu);
  if (!match) {
    return null;
  }
  const amount = Number(match[1].replace(/[\s,]/gu, ''));
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[
    match[2]?.toUpperCase()
  ];
  return Number.isFinite(amount) ? amount * (scale || 1) : null;
}

function sourceHost(source) {
  return new globalThis.URL(source.url).hostname.replace(/^www\./u, '');
}

function telegramHandle(url) {
  return url.match(/https?:\/\/(?:www\.)?t\.me\/(?:s\/)?([\w-]+)/u)?.[1];
}

function loadRuntime(runtime) {
  return runtime || import('browser-commander');
}

export class BrowserSourceDiscoverer {
  constructor({
    browserLaunchOptions,
    browserRuntime,
    logger,
    now,
    scheduler,
  } = {}) {
    this.browserLaunchOptions = browserLaunchOptions || {};
    this.browserRuntime = browserRuntime;
    this.logger = logger || { debug: () => {} };
    this.now = now || (() => new Date());
    this.scheduler = scheduler || new DomainScheduler();
  }

  navigate(commander, url, { signal } = {}) {
    return this.scheduler.run(
      url,
      () => commander.goto({ url, waitForNetworkIdle: false }),
      { signal }
    );
  }

  async rankWeb(commander, candidates, { signal } = {}) {
    const evidenceUrl =
      'https://www.google.com/search?q=popular+Vietnam+accommodation+booking+websites';
    await this.navigate(commander, evidenceUrl, { signal });
    const links = await commander.evaluate(extractSearchLinks);
    return candidates.map((source) => {
      const rank = links.findIndex((link) => link.includes(sourceHost(source)));
      return {
        ...source,
        popularity: {
          metric: 'google-search-rank-score',
          value:
            rank >= 0 ? links.length - rank : source.popularity.value / 100,
          evidenceUrl,
          limitations:
            'Public search order is volatile, personalized, and only a ranking signal.',
          observedAt: this.now().toISOString(),
        },
      };
    });
  }

  async findTelegramCandidates(commander, candidates, { focus, signal } = {}) {
    const queries = TELEGRAM_DISCOVERY_QUERIES.queries.filter(({ id }) =>
      focus ? id.includes('nha-trang') : id.includes('vietnam')
    );
    const links = [];
    for (const query of queries) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`site:t.me ${query.text} Telegram`)}`;
      await this.navigate(commander, searchUrl, { signal });
      links.push(
        ...(await commander.evaluate(extractSearchLinks)).map((url) => ({
          language: query.language,
          queryId: query.id,
          url,
        }))
      );
    }
    const byHandle = new Map(
      candidates.map((source) => [
        telegramHandle(source.url)?.toLocaleLowerCase('en'),
        source,
      ])
    );
    for (const link of links) {
      const handle = telegramHandle(link.url);
      const normalized = handle?.toLocaleLowerCase('en');
      if (handle && !byHandle.has(normalized)) {
        byHandle.set(normalized, {
          id: `telegram:${handle.toLocaleLowerCase('en')}`,
          name: handle,
          type: 'telegram',
          url: `https://t.me/${handle}`,
          searchUrl: `https://t.me/s/${handle}`,
          popularity: candidates.at(-1)?.popularity,
          provenance: [
            {
              language: link.language,
              queryId: link.queryId,
              transport: 'public-preview',
            },
          ],
          ...(focus ? { focus } : {}),
        });
      } else if (handle) {
        const existing = byHandle.get(normalized);
        existing.provenance = [
          ...(existing.provenance || []),
          {
            language: link.language,
            queryId: link.queryId,
            transport: 'public-preview',
          },
        ];
      }
    }
    return [...byHandle.values()];
  }

  async rankTelegram(commander, candidates, { focus, signal } = {}) {
    const discovered = await this.findTelegramCandidates(
      commander,
      candidates,
      { focus, signal }
    );
    const ranked = [];
    for (const source of discovered) {
      let audience = null;
      try {
        await this.navigate(commander, source.searchUrl, { signal });
        audience = compactAudience(
          await commander.evaluate(extractTelegramAudience)
        );
      } catch (error) {
        this.logger.debug(`Source ranking failed for ${source.id}`, error);
      }
      ranked.push({
        ...source,
        ...(focus ? { focus } : {}),
        popularity: {
          metric: 'members-or-subscribers',
          value: audience ?? source.popularity?.value ?? 0,
          evidenceUrl: source.url,
          limitations:
            'Visible member/subscriber counts are volatile and may be unavailable.',
          observedAt: this.now().toISOString(),
        },
        lastScannedAt: this.now().toISOString(),
      });
    }
    return ranked;
  }

  async discover(type, { candidates, focus, signal } = {}) {
    const runtime = await loadRuntime(this.browserRuntime);
    const { browser, page } = await runtime.launchBrowser({
      engine: 'playwright',
      headless: true,
      ...this.browserLaunchOptions,
    });
    const commander = runtime.makeBrowserCommander({ page });
    try {
      return type === 'telegram'
        ? await this.rankTelegram(commander, candidates, { focus, signal })
        : await this.rankWeb(commander, candidates, { signal });
    } finally {
      await settleCleanup(
        [() => commander.destroy(), () => browser.close()],
        'Source discovery cleanup was incomplete.'
      );
    }
  }
}
