import { BrowserCollector } from './browser-collector.js';
import { DomainScheduler } from './browser-adapters.js';
import { ExchangeRateProvider } from './pricing.js';
import { LinksStore } from './links-store.js';
import { MediaCache } from './media-cache.js';
import { PresetService } from './presets.js';
import { SearchService } from './search-service.js';
import { BrowserSourceDiscoverer } from './source-discovery.js';
import {
  DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
  DEFAULT_TELEGRAM_SOURCES,
  SourceRegistry,
} from './sources.js';
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
import { TraceRecorder } from './trace.js';
import {
  BotApiTelegramDiscoveryProvider,
  ConfiguredTelegramDiscoveryProvider,
  PublicPreviewTelegramDiscoveryProvider,
  TelegramSourceDiscovery,
} from './telegram-discovery.js';

function noSandboxRequested(environment) {
  return environment.BROWSER_NO_SANDBOX === '1';
}

// eslint-disable-next-line complexity, max-lines-per-function -- The composition root keeps all injectable production dependencies visible in one audit boundary.
export function createApplication(options = {}) {
  const environment =
    options.environment ||
    (typeof globalThis.Deno === 'undefined'
      ? globalThis.process?.env || {}
      : {});
  const telegramCredentials = options.telegramCredentials || {
    apiHash: environment.TELEGRAM_API_HASH,
    apiId: environment.TELEGRAM_API_ID,
    session: environment.TELEGRAM_USER_SESSION,
    sessionFormat: environment.TELEGRAM_USER_SESSION_FORMAT,
  };
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
  const traceRecorder = options.traceRecorder || new TraceRecorder({ store });
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
      store,
      traceRecorder,
      scheduler:
        options.browserScheduler ||
        new DomainScheduler({
          maxConcurrentDomains: 3,
          maxDelayMs: 750,
          minDelayMs: 250,
        }),
    });
  const discoverer =
    options.discoverer ||
    new BrowserSourceDiscoverer({
      browserLaunchOptions,
      browserRuntime: options.browserRuntime,
      logger: options.logger,
      scheduler:
        options.discoveryBrowserScheduler ||
        new DomainScheduler({
          maxConcurrentDomains: 3,
          maxDelayMs: 750,
          minDelayMs: 250,
        }),
    });
  const configuredUserDiscoveryProvider =
    telegramCredentials.apiId &&
    telegramCredentials.apiHash &&
    telegramCredentials.session
      ? new MtcuteTelegramProvider({
          apiHash: telegramCredentials.apiHash,
          apiId: telegramCredentials.apiId,
          clientFactory: options.mtcuteClientFactory,
          expectedUserId: environment.TELEGRAM_EXPECTED_USER_ID,
          logger: options.logger,
          session: telegramCredentials.session,
          sessionFormat: telegramCredentials.sessionFormat,
        })
      : undefined;
  let configuredUserDiscoveryTail = Promise.resolve();
  const configuredUserDiscovery = configuredUserDiscoveryProvider
    ? {
        name: 'mtproto',
        discover(arguments_) {
          const operation = configuredUserDiscoveryTail
            .catch(() => {})
            .then(async () => {
              try {
                return await configuredUserDiscoveryProvider.discover(
                  arguments_
                );
              } finally {
                await configuredUserDiscoveryProvider.destroy();
              }
            });
          configuredUserDiscoveryTail = operation;
          return operation;
        },
      }
    : undefined;
  const checkpointTelegramDiscovery = async (checkpoint) => {
    const update = (existing = []) => [
      ...existing.filter(({ id }) => id !== checkpoint.focus),
      { id: checkpoint.focus, ...checkpoint },
    ];
    if (typeof store.updateRecords === 'function') {
      await store.updateRecords('telegram-discovery-checkpoint', update);
      return;
    }
    const existing =
      (await store.loadRecords?.('telegram-discovery-checkpoint')) || [];
    await store.saveRecords?.(
      'telegram-discovery-checkpoint',
      update(existing)
    );
  };
  const telegramSourceDiscovery =
    options.telegramSourceDiscovery ||
    new TelegramSourceDiscovery({
      checkpoint: checkpointTelegramDiscovery,
      providers: [
        new ConfiguredTelegramDiscoveryProvider({
          focusSources: DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
          sources: DEFAULT_TELEGRAM_SOURCES,
        }),
        new PublicPreviewTelegramDiscoveryProvider({
          candidates: DEFAULT_TELEGRAM_SOURCES,
          discover:
            typeof discoverer.discover === 'function'
              ? discoverer.discover.bind(discoverer)
              : () => [],
          focusCandidates: DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
        }),
        configuredUserDiscovery,
      ].filter(Boolean),
      store,
      traceRecorder,
    });
  const registry =
    options.registry ||
    new SourceRegistry({
      discover: async (type, { candidates, focus } = {}) => {
        if (type !== 'telegram') {
          return discoverer.discover(type, { candidates, focus });
        }
        const result = await telegramSourceDiscovery.discover({ focus });
        return result.sources;
      },
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
    new SearchService({
      collector,
      mediaCache,
      registry,
      store,
      traceRecorder,
    });
  const updateDeduplicator =
    options.updateDeduplicator || new UpdateDeduplicator({ store });

  return {
    accessPolicy,
    collector,
    createAvailabilityService: (credentials = {}) =>
      new TelegramAvailabilityService({ ...credentials, store }),
    createBot: async (token, credentials = {}) => {
      const bot = await createTelegramBot(token, {
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
        traceRecorder,
        updateDeduplicator,
      });
      telegramSourceDiscovery.addProvider?.(
        new BotApiTelegramDiscoveryProvider({
          api: options.botDiscoveryApi || bot.api,
          candidates: DEFAULT_TELEGRAM_SOURCES,
          focusCandidates: DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
        })
      );
      return bot;
    },
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
        traceRecorder,
      });
    },
    mediaCache,
    presetService,
    rateProvider,
    registry,
    service,
    store,
    traceRecorder,
    updateDeduplicator,
  };
}
