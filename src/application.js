import { BrowserCollector } from './browser-collector.js';
import { ExchangeRateProvider } from './pricing.js';
import { LinksStore } from './links-store.js';
import { MediaCache } from './media-cache.js';
import { SearchService } from './search-service.js';
import { BrowserSourceDiscoverer } from './source-discovery.js';
import { SourceRegistry } from './sources.js';
import { createTelegramBot } from './telegram-bot.js';
import { TelegramAvailabilityService } from './telegram-user.js';

export function createApplication(options = {}) {
  const directory = options.directory || '.vietnam-accomodation-search';
  const maxBytes = options.maxBytes || 10 * 1024 ** 3;
  const noSandbox = globalThis.process?.env?.BROWSER_NO_SANDBOX === '1';
  const browserLaunchOptions =
    options.browserLaunchOptions ||
    (noSandbox ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {});
  const store = options.store || new LinksStore({ directory, maxBytes });
  const rateProvider =
    options.rateProvider ||
    new ExchangeRateProvider({ fetchImpl: options.fetchImpl });
  const collector =
    options.collector ||
    new BrowserCollector({
      browserLaunchOptions,
      browserRuntime: options.browserRuntime,
      logger: options.logger,
      rateProvider,
    });
  const discoverer =
    options.discoverer ||
    new BrowserSourceDiscoverer({
      browserLaunchOptions,
      browserRuntime: options.browserRuntime,
      logger: options.logger,
    });
  const registry =
    options.registry ||
    new SourceRegistry({
      discover: discoverer.discover.bind(discoverer),
      store,
    });
  const mediaCache =
    options.mediaCache ||
    new MediaCache({
      directory,
      fetchImpl: options.fetchImpl,
      maxBytes,
    });
  const service =
    options.service ||
    new SearchService({ collector, mediaCache, registry, store });

  return {
    collector,
    createAvailabilityService: (credentials = {}) =>
      new TelegramAvailabilityService({ ...credentials, store }),
    createBot: (token, credentials = {}) =>
      createTelegramBot(token, {
        availabilityService: new TelegramAvailabilityService({
          ...credentials,
          store,
        }),
        rateProvider,
        registry,
        service,
        store,
      }),
    mediaCache,
    rateProvider,
    registry,
    service,
    store,
  };
}
