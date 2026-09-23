import { setTimeout as delay } from 'node:timers/promises';

import {
  assembleTelegramAlbums,
  createDomainRecords,
  createSegmentLedger,
  parseTelegramOffer,
  reconcileTelegramMaterials,
  TraceRecorder,
} from '../src/index.js';

function floodWaitSeconds(error) {
  for (const value of [error?.seconds, error?.value]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  const match = String(error?.code || error?.message || '').match(
    /FLOOD_WAIT_?(\d+)/iu
  );
  return match ? Number(match[1]) : undefined;
}

export async function retryTelegramFloodWait(
  operation,
  { maxAttempts = 5, maxWaitSeconds = 300, sleep = delay } = {}
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const seconds = floodWaitSeconds(error);
      if (seconds === undefined || attempt === maxAttempts) {
        throw error;
      }
      if (seconds > maxWaitSeconds) {
        throw new Error(
          `Telegram flood wait ${seconds} seconds exceeds the ${maxWaitSeconds} second audit limit.`,
          { cause: error }
        );
      }
      await sleep(seconds * 1_000);
    }
  }
  throw new Error('Telegram flood-wait retry loop ended unexpectedly.');
}

function telegramDate(value) {
  if (value instanceof Date) {
    return value;
  }
  return new Date(
    typeof value === 'number' && value < 1e12 ? value * 1_000 : value
  );
}

export async function collectTelegramWindow({
  cutoff,
  iterate,
  maxMessages,
  offsetId: initialOffsetId,
  retry = {},
}) {
  const messages = [];
  let exhausted = false;
  let hitCap = false;
  let offsetId = initialOffsetId;
  let reachedCutoff = false;
  exhausted = await retryTelegramFloodWait(async () => {
    let endedNaturally = true;
    for await (const message of iterate({
      ...(offsetId === undefined ? {} : { offsetId }),
      limit: maxMessages - messages.length + 1,
    })) {
      const date = telegramDate(message.date);
      if (!Number.isFinite(date.getTime())) {
        const error = new Error('Telegram returned an invalid message date.');
        error.code = 'INVALID_MESSAGE_DATE';
        throw error;
      }
      if (date < cutoff) {
        reachedCutoff = true;
        endedNaturally = false;
        break;
      }
      if (messages.length >= maxMessages) {
        hitCap = true;
        endedNaturally = false;
        break;
      }
      messages.push(message);
      offsetId = message.id;
    }
    return endedNaturally;
  }, retry);
  return {
    exhausted,
    hitCap,
    messages,
    offsetId,
    reachedCutoff,
  };
}

export function sourceCompletion({
  error,
  exhausted = false,
  hitCap = false,
  reachedCutoff = false,
} = {}) {
  if (error) {
    return { pass: false, reason: 'source-read-error', state: 'error' };
  }
  if (hitCap) {
    return {
      pass: false,
      reason: 'message-cap-exhausted',
      state: 'incomplete',
    };
  }
  if (reachedCutoff || exhausted) {
    return {
      pass: true,
      reason: reachedCutoff
        ? 'rolling-window-complete'
        : 'source-history-exhausted',
      state: 'complete',
    };
  }
  return { pass: false, reason: 'scan-interrupted', state: 'incomplete' };
}

function materialType(material) {
  return material.id.startsWith('telegram-album:') ? 'album' : 'message';
}

function terminalCounts(accepted, reviewQueue) {
  const terminal = {
    accepted: accepted.length,
    degraded: 0,
    error: 0,
    excluded: 0,
    review: 0,
  };
  for (const item of reviewQueue) {
    if (Object.hasOwn(terminal, item.state)) {
      terminal[item.state] += 1;
    }
  }
  return terminal;
}

function materialRecords(materials, decisions, sourceAlias) {
  return materials.flatMap((material) => {
    const decision = decisions.get(material.id);
    return createDomainRecords({
      id: material.id,
      type: materialType(material),
      values: {
        mediaCount: material.mediaIds.length,
        messageIds: material.messageIds.map(String),
        source: `telegram:${sourceAlias}`,
        terminalReason: decision?.reason || 'accepted-offer',
        terminalState: decision?.state || 'accepted',
      },
    });
  });
}

function offerLedger(offer) {
  return createSegmentLedger(offer.text, ({ text }) => ({
    state:
      /(?:VND|VNĐ|₫|USD|EUR|GBP|rent|аренд|сда[её]т|cho\s+thuê|контакт|contact|liên\s+hệ|спальн|bedroom|phòng)/iu.test(
        text
      )
        ? 'mapped'
        : 'reviewed-unknown',
  }));
}

function offerRecords(offers, sourceAlias) {
  return offers.flatMap((offer) => [
    ...createDomainRecords({
      id: offer.id,
      type: 'offer',
      values: {
        contactTypes: Object.entries(offer.contacts || {})
          .filter(([, values]) => values.length)
          .map(([kind]) => kind),
        hasLocation: Boolean(offer.location),
        hasPrice: Boolean(offer.price),
        kind: offer.kind,
        source: `telegram:${sourceAlias}`,
      },
    }),
    ...createDomainRecords({
      id: `parser-run:${offer.id}`,
      type: 'parser-run',
      values: {
        ledger: offerLedger(offer),
        offerId: offer.id,
        source: `telegram:${sourceAlias}`,
      },
    }),
  ]);
}

function reconciliationTraces(materials, result, sourceAlias, now) {
  const recorder = new TraceRecorder({ now: () => new Date(now) });
  const decisions = new Map(result.reviewQueue.map((item) => [item.id, item]));
  const accepted = new Set(result.accepted.map((offer) => offer.raw?.id));
  for (const material of materials) {
    const decision = decisions.get(material.id);
    const status = accepted.has(material.id)
      ? 'success'
      : decision?.state === 'error'
        ? 'failure'
        : 'degraded';
    recorder.record({
      materialId: material.id,
      metadata: {
        reason: decision?.reason || 'accepted-offer',
        terminalState: decision?.state || 'accepted',
      },
      runId: `telegram-audit:${sourceAlias}:${material.id}`,
      sourceId: `telegram:${sourceAlias}`,
      stage: 'reconcile',
      status,
    });
  }
  return recorder.export().events.map((event) => ({
    ...event,
    id: `trace:${event.runId}:${event.sequence}`,
  }));
}

export async function auditTelegramBatch(
  messages,
  { now = new Date(), ocr, sourceAlias } = {}
) {
  if (!sourceAlias) {
    throw new TypeError(
      'A public source alias is required for an audit batch.'
    );
  }
  const materials = assembleTelegramAlbums(messages);
  const result = await reconcileTelegramMaterials(messages, {
    ocr,
    extract: (material) =>
      parseTelegramOffer(
        {
          chat: { username: sourceAlias },
          date: material.date || now,
          id: material.id,
          messageId: material.messageIds[0],
          photos: material.mediaIds,
          sourceId: `telegram:${sourceAlias}`,
          text: material.text,
        },
        { now }
      ),
  });
  const terminal = terminalCounts(result.accepted, result.reviewQueue);
  const terminalTotal = Object.values(terminal).reduce(
    (total, count) => total + count,
    0
  );
  const decisions = new Map(result.reviewQueue.map((item) => [item.id, item]));
  const segmentLedgers = result.accepted.map(offerLedger);
  return {
    domainRecords: [
      ...materialRecords(materials, decisions, sourceAlias),
      ...offerRecords(result.accepted, sourceAlias),
    ],
    materials: {
      terminal,
      total: materials.length,
      unaccounted: materials.length - terminalTotal,
    },
    offers: result.accepted,
    reviewQueue: result.reviewQueue,
    segments: segmentLedgers.reduce(
      (summary, { segments, summary: ledger }) => ({
        error: summary.error + ledger.error,
        mapped: summary.mapped + ledger.mapped,
        reviewedUnknown: summary.reviewedUnknown + ledger.reviewedUnknown,
        total: summary.total + segments.length,
      }),
      { error: 0, mapped: 0, reviewedUnknown: 0, total: 0 }
    ),
    traceRecords: reconciliationTraces(materials, result, sourceAlias, now),
  };
}

export async function verifyAuditStorage(
  store,
  records,
  kind = 'audit-records'
) {
  if (!records.length) {
    throw new Error('Typed storage verification requires audit records.');
  }
  await store.saveRecords(kind, records);
  const loaded = await store.loadRecords(kind);
  const roundTrip = JSON.stringify(loaded) === JSON.stringify(records);
  const first = records[0];
  const queried = await store.queryRecords(kind, {
    path: 'id',
    value: first?.id,
  });
  const query = queried.some(({ id }) => id === first?.id);
  await store.updateRecords(kind, (current) =>
    current.map((record, index) =>
      index === 0 ? { ...record, auditVerified: true } : record
    )
  );
  const edit = (await store.loadRecords(kind))[0]?.auditVerified === true;
  await store.updateRecords(kind, () => []);
  const deletion = (await store.loadRecords(kind)).length === 0;
  await store.saveRecords(kind, records);
  return { delete: deletion, edit, query, roundTrip };
}

export async function loadAuditCheckpoint(store, sourceAlias) {
  return (
    await store.queryRecords('audit-checkpoints', {
      path: 'id',
      value: sourceAlias,
    })
  )[0];
}

export async function saveAuditCheckpoint(store, checkpoint) {
  await store.updateRecords('audit-checkpoints', (current) => [
    ...current.filter(({ id }) => id !== checkpoint.id),
    checkpoint,
  ]);
}
