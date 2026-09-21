import { BrowserCollector, DEFAULT_TELEGRAM_SOURCES } from '../src/index.js';

const collector = new BrowserCollector({
  browserLaunchOptions:
    process.env.BROWSER_NO_SANDBOX === '1'
      ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
      : {},
  logger: {
    debug: (message, error) => console.error(message, error?.stack || error),
  },
  rates: { USD: 26_000, VND: 1 },
});

const offers = await collector.collect(
  [DEFAULT_TELEGRAM_SOURCES[1]],
  process.argv.slice(2).join(' ') || 'Da Nang'
);

console.log(JSON.stringify(offers, null, 2));
