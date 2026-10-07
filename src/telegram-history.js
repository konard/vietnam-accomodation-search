import { telegramHistoryWindow } from './telegram-window.js';
import { parseTelegramOffer } from './telegram-parser.js';
import { reconcileTelegramMaterials } from './telegram-pipeline.js';

async function values(iterable) {
  const result = [];
  for await (const value of iterable) {
    result.push(value);
  }
  return result;
}

export class TelegramHistoryCollector {
  constructor({
    now = () => new Date(),
    historyDays = 90,
    since,
    ocr,
    store,
    rateProvider,
    rates = { VND: 1 },
    router,
  }) {
    this.now = now;
    this.historyDays = historyDays;
    this.since = since;
    this.rateProvider = rateProvider;
    this.rates = rates;
    this.router = router;
    this.ocr = ocr;
    this.store = store;
    this.reviewQueue = [];
  }

  // eslint-disable-next-line complexity -- One pass enforces cutoff, normalization, deduplication, and provenance together.
  async collect(sources) {
    const { now, since } = telegramHistoryWindow({
      now: this.now(),
      historyDays: this.historyDays,
      since: this.since,
    });
    const rates = this.rateProvider
      ? await this.rateProvider.getRates()
      : this.rates;
    const byMessage = new Map();
    for (const source of sources) {
      const history = await this.router.history(source, { since });
      for (const message of await values(history)) {
        const date = new Date(
          typeof message.date === 'number' ? message.date * 1000 : message.date
        );
        if (
          !Number.isFinite(date.getTime()) ||
          date < since ||
          message.deleted
        ) {
          continue;
        }
        const key = `${source.id}:${message.id ?? message.messageId}`;
        const previous = byMessage.get(key);
        if (
          !previous ||
          Number(message.editDate || 0) >= Number(previous.editDate || 0)
        ) {
          byMessage.set(key, { ...message, source });
        }
      }
    }
    const offers = [];
    this.reviewQueue = [];
    for (const source of sources) {
      const result = await reconcileTelegramMaterials(
        [...byMessage.values()].filter(
          (message) => message.source.id === source.id
        ),
        {
          ocr: this.ocr,
          targetLocation: source.focus === 'nha-trang' ? 'nha-trang' : null,
          extract: (message) => {
            const offer = parseTelegramOffer(
              {
                ...message,
                messageId:
                  message.captionMessageIds?.[0] || message.messageIds[0],
                photos: message.mediaIds,
                sourceId: source.id,
              },
              { now, since, rates }
            );
            if (!Number.isFinite(offer?.priceVnd)) {
              return null;
            }
            offer.provenance = {
              editedAt: message.editDate,
              groupedId: message.groupedId,
              messageIds: message.messageIds,
              relevance: message.relevance,
              sourceId: source.id,
              topicId: message.topicId,
              transport: 'mtproto',
            };
            return offer;
          },
        }
      );
      offers.push(...result.accepted);
      this.reviewQueue.push(
        ...result.reviewQueue.map((item) => ({ ...item, sourceId: source.id }))
      );
    }
    if (this.store?.appendRecords) {
      await this.store.appendRecords('telegram-reviews', this.reviewQueue);
    }
    return offers;
  }
}
