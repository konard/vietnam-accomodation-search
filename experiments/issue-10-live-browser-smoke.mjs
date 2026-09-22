import { BrowserCollector } from '../src/browser-collector.js';
import { DEFAULT_TELEGRAM_SOURCES } from '../src/sources.js';

const source =
  DEFAULT_TELEGRAM_SOURCES.find(({ id }) => id === process.argv[2]) ||
  DEFAULT_TELEGRAM_SOURCES[0];
const failures = [];
const collector = new BrowserCollector({
  browserLaunchOptions:
    process.env.BROWSER_NO_SANDBOX === '1'
      ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
      : undefined,
  maxTelegramPages: 1,
  logger: {
    debug: (message, error) =>
      failures.push({ message, reason: error?.message || String(error) }),
  },
});
const offers = await collector.collect([source], '');

console.log(
  JSON.stringify(
    {
      failures,
      offerCount: offers.length,
      pricedOfferCount: offers.filter(({ priceVnd }) =>
        Number.isFinite(priceVnd)
      ).length,
      source: { id: source.id, url: source.url },
      transports: [
        ...new Set(offers.map(({ provenance }) => provenance?.transport)),
      ].filter(Boolean),
    },
    null,
    2
  )
);
