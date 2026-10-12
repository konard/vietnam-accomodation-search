import { retryNativePhoto } from './telegram-photo-retry.js';
import { diagnosticLogger } from './diagnostic-log.js';
import { resilientTelegramHistory } from './telegram-iterate.js';
import { SESSION_FORMAT, nativeSessionPayload } from './session-envelope.js';
import { retryTelegramOperation } from './telegram-errors.js';
import { createMtcuteClient } from './telegram-user.js';
import { scalarId } from './offer-bounds.js';
import { normalizeTextEntities } from './telegram-text-entities.js';
import { downloadBoundedPhoto } from './telegram-photo-download.js';
import { untilAborted } from './browser-adapters.js';
import { TelegramPhotoScheduler } from './telegram-photo-scheduler.js';
import {
  acquireTelegramClient,
  openTelegramClient,
} from './telegram-client-pool.js';

const CAPABILITIES = new Set([
  'discovery',
  'history',
  'identity',
  'liveUpdates',
  'media',
  'membership',
  'popularity',
  'resolveEntity',
  'send',
]);

function discoveryEntity(peer) {
  // mtcute deliberately exposes the peer discriminator without touching any
  // identity fields. Keep this check first: User getters must never be read.
  if (!peer || peer.type === 'user') {
    return { _: 'user' };
  }
  if (peer.type !== 'chat') {
    return { _: 'unsupported' };
  }
  const channel = peer.chatType !== 'group';
  return {
    _: channel ? 'channel' : 'chat',
    id: peer.id,
    megagroup: peer.chatType === 'supergroup',
    participantsCount: peer.membersCount,
    title: peer.title,
    username: peer.username,
  };
}

function sourcePeer(source) {
  const peerId = source.peerId || source.telegram?.peerId;
  const username = source.username || source.telegram?.username;
  if (peerId || username) {
    return peerId || username;
  }
  const numeric = source.id.match(/^telegram:(?:peer:)?(-?\d+)$/u);
  if (numeric) {
    return Number(numeric[1]);
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
  const content = raw.photo || raw.document || raw.webpage || raw;
  const id = scalarId(content.id) || scalarId(media.id);
  return {
    ...(id === undefined ? {} : { id }),
    ...(typeof content.mimeType === 'string'
      ? { mimeType: content.mimeType.slice(0, 256) }
      : {}),
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

// eslint-disable-next-line complexity -- SDK optional fields are normalized into bounded scalar metadata.
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
    ...(source.location || source.focus === 'nha-trang'
      ? {
          inheritedLocation: source.location || 'Nha Trang, Vietnam',
          inheritedLocationSource: source.id,
        }
      : {}),
    id: message.id,
    entities: normalizeTextEntities(
      message.text || '',
      message.raw?.entities || message.entities
    ),
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
    logger = diagnosticLogger,
    session,
    sessionFormat = SESSION_FORMAT,
    discoveryFolders = ['Нячанг жильё'],
    photoScheduler = new TelegramPhotoScheduler(),
    mediaRetries,
  } = {}) {
    this.apiHash = apiHash;
    this.apiId = apiId;
    this.capabilities = CAPABILITIES;
    this.clientFactory = clientFactory;
    this.expectedUserId = expectedUserId;
    this.discoveryFolders = discoveryFolders;
    this.logger = logger;
    this.session = session;
    this.sessionFormat = sessionFormat;
    this.transport = 'mtproto';
    this.photoScheduler = photoScheduler;
    this.mediaRetries = mediaRetries;
    this.subscriptions = new Set();
    this.registrations = new Set();
  }

  #connect() {
    if (this.destroying) {
      return this.destroying.then(() => this.#connect());
    }
    if (!this.connecting) {
      this.connecting = this.#open();
      this.connecting.catch(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  async #open() {
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
    const session = nativeSessionPayload(this.session, this.sessionFormat);
    const lease = await acquireTelegramClient(
      this.clientFactory,
      [apiId, this.apiHash, session],
      () => this.#openClient(apiId, session)
    );
    const { client } = lease;
    try {
      const me = lease.me || (await client.getMe());
      if (
        this.expectedUserId !== undefined &&
        String(me.id) !== String(this.expectedUserId)
      ) {
        throw new Error('Telegram identity mismatch.');
      }
      this.client = client;
      this.me = me;
      this.lease = lease;
      return client;
    } catch (error) {
      try {
        await lease.release();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Telegram connection and cleanup both failed.',
          { cause: cleanupError }
        );
      }
      throw error;
    }
  }

  #openClient(apiId, session) {
    return openTelegramClient(
      this.clientFactory,
      {
        apiHash: this.apiHash,
        apiId,
        logger: this.logger,
      },
      async (client) => {
        await client.start({ session });
        return client.getMe();
      }
    );
  }

  async identity() {
    await this.#connect();
    return { id: this.me.id, username: this.me.username };
  }

  // eslint-disable-next-line complexity -- MTProto discovery contains each optional Telegram search surface independently.
  async discover({ focus, queries = [], signal } = {}) {
    const client = await this.#connect();
    const candidates = [];
    candidates.failures = [];
    const memberCounts = new Map();
    const addPeer = async (peer, evidence) => {
      const entity = discoveryEntity(peer);
      if (
        entity.username &&
        (entity.participantsCount === null ||
          entity.participantsCount === undefined)
      ) {
        if (!memberCounts.has(entity.id)) {
          memberCounts.set(
            entity.id,
            await this.#chatMembers(client, peer, peer.id)
          );
        }
        entity.participantsCount = memberCounts.get(entity.id);
      }
      candidates.push({ entity, evidence, transport: this.transport });
    };
    if (focus === 'nha-trang') {
      for (const folder of this.discoveryFolders) {
        try {
          await retryTelegramOperation(
            async () => {
              for await (const dialog of client.iterDialogs({
                folder,
                limit: 200,
              })) {
                if (signal?.aborted) {
                  throw (
                    signal.reason || new Error('Telegram discovery cancelled.')
                  );
                }
                await addPeer(dialog.peer, { folder });
              }
            },
            {
              idempotent: true,
              logger: this.logger,
              maxAttempts: 3,
              operationName: 'mtproto-folder-discovery',
              signal,
              sourceId: folder,
              transport: this.transport,
            }
          );
        } catch (error) {
          if (signal?.aborted) {
            throw error;
          }
          this.logger.debug?.('Telegram folder discovery failed', {
            error: error.message,
            folder,
          });
          candidates.failures.push({
            reason: error?.code || 'folder-unavailable',
          });
        }
      }
    }
    for (const query of queries) {
      try {
        await retryTelegramOperation(
          async () => {
            for await (const message of client.iterSearchGlobal({
              limit: 50,
              query: query.text,
            })) {
              if (signal?.aborted) {
                throw (
                  signal.reason || new Error('Telegram discovery cancelled.')
                );
              }
              await addPeer(message.chat, {
                language: query.language,
                queryId: query.id,
              });
            }
          },
          {
            idempotent: true,
            logger: this.logger,
            maxAttempts: 3,
            operationName: 'mtproto-global-discovery',
            signal,
            sourceId: query.id,
            transport: this.transport,
          }
        );
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        candidates.failures.push({
          queryId: query.id,
          reason: error?.code || 'global-search-unavailable',
        });
      }
    }
    return candidates;
  }

  async history(source, { resume, since, signal, retry = {} } = {}) {
    const client = await this.#connect();
    const peer = sourcePeer(source);
    try {
      await retryTelegramOperation(() => client.resolvePeer(peer, true), {
        logger: this.logger,
        operationName: 'source-resolution',
        sourceId: source.id,
        transport: this.transport,
        maxAttempts: 3,
        maxElapsedMs: 15000,
        ...retry,
        signal,
        idempotent: true,
      });
    } catch (error) {
      error.qaPhase = 'source-resolution';
      error.qaSourceId = source.id;
      throw error;
    }
    if (source.access === 'public-preview' || source.public === true) {
      let chat;
      try {
        chat = await retryTelegramOperation(() => client.getChat(peer), {
          logger: this.logger,
          operationName: 'source-resolution',
          sourceId: source.id,
          transport: this.transport,
          maxAttempts: 3,
          maxElapsedMs: 15000,
          ...retry,
          signal,
          idempotent: true,
        });
      } catch (error) {
        error.qaPhase = 'source-resolution';
        error.qaSourceId = source.id;
        throw error;
      }
      if (
        chat.type !== 'chat' ||
        !['channel', 'supergroup'].includes(chat.chatType) ||
        !chat.username
      ) {
        const error = new Error(
          'Declared public Telegram source does not resolve to a public community.'
        );
        error.code = 'PUBLIC_SOURCE_NOT_COMMUNITY';
        error.qaPhase = 'source-resolution';
        error.qaSourceId = source.id;
        throw error;
      }
    }
    const checkpointId = Number(resume?.oldestMessageId);
    const checkpointDate = new Date(resume?.oldestMessageDate);
    const resumable =
      Number.isSafeInteger(checkpointId) &&
      checkpointId > 0 &&
      !Number.isNaN(checkpointDate.getTime());
    const iterators = resumable
      ? [
          { minId: checkpointId },
          {
            offset: {
              date: Math.floor(checkpointDate.getTime() / 1000),
              id: checkpointId,
            },
          },
        ]
      : [{}];
    const retryOptions = {
      logger: this.logger,
      operationName: 'history-page',
      sourceId: source.id,
      transport: 'mtproto',
      signal,
      ...retry,
    };
    return (async function* () {
      const seen = new Set();
      for (const options of iterators) {
        for await (const message of resilientTelegramHistory(
          (opts) => client.iterHistory(peer, opts),
          options,
          retryOptions
        )) {
          if (since && new Date(message.date) < since) {
            break;
          }
          const id = String(message.id);
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          yield normalizeMtcuteMessage(message, source);
        }
      }
    })();
  }

  async resolveEntity(value) {
    return (await this.#connect()).resolvePeer(value, true);
  }

  async media(location, options) {
    return (await this.#connect()).downloadAsBuffer(location, options);
  }

  photo(mediaId, options = {}) {
    return retryNativePhoto(this.mediaRetries, mediaId, options, () =>
      this.#downloadPhoto(mediaId, options)
    );
  }

  // eslint-disable-next-line complexity -- Native identity, size and deadline validation precede the shared download queue.
  async #downloadPhoto(
    mediaId,
    { material, signal, maxBytes = 16 * 1024 * 1024, timeoutMs = 15000 } = {}
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new TypeError('Photo byte budget must be a positive integer.');
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    const operationSignal = signal
      ? AbortSignal.any([signal, deadline])
      : deadline;
    const member = material?.members?.find(
      (message) => String(message.media?.id) === String(mediaId)
    );
    if (!member) {
      throw Object.assign(new Error('OCR photo reference is unavailable.'), {
        code: 'OCR_MEDIA_UNAVAILABLE',
      });
    }
    const client = await untilAborted(this.#connect(), operationSignal);
    const media = await this.photoScheduler.resolve(
      `${member.sourceId}:${member.id}:${mediaId}`,
      async () => {
        const [message] = await client.getMessages(
          sourcePeer({ id: member.sourceId }),
          Number(member.id)
        );
        return message?.media;
      },
      { signal: operationSignal }
    );
    if (!media || media.type !== 'photo') {
      throw Object.assign(new Error('OCR media is not a photo.'), {
        code: 'OCR_MEDIA_UNSUPPORTED',
      });
    }
    if (media.fileSize > maxBytes) {
      throw Object.assign(new Error('OCR photo exceeds the download budget.'), {
        code: 'OCR_INPUT_BUDGET',
      });
    }
    const currentId = mediaMetadata(media)?.id;
    if (currentId && currentId !== String(mediaId)) {
      throw Object.assign(
        new Error('Native photo identity changed since ingestion.'),
        { code: 'OCR_MEDIA_CHANGED' }
      );
    }
    return this.photoScheduler.run(
      () =>
        downloadBoundedPhoto(client, media, {
          signal: operationSignal,
          maxBytes,
        }),
      { signal: operationSignal }
    );
  }

  async membership(chatId, userId = 'me') {
    return (await this.#connect()).getChatMember({ chatId, userId });
  }

  async popularity(chatId) {
    const client = await this.#connect();
    const chat = await client.getChat(chatId);
    return { members: await this.#chatMembers(client, chat, chatId) };
  }

  async #chatMembers(client, chat, chatId) {
    const members = chat.membersCount ?? chat.participantsCount;
    if (members !== null && members !== undefined) {
      return members;
    }
    try {
      const full = await client.getFullChat(chatId);
      return full.membersCount ?? full.participantsCount ?? null;
    } catch {
      return null;
    }
  }

  async send(destination, message, options) {
    const sendOptions = { ...options };
    delete sendOptions.idempotencyKey;
    return (await this.#connect()).sendText(destination, message, sendOptions);
  }

  async liveUpdates(handler, { sources = [], signal } = {}) {
    if (this.destroying) {
      await this.destroying;
      return this.liveUpdates(handler, { sources, signal });
    }
    const registration = this.#registerLiveUpdates(handler, sources, signal);
    this.registrations.add(registration);
    try {
      return await registration;
    } finally {
      this.registrations.delete(registration);
    }
  }

  async #registerLiveUpdates(handler, sources, signal) {
    const client = await this.#connect();
    const sourcesByHandle = new Map();
    const sourcesByPeer = new Map();
    for (const source of sources) {
      sourcesByHandle.set(sourceHandle(source), source);
      let resolved;
      try {
        resolved = await retryTelegramOperation(
          () => client.resolvePeer(sourcePeer(source), true),
          {
            logger: this.logger,
            operationName: 'source-resolution',
            sourceId: source.id,
            transport: this.transport,
            maxAttempts: 3,
            maxElapsedMs: 15000,
            signal,
            idempotent: true,
          }
        );
      } catch (error) {
        error.qaPhase = 'source-resolution';
        error.qaSourceId = source.id;
        throw error;
      }
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
    const subscription = {
      stop: () => {
        client.onNewMessage.remove(onNew);
        client.onEditMessage.remove(onEdit);
        client.onDeleteMessage.remove(onDelete);
        this.subscriptions.delete(subscription);
      },
    };
    this.subscriptions.add(subscription);
    return subscription;
  }

  destroy() {
    return (this.destroying ||= this.#close().finally(() => {
      this.destroying = undefined;
    }));
  }

  async #close() {
    await this.connecting?.catch(() => {});
    await Promise.allSettled([...this.registrations]);
    this.connecting = undefined;
    this.photoScheduler.resolved.clear();
    for (const subscription of this.subscriptions) {
      subscription.stop();
    }
    const lease = this.lease;
    this.lease = undefined;
    this.client = undefined;
    this.me = undefined;
    await lease?.release();
  }
}

export { TelegramIngestionService } from './telegram-ingestion.js';
