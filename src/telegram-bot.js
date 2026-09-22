import { parseSearchCommand } from './commands.js';
import { SubscriptionScheduler } from './presets.js';
import { parseTelegramOffer } from './telegram-parser.js';
import { stableHash } from './utils.js';

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

async function replyBounded(context, text, maximum = 4096) {
  let remaining = text;
  while (remaining.length > maximum) {
    let boundary = remaining.lastIndexOf('\n\n', maximum);
    if (boundary < 1) {
      boundary = maximum;
    }
    await context.reply(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\s+/u, '');
  }
  await context.reply(remaining);
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

function boundedMessages(text, maximum = 4096) {
  const messages = [];
  let remaining = text;
  while (remaining.length > maximum) {
    let boundary = remaining.lastIndexOf('\n\n', maximum);
    if (boundary < 1) {
      boundary = maximum;
    }
    messages.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\s+/u, '');
  }
  messages.push(remaining);
  return messages;
}

export async function deliverSubscriptionOffers(
  api,
  chatId,
  offers,
  { maxProgress = 10_000, store } = {}
) {
  const progress = store ? await store.loadRecords('delivery-progress') : [];
  const completed = new Set(progress.map(({ id }) => id));
  const runStep = async (id, operation) => {
    if (completed.has(id)) {
      return;
    }
    await operation();
    if (store) {
      const record = { id, completedAt: new Date().toISOString() };
      progress.push(record);
      completed.add(id);
      if (typeof store.updateRecords === 'function') {
        await store.updateRecords('delivery-progress', (records) =>
          [...records.filter((candidate) => candidate.id !== id), record].slice(
            -maxProgress
          )
        );
      } else {
        await store.saveRecords(
          'delivery-progress',
          progress.slice(-maxProgress)
        );
      }
    }
  };
  for (const offer of offers) {
    const deliveryId = stableHash(
      `${chatId}\n${offer.identityKeys?.[0] || offer.id}`
    );
    for (const [index, message] of boundedMessages(
      formatSearchResults([offer])
    ).entries()) {
      await runStep(`${deliveryId}:text:${index}`, () =>
        api.sendMessage(chatId, message)
      );
    }
    const media = (offer.photos || []).slice(0, 10).map((photo) => ({
      media: photo,
      type: 'photo',
    }));
    if (media.length) {
      await runStep(`${deliveryId}:media`, () =>
        api.sendMediaGroup(chatId, media)
      );
    }
  }
}

export function telegramRuntimeMiddleware(bot) {
  return (context, next) =>
    bot.runtime ? bot.runtime.middleware(context, next) : next();
}

export function telegramDeduplicationMiddleware(updateDeduplicator) {
  return async (context, next) => {
    if (await updateDeduplicator.accept(context.update)) {
      return next();
    }
  };
}

// eslint-disable-next-line max-lines-per-function -- Registration keeps the complete Telegram command surface visible in one place.
export function registerTelegramHandlers(bot, dependencies) {
  const {
    availabilityService,
    accessPolicy,
    presetService,
    rateProvider,
    registry,
    service,
    store,
    subscriptionScheduler,
  } = dependencies;

  const userId = (context) => {
    const value = context.from?.id ?? context.chat?.id;
    if (value === undefined) {
      throw new Error(
        'This command requires a Telegram user or chat identity.'
      );
    }
    return String(value);
  };

  bot.command('search', async (context) => {
    try {
      accessPolicy?.authorize(context, { action: 'search' });
      const overrides = parseSearchCommand(`/search ${context.match || ''}`, {
        defaults: false,
      });
      const options = presetService
        ? await presetService.resolveSearch(userId(context), overrides)
        : overrides;
      const offers = await service.search(options);
      if (!offers.length) {
        await replyBounded(context, formatSearchResults(offers));
      }
      for (const offer of offers) {
        await replyBounded(context, formatSearchResults([offer]));
        await sendOfferPhotos(context, [offer]);
        await presetService?.markDelivered?.(userId(context), [offer]);
      }
    } catch (error) {
      await context.reply(
        `${error.message}\nUsage: /search [--cheapest [1-50]] [--filter field=value] [location]`
      );
    }
  });

  bot.command('preset', async (context) => {
    try {
      accessPolicy?.authorize(context, { action: 'search' });
      if (!presetService) {
        throw new Error('Preset storage is not configured.');
      }
      const [action = 'list', name, ...searchTokens] = String(
        context.match || ''
      )
        .trim()
        .split(/\s+/u);
      const owner = userId(context);
      if (action === 'list') {
        const active = await presetService.activeName(owner);
        const presets = await presetService.list(owner);
        await context.reply(
          presets.length
            ? presets
                .map(
                  (preset) =>
                    `${preset.name}${preset.name === active ? ' (active)' : ''}`
                )
                .join('\n')
            : 'No saved presets.'
        );
      } else if (action === 'show') {
        const preset = await presetService.show(owner, name);
        await context.reply(
          `${preset.name}: ${JSON.stringify(preset.options)}`
        );
      } else if (action === 'save') {
        const options = parseSearchCommand(
          `/search ${searchTokens.join(' ')}`,
          { defaults: false }
        );
        await presetService.save(owner, name, options);
        await context.reply(`Saved preset ${name}.`);
      } else if (action === 'use') {
        await presetService.use(owner, name);
        await context.reply(`Active preset: ${name}.`);
      } else if (action === 'delete') {
        await presetService.delete(owner, name);
        await context.reply(`Deleted preset ${name}.`);
      } else {
        throw new Error(`Unknown preset action: ${action}`);
      }
    } catch (error) {
      await context.reply(
        `${error.message}\nUsage: /preset list|show NAME|save NAME [SEARCH OPTIONS]|use NAME|delete NAME`
      );
    }
  });

  bot.command('subscribe', async (context) => {
    try {
      accessPolicy?.authorize(context, { action: 'subscribe' });
      if (!presetService) {
        throw new Error('Subscription storage is not configured.');
      }
      const name = String(context.match || '').trim() || undefined;
      const subscription = await presetService.subscribe(userId(context), name);
      await subscriptionScheduler?.tick?.();
      await context.reply(
        `Subscribed to preset ${subscription?.presetName || name}.`
      );
    } catch (error) {
      await context.reply(`${error.message}\nUsage: /subscribe [PRESET]`);
    }
  });

  bot.command('unsubscribe', async (context) => {
    try {
      accessPolicy?.authorize(context, { action: 'subscribe' });
      if (!presetService) {
        throw new Error('Subscription storage is not configured.');
      }
      await presetService.unsubscribe(userId(context));
      await context.reply('Subscription disabled.');
    } catch (error) {
      await context.reply(error.message);
    }
  });

  bot.command('subscription', async (context) => {
    try {
      accessPolicy?.authorize(context, { action: 'subscribe' });
      if (!presetService) {
        throw new Error('Subscription storage is not configured.');
      }
      const subscription = await presetService.subscription(userId(context));
      await context.reply(
        subscription
          ? `Subscribed to ${subscription.presetName}; last successful search: ${subscription.lastSuccessfulRunAt || 'not yet'}.`
          : 'No active subscription.'
      );
    } catch (error) {
      await context.reply(error.message);
    }
  });

  bot.command('check_availability', async (context) => {
    try {
      accessPolicy?.authorize(context, { privileged: true });
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
      accessPolicy?.authorize(context, { privileged: true });
      const updated = await registry.update({
        focusCount: 40,
        telegramCount: 20,
        webCount: 20,
      });
      await context.reply(
        `Updated ${updated.web.length} web and ${updated.telegram.length} Telegram sources.`
      );
    } catch (error) {
      await context.reply(`Source update failed: ${error.message}`);
    }
  });

  const ingest = async (context) => {
    const message =
      context.message ||
      context.editedMessage ||
      context.channelPost ||
      context.editedChannelPost;
    if (!store || !message) {
      return;
    }
    const rates = rateProvider ? await rateProvider.getRates() : { VND: 1 };
    const offer = await parseTelegramOffer(message, { rates });
    if (Number.isFinite(offer?.priceVnd)) {
      if (context.editedMessage || context.editedChannelPost) {
        await store.deleteOffersByMessages?.(offer.sourceId, [
          message.message_id,
        ]);
      }
      offer.provenance = {
        editedAt: message.edit_date,
        groupedId: message.media_group_id,
        messageId: message.message_id,
        sourceId: offer.sourceId,
        topicId: message.message_thread_id,
        transport: 'bot-api',
      };
      await store.saveOffers([offer]);
    }
  };
  bot.on('message:text', ingest);
  bot.on('message:caption', ingest);
  bot.on('channel_post:text', ingest);
  bot.on('channel_post:caption', ingest);
  bot.on('edited_message:text', ingest);
  bot.on('edited_message:caption', ingest);
  bot.on('edited_channel_post:text', ingest);
  bot.on('edited_channel_post:caption', ingest);

  return bot;
}

export async function createTelegramBot(token, dependencies) {
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to start the bot.');
  }
  const { Bot } = await import('grammy');
  const bot = new Bot(token);
  const availabilityService =
    dependencies.createAvailabilityService?.(bot.api) ||
    dependencies.availabilityService;
  bot.resources = availabilityService ? [availabilityService] : [];
  bot.use(telegramRuntimeMiddleware(bot));
  if (dependencies.updateDeduplicator) {
    bot.use(telegramDeduplicationMiddleware(dependencies.updateDeduplicator));
  }
  if (dependencies.presetService && dependencies.service) {
    bot.subscriptionScheduler = new SubscriptionScheduler({
      deliver: (userId, offers) =>
        deliverSubscriptionOffers(bot.api, userId, offers, {
          store: dependencies.store,
        }),
      intervalMs: dependencies.subscriptionIntervalMs,
      logger: dependencies.logger,
      presets: dependencies.presetService,
      search: (options) => dependencies.service.search(options),
      store: dependencies.store,
      traceRecorder: dependencies.traceRecorder,
    });
  }
  registerTelegramHandlers(bot, {
    ...dependencies,
    availabilityService,
    subscriptionScheduler: bot.subscriptionScheduler,
  });
  return bot;
}
