import {
  createDomainRecords,
  createSemanticValue,
  validatePublicRecord,
} from './domain-graph.js';
import { parseTelegramOffer } from './telegram-parser.js';
import { reconcileTelegramMaterials } from './telegram-pipeline.js';
import { SESSION_FORMAT, nativeSessionPayload } from './session-envelope.js';
import { retryTelegramOperation } from './telegram-errors.js';
import { createMtcuteClient } from './telegram-user.js';
import { TraceRecorder, createSegmentLedger } from './trace.js';
import { settleCleanup } from './utils.js';

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
    ...(source.location || source.focus === 'nha-trang'
      ? {
          inheritedLocation: source.location || 'Nha Trang, Vietnam',
          inheritedLocationSource: source.id,
        }
      : {}),
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
    sessionFormat = SESSION_FORMAT,
    discoveryFolders = ['Нячанг жильё'],
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
    const session = nativeSessionPayload(this.session, this.sessionFormat);
    const client = await this.clientFactory({ apiHash: this.apiHash, apiId });
    try {
      await client.start({
        session,
      });
      const me = await client.getMe();
      if (
        this.expectedUserId !== undefined &&
        String(me.id) !== String(this.expectedUserId)
      ) {
        throw new Error('Telegram identity mismatch.');
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

  // eslint-disable-next-line complexity -- MTProto discovery contains each optional Telegram search surface independently.
  async discover({ focus, queries = [], signal } = {}) {
    const client = await this.#connect();
    const candidates = [];
    candidates.failures = [];
    const addPeer = (peer, evidence) => {
      const entity = discoveryEntity(peer);
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
                addPeer(dialog.peer, { folder });
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
              addPeer(message.chat, {
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

  async history(source, { resume, since } = {}) {
    const client = await this.#connect();
    const peer = sourcePeer(source);
    await client.resolvePeer(peer, true);
    const checkpointId = Number(resume?.oldestMessageId);
    const checkpointDate = new Date(resume?.oldestMessageDate);
    const resumable =
      Number.isSafeInteger(checkpointId) &&
      checkpointId > 0 &&
      !Number.isNaN(checkpointDate.getTime());
    const iterators = resumable
      ? [
          client.iterHistory(peer, { minId: checkpointId }),
          client.iterHistory(peer, {
            offset: { date: checkpointDate, id: checkpointId },
          }),
        ]
      : [client.iterHistory(peer)];
    return (async function* () {
      const seen = new Set();
      for (const iterator of iterators) {
        for await (const message of iterator) {
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
    traceRecorder,
  } = {}) {
    this.logger = logger;
    this.maxEvents = maxEvents;
    this.now = now;
    this.provider = provider;
    this.rateProvider = rateProvider;
    this.rates = rates;
    this.store = store;
    this.trace =
      traceRecorder || new TraceRecorder({ maxEvents: 2_000, now, store });
    this.pending = Promise.resolve();
  }

  async #appendRecords(kind, records) {
    if (!records.length) {
      return;
    }
    const merge = (existing) => {
      const byId = new Map(existing.map((record) => [record.id, record]));
      for (const record of records) {
        validatePublicRecord(record);
        byId.set(record.id, record);
      }
      return [...byId.values()].slice(-this.maxEvents * 10);
    };
    if (typeof this.store.updateRecords === 'function') {
      await this.store.updateRecords(kind, merge);
    } else {
      const existing = (await this.store.loadRecords?.(kind)) || [];
      await this.store.saveRecords(kind, merge(existing));
    }
  }

  async #removeGraphByMessages(sourceId, messageIds) {
    const identifiers = new Set(messageIds.map(String));
    const remove = (existing) => {
      const linksBySubject = new Map();
      for (const record of existing) {
        if (record.type !== 'semantic-link') {
          continue;
        }
        const links = linksBySubject.get(record.subject) || [];
        links.push(record);
        linksBySubject.set(record.subject, links);
      }
      const removedSubjects = new Set();
      for (const [subject, links] of linksBySubject) {
        const belongsToSource = links.some(
          ({ object, predicate }) =>
            predicate.endsWith('.sourceId') && object === sourceId
        );
        const isSourceRawMaterial = links.some(
          ({ object, predicate }) =>
            predicate.endsWith('.eventId') &&
            String(object).startsWith(`telegram-event:${sourceId}:`)
        );
        const hasMessage = links.some(
          ({ object, predicate }) =>
            /\.messageIds?\.?(?:\d+)?$/u.test(predicate) &&
            identifiers.has(String(object))
        );
        if (hasMessage && (belongsToSource || isSourceRawMaterial)) {
          removedSubjects.add(subject);
        }
      }
      let changed = true;
      while (changed) {
        changed = false;
        const removedReferences = new Set(
          [...removedSubjects].flatMap((removed) => [
            removed,
            removed.replace(/^offer:/u, ''),
          ])
        );
        for (const [subject, links] of linksBySubject) {
          if (removedSubjects.has(subject)) {
            continue;
          }
          const referencesRemoved = links.some(({ object }) =>
            removedReferences.has(String(object))
          );
          if (referencesRemoved) {
            removedSubjects.add(subject);
            changed = true;
          }
        }
      }
      return existing.filter(
        (record) =>
          !removedSubjects.has(record.id) &&
          !removedSubjects.has(record.subject)
      );
    };
    if (typeof this.store.updateRecords === 'function') {
      await this.store.updateRecords('domain-records', remove);
    } else {
      await this.store.saveRecords(
        'domain-records',
        remove((await this.store.loadRecords?.('domain-records')) || [])
      );
    }
  }

  #materialOffer(material, rates) {
    const offer = parseTelegramOffer(
      { ...material, photos: material.mediaIds || material.photos || [] },
      { now: this.now(), rates }
    );
    if (!Number.isFinite(offer?.priceVnd)) {
      return null;
    }
    offer.provenance = {
      editedAt: material.editDate,
      groupedId: material.groupedId,
      messageId: material.messageIds?.[0] ?? material.id,
      messageIds: material.messageIds || [material.id],
      sourceId: material.sourceId,
      topicId: material.topicId,
      transport: 'mtproto',
    };
    return offer;
  }

  // eslint-disable-next-line complexity, max-lines-per-function -- Graph projection keeps every event/offer relationship in one deterministic record set.
  #graphRecords(event, offer) {
    const message = event.message;
    const messageId = message?.id ?? event.messageIds?.join(',');
    const recordId = `telegram-event:${event.sourceId}:${event.type}:${messageId}`;
    const eventType =
      event.type === 'delete'
        ? 'deletion'
        : event.type === 'edit'
          ? 'edit'
          : 'message';
    const records = createDomainRecords({
      id: recordId,
      type: eventType,
      values: {
        eventType: event.type,
        groupedId: message?.groupedId,
        messageId,
        sourceId: event.sourceId,
        state: createSemanticValue(
          event.type === 'delete' ? 'deleted' : 'known',
          event.type
        ),
        topicId: message?.topicId,
      },
    });
    records.push(
      ...createDomainRecords({
        id: 'transport:mtproto',
        type: 'transport',
        values: { library: 'mtcute', protocol: 'mtproto' },
      }),
      ...createDomainRecords({
        id: `community:${event.sourceId}`,
        type: 'community',
        values: {
          sourceId: event.sourceId,
          transportId: 'transport:mtproto',
        },
      }),
      ...createDomainRecords({
        id: `raw-material:${event.sourceId}:${messageId}`,
        type: 'raw-material',
        values: {
          eventId: recordId,
          messageId,
          observedAt: message?.editDate || message?.date,
          transportId: 'transport:mtproto',
        },
      })
    );
    if (message?.groupedId) {
      records.push(
        ...createDomainRecords({
          id: `album:${event.sourceId}:${message.groupedId}`,
          type: 'album',
          values: {
            groupedId: message.groupedId,
            messageId,
            sourceId: event.sourceId,
          },
        })
      );
    }
    if (message?.media?.id) {
      records.push(
        ...createDomainRecords({
          id: `media:${event.sourceId}:${message.media.id}`,
          type: 'media',
          values: {
            messageId,
            mimeType: message.media.mimeType,
            remoteId: message.media.id,
            sourceId: event.sourceId,
          },
        })
      );
    }
    if (!offer) {
      return records;
    }
    const location = offer.location
      ? createSemanticValue(
          offer.locationProvenance?.method === 'source-inherited'
            ? 'inherited'
            : 'known',
          offer.location,
          offer.locationProvenance
        )
      : createSemanticValue('not-mentioned');
    records.push(
      ...createDomainRecords({
        id: `offer:${offer.id}`,
        type: 'offer',
        values: {
          attributes: offer.attributes,
          contacts: offer.contacts,
          intent: createSemanticValue('known', offer.intent),
          kind: createSemanticValue('known', offer.kind),
          location,
          messageIds: offer.provenance.messageIds,
          price: createSemanticValue('known', offer.price, {
            normalizedVnd: offer.priceVnd,
          }),
          sourceId: offer.sourceId,
        },
      }),
      ...createDomainRecords({
        id: `property:${offer.id}`,
        type: 'property',
        values: {
          aliases: offer.identifiers,
          attributes: offer.attributes,
          kind: createSemanticValue('known', offer.kind, {
            sourceMessage: recordId,
          }),
          location,
          offerId: `offer:${offer.id}`,
        },
      }),
      ...createDomainRecords({
        id: `price:${offer.id}:${offer.collectedAt || message?.editDate || message?.date || 'unknown'}`,
        type: 'price',
        values: {
          amount: offer.price?.amount,
          billingPeriod: offer.price?.period,
          currency: offer.price?.currency,
          normalizedVnd: offer.priceVnd,
          offerId: `offer:${offer.id}`,
          sourceMessage: recordId,
        },
      }),
      ...Object.entries(offer.contacts || {})
        .flatMap(([method, values]) =>
          (Array.isArray(values) ? values : [values]).map((value, index) =>
            createDomainRecords({
              id: `contact:${offer.id}:${method}:${index}`,
              type: 'contact',
              values: {
                method,
                offerId: `offer:${offer.id}`,
                retention: 'local-listing-lifetime',
                sourceMessage: recordId,
                value,
              },
            })
          )
        )
        .flat(),
      ...createDomainRecords({
        id: `parser-run:${offer.id}`,
        type: 'parser-run',
        values: {
          ledger: createSegmentLedger(offer.text, ({ text }) => ({
            state:
              /(?:VND|VNĐ|₫|USD|EUR|GBP|rent|аренд|сда[её]т|cho\s+thuê|контакт|contact|liên\s+hệ|спальн|bedroom|phòng)/iu.test(
                text
              )
                ? 'mapped'
                : 'reviewed-unknown',
          })),
          offerId: offer.id,
        },
      })
    );
    return records;
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

  #eventRunId(event) {
    return `telegram:${event.sourceId}:${event.type}:${event.message?.id ?? event.messageIds?.join(',')}`;
  }

  async #apply(event, rates) {
    try {
      return await this.#applyEvent(event, rates);
    } catch (error) {
      this.trace.record({
        runId: this.#eventRunId(event),
        stage: 'reconcile',
        status:
          error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
            ? 'cancelled'
            : 'failure',
        metadata: { code: error?.code, message: error?.message },
      });
      try {
        await this.trace.persist();
      } catch (traceError) {
        this.logger.debug?.('Telegram failure trace persistence failed', {
          error: traceError.message,
        });
      }
      throw error;
    }
  }

  // eslint-disable-next-line complexity -- Event reconciliation records every terminal trace state at the transactional boundary.
  async #applyEvent(event, rates) {
    const runId = this.#eventRunId(event);
    this.trace.record({
      runId,
      stage: 'reconcile',
      status: 'start',
      sourceId: event.sourceId,
    });
    await this.#record(event);
    const ids = event.messageIds || [event.message?.id].filter(Boolean);
    if (event.type === 'delete' || event.type === 'edit') {
      await this.#removeGraphByMessages(event.sourceId, ids);
      await this.store.deleteOffersByMessages(event.sourceId, ids);
    }
    if (event.type === 'delete' || event.message?.isService) {
      await this.#appendRecords('domain-records', this.#graphRecords(event));
      this.trace.record({
        runId,
        stage: 'reconcile',
        status: 'success',
        metadata: { outcome: event.type === 'delete' ? 'deleted' : 'service' },
      });
      await this.trace.persist();
      return;
    }
    const storedEvents = await this.store.loadRecords('telegram-events');
    let materialMessages = [event.message];
    if (event.message?.groupedId) {
      const liveMembers = new Map();
      for (const stored of storedEvents.filter(
        ({ sourceId }) => sourceId === event.sourceId
      )) {
        for (const deletedId of stored.messageIds || []) {
          liveMembers.delete(String(deletedId));
        }
        if (stored.message?.groupedId === event.message.groupedId) {
          liveMembers.set(String(stored.message.id), stored.message);
        }
      }
      materialMessages = [...liveMembers.values()];
    }
    const result = await reconcileTelegramMaterials(materialMessages, {
      extract: (material) => this.#materialOffer(material, rates),
      targetLocation: null,
    });
    const offer = result.accepted[0];
    if (offer) {
      await this.store.saveOffers([offer]);
    }
    await this.#appendRecords(
      'domain-records',
      this.#graphRecords(event, offer)
    );
    this.trace.record({
      runId,
      stage: 'reconcile',
      status: result.complete ? 'success' : 'degraded',
      metadata: {
        accepted: result.accepted.length,
        reviewQueue: result.reviewQueue,
      },
    });
    await this.trace.persist();
  }

  // eslint-disable-next-line complexity, max-lines-per-function, max-statements -- Startup is the atomic backfill/checkpoint/live-subscription transaction and owns rollback.
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
      const graphRecords = [];
      const loadedEvents = await this.store.loadRecords('telegram-events');
      const eventRecords = loadedEvents.filter(
        ({ message }) => !message?.date || new Date(message.date) >= cutoff
      );
      if (eventRecords.length !== loadedEvents.length) {
        const staleMessagesBySource = new Map();
        for (const event of loadedEvents.filter(
          ({ message }) => message?.date && new Date(message.date) < cutoff
        )) {
          const identifiers = staleMessagesBySource.get(event.sourceId) || [];
          identifiers.push(
            ...(event.messageIds || [event.message?.id]).filter(
              (identifier) => identifier !== undefined
            )
          );
          staleMessagesBySource.set(event.sourceId, identifiers);
        }
        for (const [sourceId, identifiers] of staleMessagesBySource) {
          await this.#removeGraphByMessages(sourceId, identifiers);
        }
        if (typeof this.store.updateRecords === 'function') {
          await this.store.updateRecords('telegram-events', () => eventRecords);
        } else {
          await this.store.saveRecords('telegram-events', eventRecords);
        }
      }
      const eventIds = new Set(eventRecords.map(({ id }) => id));
      const checkpoints = new Map(
        (
          (await this.store.loadRecords('telegram-ingestion-checkpoints')) || []
        ).map((checkpoint) => [checkpoint.id, checkpoint])
      );
      for (const source of sources) {
        this.trace.record({
          runId: `telegram-backfill:${source.id}`,
          stage: 'history',
          status: 'start',
          sourceId: source.id,
        });
        const checkpoint = checkpoints.get(source.id);
        const resume =
          checkpoint?.complete === false &&
          checkpoint.oldestMessageId !== undefined &&
          checkpoint.oldestMessageDate
            ? {
                oldestMessageDate: checkpoint.oldestMessageDate,
                oldestMessageId: checkpoint.oldestMessageId,
              }
            : undefined;
        const sourceMessages = resume
          ? eventRecords
              .filter(
                ({ message, sourceId, type }) =>
                  sourceId === source.id &&
                  type === 'backfill' &&
                  message &&
                  (!message.date || new Date(message.date) >= cutoff)
              )
              .map(({ message }) => message)
          : [];
        const sourceMessageIds = new Set(
          sourceMessages.map(({ id }) => String(id))
        );
        let oldestMessage = sourceMessages.reduce(
          (oldest, message) =>
            !oldest || new Date(message.date) < new Date(oldest.date)
              ? message
              : oldest,
          undefined
        );
        for await (const message of await this.provider.history(source, {
          ...(resume ? { resume } : {}),
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
          const messageId = String(message.id);
          const added = !sourceMessageIds.has(messageId);
          if (added) {
            sourceMessageIds.add(messageId);
            sourceMessages.push(message);
            graphRecords.push(...this.#graphRecords(event));
            if (
              !oldestMessage ||
              new Date(message.date) < new Date(oldestMessage.date)
            ) {
              oldestMessage = message;
            }
          }
          if (added && sourceMessages.length % 250 === 0) {
            await this.#mergeEvents(eventRecords);
            await this.#appendRecords('telegram-ingestion-checkpoints', [
              {
                id: source.id,
                complete: false,
                cutoff: cutoff.toISOString(),
                messages: sourceMessages.length,
                oldestMessageDate: oldestMessage?.date,
                oldestMessageId: oldestMessage?.id,
                state: 'in-progress',
                updatedAt: this.now().toISOString(),
              },
            ]);
          }
        }
        this.trace.record({
          runId: `telegram-backfill:${source.id}`,
          stage: 'history',
          status: 'success',
          sourceId: source.id,
          metadata: { messages: sourceMessages.length },
        });
        this.trace.record({
          runId: `telegram-backfill:${source.id}`,
          stage: 'reconcile',
          status: 'start',
          sourceId: source.id,
        });
        const reconciliation = await reconcileTelegramMaterials(
          sourceMessages,
          {
            extract: (material) => this.#materialOffer(material, rates),
            targetLocation: source.focus === 'nha-trang' ? 'nha-trang' : null,
          }
        );
        backfill.push(...reconciliation.accepted);
        for (const offer of reconciliation.accepted) {
          graphRecords.push(
            ...this.#graphRecords(
              {
                message: offer.raw,
                sourceId: source.id,
                type: 'backfill',
              },
              offer
            )
          );
        }
        this.trace.record({
          runId: `telegram-backfill:${source.id}`,
          stage: 'reconcile',
          status: reconciliation.complete ? 'success' : 'degraded',
          sourceId: source.id,
          metadata: {
            accepted: reconciliation.accepted.length,
            reviewQueue: reconciliation.reviewQueue,
          },
        });
        await this.#mergeEvents(eventRecords);
        await this.store.saveOffers(reconciliation.accepted);
        await this.#appendRecords('domain-records', graphRecords);
        graphRecords.length = 0;
        await this.#appendRecords('telegram-ingestion-checkpoints', [
          {
            id: source.id,
            complete: reconciliation.complete,
            cutoff: cutoff.toISOString(),
            messages: sourceMessages.length,
            ...(oldestMessage
              ? {
                  oldestMessageDate: oldestMessage.date,
                  oldestMessageId: oldestMessage.id,
                }
              : {}),
            state: reconciliation.complete ? 'complete' : 'degraded',
            updatedAt: this.now().toISOString(),
          },
        ]);
      }
      await this.#mergeEvents(eventRecords);
      await this.#appendRecords('domain-records', graphRecords);
      await this.trace.persist();
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
      this.trace.record({
        runId: 'telegram-backfill:startup',
        stage: 'history',
        status:
          error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
            ? 'cancelled'
            : 'failure',
        metadata: { code: error?.code, message: error?.message },
      });
      try {
        await this.trace.persist();
      } catch (traceError) {
        this.logger.debug?.('Telegram startup trace persistence failed', {
          error: traceError.message,
        });
      }
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
