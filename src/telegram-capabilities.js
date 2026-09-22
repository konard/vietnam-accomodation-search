import {
  classifyTelegramError,
  retryTelegramOperation,
} from './telegram-errors.js';
import { settleCleanup } from './utils.js';

const METHODS = {
  history: 'history',
  identity: 'identity',
  liveUpdates: 'liveUpdates',
  media: 'media',
  membership: 'membership',
  popularity: 'popularity',
  resolveEntity: 'resolveEntity',
  send: 'send',
};

function providersFor(mode, bot, user) {
  if (!['bot-only', 'user-only', 'both'].includes(mode)) {
    throw new TypeError(`Unsupported Telegram mode: ${mode}`);
  }
  return mode === 'bot-only'
    ? [bot]
    : mode === 'user-only'
      ? [user]
      : [bot, user];
}

function supports(provider, capability) {
  return (
    provider &&
    (!provider.capabilities || provider.capabilities.has(capability)) &&
    typeof provider[METHODS[capability]] === 'function'
  );
}

function persistedSendResult(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }
  const receipt = {};
  for (const key of ['id', 'message_id']) {
    if (result[key] !== undefined) {
      receipt[key] =
        typeof result[key] === 'bigint' ? String(result[key]) : result[key];
    }
  }
  return receipt;
}

export class BotApiTelegramProvider {
  constructor(api, { fetchImpl = globalThis.fetch, token } = {}) {
    this.api = api;
    this.capabilities = new Set([
      'identity',
      'media',
      'membership',
      'popularity',
      'resolveEntity',
      'send',
    ]);
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.transport = 'bot-api';
  }

  identity() {
    return this.api.getMe();
  }

  resolveEntity(chatId) {
    return this.api.getChat(chatId);
  }

  async media(fileId, { signal } = {}) {
    const file = await this.api.getFile(fileId);
    if (!this.token || !file.file_path) {
      const error = new Error(
        'Bot API media download requires a token and file path.'
      );
      error.code = 'TELEGRAM_CAPABILITY_UNAVAILABLE';
      throw error;
    }
    const response = await this.fetchImpl(
      `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
      { signal }
    );
    if (!response.ok) {
      throw new Error(
        `Bot API media download returned HTTP ${response.status}`
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async membership(chatId, userId) {
    const memberId = userId ?? (await this.identity()).id;
    return this.api.getChatMember(chatId, memberId);
  }

  async popularity(chatId) {
    return { members: await this.api.getChatMemberCount(chatId) };
  }

  async send(destination, message, options = {}) {
    const sendOptions = { ...options };
    delete sendOptions.idempotencyKey;
    try {
      return await this.api.sendMessage(destination, message, sendOptions);
    } catch (error) {
      const category = classifyTelegramError(error).category;
      if (['blocked', 'capability', 'entity'].includes(category)) {
        error.preSend = true;
      }
      throw error;
    }
  }
}

export class TelegramCapabilityRouter {
  constructor({
    bot,
    logger,
    mode = 'bot-only',
    retry = retryTelegramOperation,
    retryOptions,
    store,
    user,
  } = {}) {
    this.logger = logger;
    this.mode = mode;
    this.providers = providersFor(mode, bot, user).filter(Boolean);
    this.pendingSends = new Map();
    this.retry = retry;
    this.retryOptions = retryOptions;
    this.store = store;
  }

  diagnostics() {
    return {
      capabilities: Object.keys(METHODS).map((capability) => ({
        available: this.providers.some((provider) =>
          supports(provider, capability)
        ),
        capability,
        transports: this.providers
          .filter((provider) => supports(provider, capability))
          .map((provider) => provider.transport || 'configured'),
      })),
      mode: this.mode,
    };
  }

  async #route(capability, arguments_, { nonIdempotent = false } = {}) {
    const capable = this.providers.filter((provider) =>
      supports(provider, capability)
    );
    if (!capable.length) {
      const error = new Error(`Telegram capability unavailable: ${capability}`);
      error.code = 'TELEGRAM_CAPABILITY_UNAVAILABLE';
      throw error;
    }
    for (const [index, provider] of capable.entries()) {
      try {
        return await this.retry(
          () => provider[METHODS[capability]](...arguments_),
          {
            ...this.retryOptions,
            idempotent: !nonIdempotent && capability !== 'liveUpdates',
            logger: this.logger,
            operationName: capability,
            sourceId: arguments_[0]?.id,
            transport: provider.transport || 'configured',
          }
        );
      } catch (error) {
        const fallback = index < capable.length - 1;
        const classified = classifyTelegramError(error);
        const knownBeforeSend = !nonIdempotent || error?.preSend === true;
        if (
          !fallback ||
          !['blocked', 'capability', 'entity'].includes(classified.category) ||
          !knownBeforeSend
        ) {
          throw error;
        }
      }
    }
  }

  identity(...arguments_) {
    return this.#route('identity', arguments_);
  }

  liveUpdates(...arguments_) {
    return this.#route('liveUpdates', arguments_);
  }

  history(...arguments_) {
    return this.#route('history', arguments_);
  }

  resolveEntity(...arguments_) {
    return this.#route('resolveEntity', arguments_);
  }

  media(...arguments_) {
    return this.#route('media', arguments_);
  }

  membership(...arguments_) {
    return this.#route('membership', arguments_);
  }

  popularity(...arguments_) {
    return this.#route('popularity', arguments_);
  }

  async send(destination, message, options = {}) {
    const key = options.idempotencyKey;
    if (!key) {
      return this.#deliver(destination, message, options);
    }
    const pending = this.pendingSends.get(key);
    if (pending) {
      return pending;
    }
    const delivery = this.#deliver(destination, message, options);
    this.pendingSends.set(key, delivery);
    try {
      return await delivery;
    } finally {
      if (this.pendingSends.get(key) === delivery) {
        this.pendingSends.delete(key);
      }
    }
  }

  async #deliver(destination, message, options) {
    const key = options.idempotencyKey;
    if (key && this.store) {
      const outcomes = await this.store.loadRecords('delivery-outcomes');
      const prior = outcomes.find((outcome) => outcome.id === key);
      if (prior) {
        return prior.result;
      }
    }
    const result = await this.#route('send', [destination, message, options], {
      nonIdempotent: true,
    });
    if (key && this.store) {
      if (typeof this.store.updateRecords === 'function') {
        await this.store.updateRecords('delivery-outcomes', (outcomes) => {
          const next = outcomes.filter((outcome) => outcome.id !== key);
          next.push({ id: key, result: persistedSendResult(result) });
          return next.slice(-1000);
        });
      } else {
        const outcomes = await this.store.loadRecords('delivery-outcomes');
        outcomes.push({ id: key, result: persistedSendResult(result) });
        await this.store.saveRecords(
          'delivery-outcomes',
          outcomes.slice(-1000)
        );
      }
    }
    return result;
  }

  async destroy() {
    await settleCleanup(
      this.providers.map((provider) => () => provider.destroy?.()),
      'Telegram provider cleanup was incomplete.'
    );
  }
}
