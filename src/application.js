import { BrowserCollector } from './browser-collector.js';
import { ExchangeRateProvider } from './pricing.js';
import { LinksStore } from './links-store.js';
import { MediaCache } from './media-cache.js';
import { PresetService } from './presets.js';
import { SearchService } from './search-service.js';
import { BrowserSourceDiscoverer } from './source-discovery.js';
import { SourceRegistry } from './sources.js';
import { TelegramAccessPolicy } from './telegram-access.js';
import { createTelegramBot } from './telegram-bot.js';
import {
  BotApiTelegramProvider,
  TelegramCapabilityRouter,
} from './telegram-capabilities.js';
import {
  MtcuteTelegramProvider,
  TelegramIngestionService,
} from './telegram-mtcute.js';
import { UpdateDeduplicator } from './telegram-runtime.js';
import { TelegramAvailabilityService } from './telegram-user.js';

function noSandboxRequested(environment) {
  return environment.BROWSER_NO_SANDBOX === '1';
}

// eslint-disable-next-line complexity -- The composition root explicitly selects each injectable production dependency.
export function createApplication(options = {}) {
  const environment =
    options.environment ||
    (typeof globalThis.Deno === 'undefined'
      ? globalThis.process?.env || {}
      : {});
  const directory =
    options.directory ||
    environment.DATA_DIRECTORY ||
    '.vietnam-accomodation-search';
  const maxBytes = options.maxBytes || 10 * 1024 ** 3;
  const noSandbox = noSandboxRequested(environment);
  const browserLaunchOptions =
    options.browserLaunchOptions ||
    (noSandbox ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {});
  const store =
    options.store ||
    new LinksStore({
      binaryMirror:
        options.binaryMirror ?? environment.LINKS_BINARY_MIRROR === '1',
      directory,
      maxBytes,
    });
  const presetService = options.presetService || new PresetService({ store });
  const accessPolicy =
    options.accessPolicy ||
    new TelegramAccessPolicy({
      allowedChatIds: [environment.TELEGRAM_ALLOWED_CHAT_IDS],
      allowedUserIds: [environment.TELEGRAM_ALLOWED_USER_IDS],
      mode: environment.TELEGRAM_ACCESS_MODE || 'private',
    });
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
  const updateDeduplicator =
    options.updateDeduplicator || new UpdateDeduplicator({ store });

  return {
    accessPolicy,
    collector,
    createAvailabilityService: (credentials = {}) =>
      new TelegramAvailabilityService({ ...credentials, store }),
    createBot: (token, credentials = {}) =>
      createTelegramBot(token, {
        accessPolicy,
        createAvailabilityService: (api) => {
          const configuredUser =
            credentials.apiHash && credentials.apiId && credentials.session;
          const user = configuredUser
            ? new MtcuteTelegramProvider({
                ...credentials,
                clientFactory: options.mtcuteClientFactory,
                expectedUserId: environment.TELEGRAM_EXPECTED_USER_ID,
                logger: options.logger,
              })
            : undefined;
          const router = new TelegramCapabilityRouter({
            bot: new BotApiTelegramProvider(api, { token }),
            mode: user ? 'both' : 'bot-only',
            store,
            user,
          });
          return new TelegramAvailabilityService({ router, store });
        },
        rateProvider,
        registry,
        service,
        presetService,
        store,
        subscriptionIntervalMs: options.subscriptionIntervalMs,
        updateDeduplicator,
      }),
    createTelegramIngestionService: (credentials = {}) => {
      const provider = new MtcuteTelegramProvider({
        ...credentials,
        clientFactory: options.mtcuteClientFactory,
        expectedUserId: environment.TELEGRAM_EXPECTED_USER_ID,
        logger: options.logger,
      });
      return new TelegramIngestionService({
        logger: options.logger,
        provider,
        rateProvider,
        store,
      });
    },
    mediaCache,
    presetService,
    rateProvider,
    registry,
    service,
    store,
    updateDeduplicator,
  };
}
