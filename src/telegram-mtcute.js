import { parseTelegramOffer } from './telegram-parser.js';
import { createMtcuteClient } from './telegram-user.js';
import { settleCleanup } from './utils.js';

const CAPABILITIES = new Set([
  'history',
  'identity',
  'liveUpdates',
  'media',
  'membership',
  'popularity',
  'resolveEntity',
  'send',
]);

function sourcePeer(source) {
  if (source.peerId || source.username) {
    return source.peerId || source.username;
  }
  const match = String(source.url || source.searchUrl || '').match(
    /t\.me\/(?:s\/)?([^/?#]+)/iu
  );
  return match ? `@${match[1]}` : source.id.replace(/^telegram:/u, '@');
}

function sourceHandle(source) {
  return String(sourcePeer(source)).replace(/^@/u, '').toLowerCase();
}

function peerId(peer) {
  return (
    peer?.channelId ?? peer?.chatId ?? peer?.userId ?? peer?.id ?? undefined
  );
}

function markedPeerId(peer) {
  switch (peer?._) {
    case 'inputPeerChannel':
    case 'inputPeerChannelFromMessage':
    case 'inputChannel':
    case 'inputChannelFromMessage':
      return -1_000_000_000_000 - Number(peer.channelId);
    case 'inputPeerChat':
      return -Number(peer.chatId);
    case 'inputPeerUser':
    case 'inputPeerUserFromMessage':
    case 'inputUser':
    case 'inputUserFromMessage':
      return Number(peer.userId);
    default:
      return undefined;
  }
}

function serial(value) {
  return typeof value === 'bigint' ? String(value) : value;
}

function mediaMetadata(media) {
  const raw = media?.raw || media;
  if (!raw) {
    return undefined;
  }
  const content = raw.photo || raw.document || raw.webpage;
  return {
    ...(content?.id === undefined ? {} : { id: String(content.id) }),
    ...(content?.mimeType ? { mimeType: content.mimeType } : {}),
    type: raw._ || media.constructor?.name || 'media',
  };
}

function actionMetadata(message) {
  const raw = message.raw?.action;
  if (!message.isService && !raw) {
    return undefined;
  }
  return {
    ...(raw?.channelId === undefined
      ? {}
      : { channelId: serial(raw.channelId) }),
    ...(raw?.chatId === undefined ? {} : { chatId: serial(raw.chatId) }),
    type: raw?._ || message.action?.constructor?.name || 'service',
  };
}

export function normalizeMtcuteMessage(message, source) {
  const chat = message.chat || {};
  const reply = message.raw?.replyTo;
  return {
    action: actionMetadata(message),
    chat: {
      id: serial(chat.id),
      username: chat.username,
    },
    date:
      message.date instanceof Date ? message.date.toISOString() : message.date,
    editDate:
      message.editDate instanceof Date
        ? message.editDate.toISOString()
        : message.editDate,
    groupedId:
      message.groupedId === null || message.groupedId === undefined
        ? undefined
        : String(message.groupedId),
    id: message.id,
    isPinned: Boolean(message.isPinned),
    isService: Boolean(message.isService),
    media: mediaMetadata(message.media),
    sourceId: source.id,
    text: message.text || '',
    topicId:
      reply?.replyToTopId ??
      (message.isTopicMessage ? reply?.replyToMsgId : undefined),
    url: (() => {
      try {
        return message.link;
      } catch {
        return undefined;
      }
    })(),
  };
}

export class MtcuteTelegramProvider {
  constructor({
    apiHash,
    apiId,
    clientFactory = createMtcuteClient,
    expectedUserId,
    logger = console,
    session,
  } = {}) {
    this.apiHash = apiHash;
    this.apiId = apiId;
    this.capabilities = CAPABILITIES;
    this.clientFactory = clientFactory;
    this.expectedUserId = expectedUserId;
    this.logger = logger;
    this.session = session;
    this.transport = 'mtproto';
  }

  async #connect() {
    if (this.client) {
      return this.client;
    }
    const apiId = Number(this.apiId);
    if (
      !Number.isInteger(apiId) ||
      apiId < 1 ||
      !this.apiHash ||
      !this.session
    ) {
      throw new Error(
        'Telegram user credentials are required: TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_USER_SESSION.'
      );
    }
    const client = await this.clientFactory({ apiHash: this.apiHash, apiId });
    try {
      await client.start({ session: this.session });
      const me = await client.getMe();
      if (
        this.expectedUserId !== undefined &&
        String(me.id) !== String(this.expectedUserId)
      ) {
        throw new Error(
          `Telegram identity mismatch: expected ${this.expectedUserId}, received ${me.id}.`
        );
      }
      this.client = client;
      this.me = me;
      return client;
    } catch (error) {
      try {
        await client.destroy();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Telegram connection and cleanup both failed.'
        );
      }
      throw error;
    }
  }

  async identity() {
    await this.#connect();
    return { id: this.me.id, username: this.me.username };
  }

  async history(source, { since } = {}) {
    const client = await this.#connect();
    const peer = sourcePeer(source);
    await client.resolvePeer(peer, true);
    const iterator = client.iterHistory(peer);
    return (async function* () {
      for await (const message of iterator) {
        if (since && new Date(message.date) < since) {
          break;
        }
        yield normalizeMtcuteMessage(message, source);
      }
    })();
  }

  async resolveEntity(value) {
    return (await this.#connect()).resolvePeer(value, true);
  }

  async media(location, options) {
    return (await this.#connect()).downloadAsBuffer(location, options);
  }

  async membership(chatId, userId = 'me') {
    return (await this.#connect()).getChatMember({ chatId, userId });
  }

  async popularity(chatId) {
    const chat = await (await this.#connect()).getChat(chatId);
    return { members: chat.membersCount ?? chat.participantsCount ?? null };
  }

  async send(destination, message, options) {
    const sendOptions = { ...options };
    delete sendOptions.idempotencyKey;
    return (await this.#connect()).sendText(destination, message, sendOptions);
  }

  async liveUpdates(handler, { sources = [] } = {}) {
    const client = await this.#connect();
    const sourcesByHandle = new Map();
    const sourcesByPeer = new Map();
    for (const source of sources) {
      sourcesByHandle.set(sourceHandle(source), source);
      const resolved = await client.resolvePeer(sourcePeer(source), true);
      const id = peerId(resolved);
      if (id !== undefined) {
        sourcesByPeer.set(String(id), source);
      }
      const marked = markedPeerId(resolved);
      if (marked !== undefined) {
        sourcesByPeer.set(String(marked), source);
      }
    }
    const messageSource = (message) =>
      sourcesByHandle.get(String(message.chat?.username || '').toLowerCase()) ||
      sourcesByPeer.get(String(message.chat?.id));
    const dispatch = (event) => {
      const operation = Promise.resolve(handler(event));
      operation.catch((error) =>
        this.logger.error?.('MTProto update ingestion failed', {
          error: error.message,
          sourceId: event.sourceId,
          type: event.type,
        })
      );
      return operation;
    };
    const onNew = (message) => {
      const source = messageSource(message);
      return source
        ? dispatch({
            message: normalizeMtcuteMessage(message, source),
            sourceId: source.id,
            type: 'new',
          })
        : undefined;
    };
    const onEdit = (message) => {
      const source = messageSource(message);
      return source
        ? dispatch({
            message: normalizeMtcuteMessage(message, source),
            sourceId: source.id,
            type: 'edit',
          })
        : undefined;
    };
    const onDelete = (update) => {
      const source = sourcesByPeer.get(String(update.channelId));
      return source
        ? dispatch({
            messageIds: update.messageIds,
            sourceId: source.id,
            type: 'delete',
          })
        : undefined;
    };
    client.onNewMessage.add(onNew);
    client.onEditMessage.add(onEdit);
    client.onDeleteMessage.add(onDelete);
    return {
      stop: () => {
        client.onNewMessage.remove(onNew);
        client.onEditMessage.remove(onEdit);
        client.onDeleteMessage.remove(onDelete);
      },
    };
  }

  async destroy() {
    const client = this.client;
    this.client = undefined;
    this.me = undefined;
    await client?.destroy();
  }
}

export class TelegramIngestionService {
  constructor({
    logger = console,
    maxEvents = 10_000,
    now = () => new Date(),
    provider,
    rateProvider,
    rates = { VND: 1 },
    store,
  } = {}) {
    this.logger = logger;
    this.maxEvents = maxEvents;
    this.now = now;
    this.provider = provider;
    this.rateProvider = rateProvider;
    this.rates = rates;
    this.store = store;
    this.pending = Promise.resolve();
  }

  async #record(event) {
    const record = this.#eventRecord(event);
    await this.#mergeEvents([record]);
  }

  async #mergeEvents(records) {
    const merge = (existing) => {
      const byId = new Map(existing.map((record) => [record.id, record]));
      for (const record of records) {
        if (!byId.has(record.id)) {
          byId.set(record.id, record);
        }
      }
      return [...byId.values()].slice(-this.maxEvents);
    };
    if (typeof this.store.updateRecords === 'function') {
      await this.store.updateRecords('telegram-events', merge);
    } else {
      await this.store.saveRecords(
        'telegram-events',
        merge(await this.store.loadRecords('telegram-events'))
      );
    }
  }

  #eventRecord(event) {
    const eventTime = event.message?.editDate || event.message?.date || '';
    return {
      id: `${event.sourceId}:${event.type}:${(event.messageIds || [event.message?.id]).join(',')}:${eventTime}`,
      message: event.message,
      messageIds: event.messageIds,
      receivedAt: this.now().toISOString(),
      sourceId: event.sourceId,
      type: event.type,
    };
  }

  async #apply(event, rates) {
    await this.#record(event);
    const ids = event.messageIds || [event.message?.id].filter(Boolean);
    if (event.type === 'delete' || event.type === 'edit') {
      await this.store.deleteOffersByMessages(event.sourceId, ids);
    }
    if (event.type === 'delete' || event.message?.isService) {
      return;
    }
    const offer = parseTelegramOffer(event.message, {
      now: this.now(),
      rates,
    });
    if (Number.isFinite(offer?.priceVnd)) {
      offer.provenance = {
        editedAt: event.message.editDate,
        groupedId: event.message.groupedId,
        messageId: event.message.id,
        sourceId: event.sourceId,
        topicId: event.message.topicId,
        transport: 'mtproto',
      };
      await this.store.saveOffers([offer]);
    }
  }

  async start(sources) {
    if (this.subscription) {
      throw new Error('Telegram ingestion is already running.');
    }
    try {
      const rates = this.rateProvider
        ? await this.rateProvider.getRates()
        : this.rates;
      const cutoff = this.now();
      cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
      const backfill = [];
      const eventRecords = await this.store.loadRecords('telegram-events');
      const eventIds = new Set(eventRecords.map(({ id }) => id));
      for (const source of sources) {
        for await (const message of await this.provider.history(source, {
          since: cutoff,
        })) {
          const event = this.#eventRecord({
            message,
            sourceId: source.id,
            type: 'backfill',
          });
          if (!eventIds.has(event.id)) {
            eventIds.add(event.id);
            eventRecords.push(event);
          }
          const offer = parseTelegramOffer(message, {
            now: this.now(),
            rates,
          });
          if (Number.isFinite(offer?.priceVnd)) {
            offer.provenance = {
              editedAt: message.editDate,
              groupedId: message.groupedId,
              messageId: message.id,
              sourceId: source.id,
              topicId: message.topicId,
              transport: 'mtproto',
            };
            backfill.push(offer);
          }
        }
      }
      await this.#mergeEvents(eventRecords);
      await this.store.saveOffers(backfill);
      this.subscription = await this.provider.liveUpdates(
        (event) => {
          const operation = this.pending.then(() => this.#apply(event, rates));
          this.pending = operation.catch((error) =>
            this.logger.error?.('MTProto update persistence failed', {
              error: error.message,
              sourceId: event.sourceId,
              type: event.type,
            })
          );
          return operation;
        },
        { sources }
      );
      return { backfilled: backfill.length, sources: sources.length };
    } catch (error) {
      try {
        await this.provider.destroy();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Telegram ingestion startup and cleanup both failed.'
        );
      }
      throw error;
    }
  }

  async destroy() {
    const subscription = this.subscription;
    this.subscription = undefined;
    await settleCleanup(
      [
        () => subscription?.stop(),
        () => this.pending,
        () => this.provider.destroy(),
      ],
      'Telegram ingestion cleanup was incomplete.'
    );
  }
}
