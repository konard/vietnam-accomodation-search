function extractSearchLinks() {
  return [...globalThis.document.querySelectorAll('a[href]')]
    .map((anchor) => anchor.href)
    .filter((href) => href.startsWith('http'));
}

function extractTelegramAudience() {
  return (
    globalThis.document.querySelector('.tgme_page_extra')?.textContent || ''
  ).trim();
}

function compactAudience(value) {
  const match = value.match(/([\d.,]+)\s*([KMB])?/iu);
  if (!match) {
    return null;
  }
  const amount = Number(match[1].replaceAll(',', ''));
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
  constructor({ browserLaunchOptions, browserRuntime, logger, now } = {}) {
    this.browserLaunchOptions = browserLaunchOptions || {};
    this.browserRuntime = browserRuntime;
    this.logger = logger || { debug: () => {} };
    this.now = now || (() => new Date());
  }

  async rankWeb(commander, candidates) {
    const evidenceUrl =
      'https://www.google.com/search?q=popular+Vietnam+accommodation+booking+websites';
    await commander.goto({ url: evidenceUrl, waitForNetworkIdle: false });
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
          observedAt: this.now().toISOString(),
        },
      };
    });
  }

  async findTelegramCandidates(commander, candidates) {
    const searchUrl =
      'https://www.google.com/search?q=site%3At.me+Vietnam+apartment+rent+Telegram';
    await commander.goto({ url: searchUrl, waitForNetworkIdle: false });
    const links = await commander.evaluate(extractSearchLinks);
    const byHandle = new Map(
      candidates.map((source) => [telegramHandle(source.url), source])
    );
    for (const link of links) {
      const handle = telegramHandle(link);
      if (handle && !byHandle.has(handle)) {
        byHandle.set(handle, {
          id: `telegram:${handle.toLocaleLowerCase('en')}`,
          name: handle,
          type: 'telegram',
          url: `https://t.me/${handle}`,
          searchUrl: `https://t.me/s/${handle}`,
          popularity: candidates.at(-1)?.popularity,
        });
      }
    }
    return [...byHandle.values()];
  }

  async rankTelegram(commander, candidates) {
    const discovered = await this.findTelegramCandidates(commander, candidates);
    const ranked = [];
    for (const source of discovered) {
      let audience = null;
      try {
        await commander.goto({
          url: source.searchUrl,
          waitForNetworkIdle: false,
        });
        audience = compactAudience(
          await commander.evaluate(extractTelegramAudience)
        );
      } catch (error) {
        this.logger.debug(`Source ranking failed for ${source.id}`, error);
      }
      ranked.push({
        ...source,
        popularity: {
          metric: 'members-or-subscribers',
          value: audience ?? source.popularity?.value ?? 0,
          evidenceUrl: source.url,
          observedAt: this.now().toISOString(),
        },
      });
    }
    return ranked;
  }

  async discover(type, { candidates }) {
    const runtime = await loadRuntime(this.browserRuntime);
    const { browser, page } = await runtime.launchBrowser({
      engine: 'playwright',
      headless: true,
      ...this.browserLaunchOptions,
    });
    const commander = runtime.makeBrowserCommander({ page });
    try {
      return type === 'telegram'
        ? await this.rankTelegram(commander, candidates)
        : await this.rankWeb(commander, candidates);
    } finally {
      await commander.destroy();
      await browser.close();
    }
  }
}
