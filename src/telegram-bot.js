import { parseSearchCommand } from './commands.js';
import { parseTelegramOffer } from './telegram-parser.js';

function formatPrice(offer) {
  const period = offer.price?.period ? `/${offer.price.period}` : '';
  return `${Math.round(offer.priceVnd).toLocaleString('en-US')} VND${period}`;
}

function formatPriceChange(offer) {
  const change = offer.priceChange;
  if (!change) {
    return undefined;
  }
  return `Price ${change.direction} ${Math.abs(change.deltaVnd).toLocaleString(
    'en-US'
  )} VND on ${change.sourceId}`;
}

export function formatSearchResults(offers) {
  if (!offers.length) {
    return 'No current offers with a comparable price were found.';
  }
  return offers
    .map((offer, index) =>
      [
        `${index + 1}. ${offer.title}`,
        formatPrice(offer),
        formatPriceChange(offer),
        offer.location,
        offer.url,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
}

async function sendOfferPhotos(context, offers) {
  if (typeof context.replyWithMediaGroup !== 'function') {
    return;
  }
  for (const offer of offers) {
    const media = (offer.photos || []).slice(0, 10).map((photo) => ({
      media: photo,
      type: 'photo',
    }));
    if (media.length) {
      await context.replyWithMediaGroup(media);
    }
  }
}

export function registerTelegramHandlers(bot, dependencies) {
  const { availabilityService, rateProvider, registry, service, store } =
    dependencies;

  bot.command('search', async (context) => {
    try {
      const options = parseSearchCommand(`/search ${context.match || ''}`);
      const offers = await service.search(options);
      await context.reply(formatSearchResults(offers));
      await sendOfferPhotos(context, offers);
    } catch (error) {
      await context.reply(
        `${error.message}\nUsage: /search [--cheapest [1-50]] [--filter field=value] [location]`
      );
    }
  });

  bot.command('check_availability', async (context) => {
    try {
      if (!availabilityService) {
        throw new Error(
          'Telegram user availability checks are not configured.'
        );
      }
      const [offerId, recipient] = String(context.match || '')
        .trim()
        .split(/\s+/u);
      if (!offerId) {
        throw new Error('An offer ID is required.');
      }
      const result = await availabilityService.check(offerId, { recipient });
      await context.reply(
        `Availability inquiry sent to ${result.recipient} for ${result.offerId}.`
      );
    } catch (error) {
      await context.reply(
        `${error.message}\nUsage: /check_availability OFFER_ID [@owner]`
      );
    }
  });

  bot.command('update_sources', async (context) => {
    try {
      const updated = await registry.update({ count: 20 });
      await context.reply(
        `Updated ${updated.web.length} web and ${updated.telegram.length} Telegram sources.`
      );
    } catch (error) {
      await context.reply(`Source update failed: ${error.message}`);
    }
  });

  const ingest = async (context) => {
    if (!store || !context.message) {
      return;
    }
    const rates = rateProvider ? await rateProvider.getRates() : { VND: 1 };
    const offer = await parseTelegramOffer(context.message, { rates });
    if (Number.isFinite(offer?.priceVnd)) {
      await store.saveOffers([offer]);
    }
  };
  bot.on('message:text', ingest);
  bot.on('channel_post:text', ingest);

  return bot;
}

export async function createTelegramBot(token, dependencies) {
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to start the bot.');
  }
  const { Bot } = await import('grammy');
  return registerTelegramHandlers(new Bot(token), dependencies);
}
