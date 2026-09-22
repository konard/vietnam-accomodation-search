import { parseTelegramOffer } from './telegram-parser.js';
import {
  assembleTelegramAlbums,
  classifyTelegramPost,
} from './telegram-pipeline.js';

function twoMonthsBefore(date) {
  const cutoff = new Date(date);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  return cutoff;
}

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
    rateProvider,
    rates = { VND: 1 },
    router,
  }) {
    this.now = now;
    this.rateProvider = rateProvider;
    this.rates = rates;
    this.router = router;
  }

  // eslint-disable-next-line complexity -- One pass enforces cutoff, normalization, deduplication, and provenance together.
  async collect(sources) {
    const now = this.now();
    const since = twoMonthsBefore(now);
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
    for (const message of assembleTelegramAlbums([...byMessage.values()])) {
      const classification = classifyTelegramPost(message.text, {
        targetLocation:
          message.source.focus === 'nha-trang' ? 'nha-trang' : null,
      });
      if (!classification.eligible) {
        continue;
      }
      const offer = await parseTelegramOffer(
        {
          ...message,
          messageId: message.messageIds[0],
          photos: message.mediaIds,
          sourceId: message.source.id,
        },
        { now, rates }
      );
      if (Number.isFinite(offer?.priceVnd)) {
        offer.provenance = {
          editedAt: message.editDate,
          groupedId: message.groupedId,
          messageIds: message.messageIds,
          relevance: classification,
          sourceId: message.source.id,
          topicId: message.topicId,
          transport: 'mtproto',
        };
        offers.push(offer);
      }
    }
    return offers;
  }
}
