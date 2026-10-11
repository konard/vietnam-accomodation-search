import { diagnosticLogger } from './diagnostic-log.js';
import { telegramHistoryWindow } from './telegram-window.js';
import {
  createDomainRecords,
  createSemanticValue,
  validatePublicRecord,
} from './domain-graph.js';
import { parseTelegramOffer } from './telegram-parser.js';
import {
  assembleTelegramAlbums,
  reconcileTelegramMaterials,
} from './telegram-pipeline.js';
import { chronologyTimestamp } from './offer-chronology.js';
import { TraceRecorder, createSegmentLedger } from './trace.js';
import { settleCleanup, stableHash } from './utils.js';
import { pruneGraphReferences } from './telegram-retention.js';

export class TelegramIngestionService {
  constructor({
    logger = diagnosticLogger,
    historyDays = 90,
    since,
    ocr,
    maxEvents = 10_000,
    maxRecordBytes,
    backfillBatchSize = 250,
    mediaCache,
    now = () => new Date(),
    provider,
    rateProvider,
    rates = { VND: 1 },
    store,
    traceRecorder,
  } = {}) {
    this.logger = logger;
    this.maxEvents = maxEvents;
    this.historyDays = historyDays;
    this.since = since;
    this.ocr = ocr;
    this.maxRecordBytes = maxRecordBytes;
    if (!Number.isSafeInteger(backfillBatchSize) || backfillBatchSize < 1) {
      throw new TypeError('Backfill batch size must be a positive integer.');
    }
    this.backfillBatchSize = backfillBatchSize;
    this.mediaCache = mediaCache;
    this.now = now;
    this.provider = provider;
    this.rateProvider = rateProvider;
    this.rates = rates;
    this.store = store;
    this.trace =
      traceRecorder || new TraceRecorder({ maxEvents: 2_000, now, store });
    this.pending = Promise.resolve();
    this.retentionLoss = {};
    this.materialOffers = new Map();
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
      const merged = [...byId.values()];
      const retained = merged.slice(-this.maxEvents * 10);
      if (retained.length < merged.length) {
        this.retentionLoss[kind] = true;
      }
      return retained;
    };
    if (typeof this.store.appendRecords === 'function') {
      for (const record of records) {
        validatePublicRecord(record);
      }
      const retention = await this.store.appendRecords(
        kind,
        records,
        this.#appendBudget(this.maxEvents * 10)
      );
      if (retention?.dropped) {
        this.retentionLoss[kind] = true;
      }
    } else if (typeof this.store.updateRecords === 'function') {
      await this.store.updateRecords(kind, merge);
    } else {
      const existing = (await this.store.loadRecords?.(kind)) || [];
      await this.store.saveRecords(kind, merge(existing));
    }
  }

  async #persistRetentionLoss() {
    if (!Object.keys(this.retentionLoss).length) {
      return;
    }
    if (this.retentionLoss['domain-records']) {
      const graph = await this.store.loadRecords('domain-records');
      const retained = pruneGraphReferences(graph);
      if (retained.length < graph.length) {
        await this.store.saveRecords('domain-records', retained);
      }
    }
    const summary = {
      id: 'native-retention',
      complete: false,
      state: 'degraded',
      retentionLoss: this.retentionLoss,
      updatedAt: this.now().toISOString(),
    };
    await this.store.saveRecords('telegram-retentions', [summary]);
    const checkpoints =
      (await this.store.loadRecords('telegram-ingestion-checkpoints')) || [];
    const degraded = checkpoints.map((checkpoint) => ({
      ...checkpoint,
      complete: false,
      state: 'degraded',
      retentionLoss: this.retentionLoss,
    }));
    if (typeof this.store.appendRecords === 'function') {
      await this.store.appendRecords(
        'telegram-ingestion-checkpoints',
        degraded,
        this.#appendBudget(this.maxEvents * 10)
      );
    } else {
      await this.store.saveRecords('telegram-ingestion-checkpoints', degraded);
    }
  }

  // Append-only collections keep their newest records within a record count
  // and, when `maxRecordBytes` is set, a byte budget.
  #appendBudget(maxRecords) {
    return this.maxRecordBytes === undefined
      ? { maxRecords }
      : { maxBytes: this.maxRecordBytes, maxRecords };
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

  // eslint-disable-next-line complexity -- Caption identity and shared upload cache are resolved during extraction.
  async #materialOffer(
    material,
    rates,
    window = telegramHistoryWindow({
      now: this.now(),
      historyDays: this.historyDays,
      since: this.since,
    })
  ) {
    const cacheKey = stableHash(
      JSON.stringify({ material, rates, cutoff: window.since })
    );
    if (this.materialOffers.has(cacheKey)) {
      return this.materialOffers.get(cacheKey);
    }
    const offer = parseTelegramOffer(
      {
        ...material,
        messageId: material.captionMessageIds?.[0] || material.messageIds?.[0],
        photos: material.mediaIds || material.photos || [],
      },
      {
        now: window.now,
        since: window.since,
        historyDays: this.historyDays,
        rates,
      }
    );
    if (!Number.isFinite(offer?.priceVnd)) {
      return null;
    }
    offer.provenance = {
      editedAt: material.editDate,
      groupedId: material.groupedId,
      messageId:
        material.captionMessageIds?.[0] ??
        material.messageIds?.[0] ??
        material.id,
      messageIds: material.messageIds || [material.id],
      sourceId: material.sourceId,
      topicId: material.topicId,
      transport: 'mtproto',
    };
    if (material.mediaIds?.length && this.mediaCache) {
      await this.mediaCache.cacheTelegramPhotos(
        offer,
        material,
        this.provider,
        { signal: this.startSignal }
      );
    }
    this.materialOffers.set(cacheKey, offer);
    if (this.materialOffers.size > this.backfillBatchSize) {
      this.materialOffers.delete(this.materialOffers.keys().next().value);
    }
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
          ledger: createSegmentLedger(offer.raw?.text, ({ text }) => ({
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
      const merged = [...byId.values()];
      if (merged.length > this.maxEvents) {
        this.retentionLoss['telegram-events'] = true;
      }
      return merged.slice(-this.maxEvents);
    };
    if (typeof this.store.appendRecords === 'function') {
      const retention = await this.store.appendRecords(
        'telegram-events',
        records,
        {
          ...this.#appendBudget(this.maxEvents),
          replace: false,
        }
      );
      if (retention?.dropped) {
        this.retentionLoss['telegram-events'] = true;
      }
    } else if (typeof this.store.updateRecords === 'function') {
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
      await this.#persistRetentionLoss();
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
      ocr: this.ocr,
      signal: this.startSignal,
      extract: (material) => this.#materialOffer(material, rates),
      targetLocation: null,
    });
    const materialIds = materialMessages.map(({ id }) => id);
    await this.#removeGraphByMessages(event.sourceId, materialIds);
    await this.store.deleteOffersByMessages(event.sourceId, materialIds);
    if (result.accepted.length) {
      await this.store.saveOffers(result.accepted);
    }
    await this.#replaceReviews(
      event.sourceId,
      materialMessages,
      result.reviewQueue
    );
    for (const message of materialMessages) {
      await this.#appendRecords(
        'domain-records',
        this.#graphRecords({ ...event, message })
      );
    }
    for (const offer of result.accepted.length
      ? result.accepted
      : [undefined]) {
      await this.#appendRecords(
        'domain-records',
        this.#graphRecords(event, offer)
      );
    }
    await this.#persistRetentionLoss();
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

  async #replaceReviews(sourceId, messages, reviewQueue) {
    const materialIds = new Set(
      assembleTelegramAlbums(messages).map(({ id }) => id)
    );
    for (const message of messages) {
      const chat =
        message.chatId ?? message.chat?.id ?? message.sourceId ?? 'unknown';
      materialIds.add(`telegram-message:${chat}:${message.id}`);
      if (message.groupedId) {
        materialIds.add(`telegram-album:${chat}:${message.groupedId}`);
      }
    }
    const update = (records) =>
      records.filter(
        (record) =>
          record.sourceId !== sourceId ||
          ![...materialIds].some(
            (id) => record.id === id || record.id.startsWith(`${id}:`)
          )
      );
    if (typeof this.store.updateRecords === 'function') {
      await this.store.updateRecords('telegram-reviews', update);
    } else {
      await this.store.saveRecords(
        'telegram-reviews',
        update((await this.store.loadRecords('telegram-reviews')) || [])
      );
    }
    await this.#appendRecords(
      'telegram-reviews',
      reviewQueue.map((item) => ({ ...item, sourceId }))
    );
  }

  async #publishCurrentBatch(source, messages, rates, graphRecords) {
    const reconciliation = await reconcileTelegramMaterials(messages, {
      ocr: this.ocr,
      signal: this.startSignal,
      extract: (material) => this.#materialOffer(material, rates, this.window),
      targetLocation: source.focus === 'nha-trang' ? 'nha-trang' : null,
    });
    // A replay may contain an edited caption or more members of an album.
    // Replace the old material, including offers that are no longer eligible.
    await this.#removeGraphByMessages(
      source.id,
      messages.map(({ id }) => id)
    );
    await this.store.deleteOffersByMessages(
      source.id,
      messages.map(({ id }) => id)
    );
    await this.store.saveOffers(reconciliation.accepted);
    await this.#replaceReviews(source.id, messages, reconciliation.reviewQueue);
    graphRecords.length = 0;
    for (const message of messages) {
      graphRecords.push(
        ...this.#graphRecords({
          message,
          sourceId: source.id,
          type: 'backfill',
        })
      );
    }
    for (const offer of reconciliation.accepted) {
      graphRecords.push(
        ...this.#graphRecords(
          { message: offer.raw, sourceId: source.id, type: 'backfill' },
          offer
        )
      );
    }
    await this.#appendRecords('domain-records', graphRecords);
    graphRecords.length = 0;
    await this.#persistRetentionLoss();
    return reconciliation;
  }

  // eslint-disable-next-line complexity, max-lines-per-function, max-statements -- Startup owns incremental durable checkpoints, full coverage and live-subscription rollback.
  async start(sources, { signal } = {}) {
    this.startSignal = signal;
    this.materialOffers.clear();
    signal?.throwIfAborted();
    if (this.subscription) {
      throw new Error('Telegram ingestion is already running.');
    }
    try {
      const rates = this.rateProvider
        ? await this.rateProvider.getRates()
        : this.rates;
      this.window = telegramHistoryWindow({
        now: this.now(),
        historyDays: this.historyDays,
        since: this.since,
      });
      const cutoff = this.window.since;
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
      let observedEvents = eventRecords.length;
      const pendingEvents = [];
      const checkpoints = new Map(
        (
          (await this.store.loadRecords('telegram-ingestion-checkpoints')) || []
        ).map((checkpoint) => [checkpoint.id, checkpoint])
      );
      this.retentionLoss = {
        ...((await this.store.loadRecords('telegram-retentions')) || [])[0]
          ?.retentionLoss,
      };
      for (const source of sources.filter(
        (source) => source.enabled !== false
      )) {
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
        const sourceMessages = [
          ...new Map(
            (resume
              ? eventRecords
                  .filter(
                    ({ message, sourceId, type }) =>
                      sourceId === source.id &&
                      type === 'backfill' &&
                      message &&
                      (!message.date || new Date(message.date) >= cutoff)
                  )
                  .map(({ message }) => message)
              : []
            ).map((message) => [String(message.id), message])
          ).values(),
        ];
        const messageIndexes = new Map(
          sourceMessages.map(({ id }, index) => [String(id), index])
        );
        let oldestMessage = sourceMessages.reduce(
          (oldest, message) =>
            !oldest || new Date(message.date) < new Date(oldest.date)
              ? message
              : oldest,
          undefined
        );
        const batch = [];
        for await (const message of await this.provider.history(source, {
          ...(resume ? { resume } : {}),
          since: cutoff,
          signal,
        })) {
          signal?.throwIfAborted();
          const event = this.#eventRecord({
            message,
            sourceId: source.id,
            type: 'backfill',
          });
          if (!eventIds.has(event.id)) {
            eventIds.add(event.id);
            eventRecords.push(event);
            pendingEvents.push(event);
            observedEvents += 1;
            if (eventRecords.length > this.maxEvents) {
              eventRecords
                .splice(0, eventRecords.length - this.maxEvents)
                .forEach(({ id }) => eventIds.delete(id));
              this.retentionLoss['telegram-events'] = true;
            }
          }
          const messageId = String(message.id);
          const previousIndex = messageIndexes.get(messageId);
          const added = previousIndex === undefined;
          const edited =
            !added &&
            chronologyTimestamp(message.editDate) >
              chronologyTimestamp(sourceMessages[previousIndex].editDate);
          if (added) {
            messageIndexes.set(messageId, sourceMessages.length);
            sourceMessages.push(message);
            graphRecords.push(...this.#graphRecords(event));
            if (
              !oldestMessage ||
              new Date(message.date) < new Date(oldestMessage.date)
            ) {
              oldestMessage = message;
            }
          }
          if (edited) {
            sourceMessages[previousIndex] = message;
          }
          if (added || edited) {
            batch.push(message);
          }
          // Publish the current page immediately, including captionless album
          // members. Older history uses bounded batches with awaited writes.
          if (
            (added || edited) &&
            (sourceMessages.length <= 50 ||
              message.groupedId ||
              batch.length >= this.backfillBatchSize)
          ) {
            await this.#mergeEvents(pendingEvents);
            pendingEvents.length = 0;
            const groups = new Set(
              batch.map(({ groupedId }) => groupedId).filter(Boolean)
            );
            const current = [
              ...new Map(
                [
                  ...batch,
                  ...sourceMessages.filter((entry) =>
                    groups.has(entry.groupedId)
                  ),
                ].map((entry) => [String(entry.id), entry])
              ).values(),
            ];
            await this.#publishCurrentBatch(
              source,
              current,
              rates,
              graphRecords
            );
            batch.length = 0;
            await this.#appendRecords('telegram-ingestion-checkpoints', [
              {
                id: source.id,
                complete: false,
                historyComplete: false,
                cutoff: cutoff.toISOString(),
                messages: sourceMessages.length,
                oldestMessageDate: oldestMessage?.date,
                oldestMessageId: oldestMessage?.id,
                state: 'in-progress',
                updatedAt: this.now().toISOString(),
              },
            ]);
          }
          if (sourceMessages.length > this.maxEvents + this.backfillBatchSize) {
            sourceMessages.splice(0, this.backfillBatchSize);
            messageIndexes.clear();
            sourceMessages.forEach(({ id }, index) =>
              messageIndexes.set(String(id), index)
            );
            this.retentionLoss['working-messages'] = true;
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
            ocr: this.ocr,
            signal: this.startSignal,
            extract: (material) =>
              this.#materialOffer(material, rates, this.window),
            targetLocation: source.focus === 'nha-trang' ? 'nha-trang' : null,
          }
        );
        if (observedEvents > this.maxEvents) {
          reconciliation.complete = false;
          reconciliation.reviewQueue.push({
            id: `telegram-retention:${source.id}`,
            state: 'error',
            reason: 'rolling-window-retention-budget',
            messages: observedEvents,
            maxEvents: this.maxEvents,
          });
        }
        await this.#replaceReviews(
          source.id,
          sourceMessages,
          reconciliation.reviewQueue
        );
        backfill.push(...reconciliation.accepted);
        await this.#removeGraphByMessages(
          source.id,
          sourceMessages.map(({ id }) => id)
        );
        await this.store.deleteOffersByMessages(
          source.id,
          sourceMessages.map(({ id }) => id)
        );
        graphRecords.length = 0;
        for (const message of sourceMessages) {
          graphRecords.push(
            ...this.#graphRecords({
              message,
              sourceId: source.id,
              type: 'backfill',
            })
          );
        }
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
        await this.#mergeEvents(pendingEvents);
        pendingEvents.length = 0;
        await this.store.saveOffers(reconciliation.accepted);
        await this.#appendRecords('domain-records', graphRecords);
        graphRecords.length = 0;
        // Keep media evidence separate so a detailed audit cannot evict the
        // small resumable history checkpoint under a byte budget.
        await this.#appendRecords('telegram-media-checkpoints', [
          {
            id: source.id,
            ...reconciliation.mediaCoverage,
            updatedAt: this.now().toISOString(),
          },
        ]);
        await this.#appendRecords('telegram-ingestion-checkpoints', [
          {
            id: source.id,
            complete:
              reconciliation.complete &&
              !Object.keys(this.retentionLoss).length,
            historyComplete: true,
            cutoff: cutoff.toISOString(),
            messages: sourceMessages.length,
            ...(oldestMessage
              ? {
                  oldestMessageDate: oldestMessage.date,
                  oldestMessageId: oldestMessage.id,
                }
              : {}),
            state:
              reconciliation.complete && !Object.keys(this.retentionLoss).length
                ? 'complete'
                : 'degraded',
            updatedAt: this.now().toISOString(),
          },
        ]);
        await this.#persistRetentionLoss();
      }
      if (observedEvents > this.maxEvents) {
        const enabled = new Set(
          sources
            .filter((source) => source.enabled !== false)
            .map(({ id }) => id)
        );
        await this.#appendRecords(
          'telegram-ingestion-checkpoints',
          (await this.store.loadRecords('telegram-ingestion-checkpoints'))
            .filter(({ id }) => enabled.has(id))
            .map((checkpoint) => ({
              ...checkpoint,
              complete: false,
              state: 'degraded',
            }))
        );
      }
      await this.#mergeEvents(pendingEvents);
      await this.#appendRecords('domain-records', graphRecords);
      await this.#persistRetentionLoss();
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
        { sources: sources.filter((source) => source.enabled !== false) }
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
          'Telegram ingestion startup and cleanup both failed.',
          { cause: cleanupError }
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
