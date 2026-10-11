import { SESSION_FORMAT, nativeSessionPayload } from './session-envelope.js';
import { installTelegramSdkLogging } from './telegram-sdk-logging.js';
import {
  acquireTelegramClient,
  openTelegramClient,
} from './telegram-client-pool.js';

function normalizeRecipient(value) {
  const username = String(value || '')
    .trim()
    .replace(/^https?:\/\/(?:www\.)?t\.me\//iu, '')
    .replace(/^@/u, '')
    .split(/[/?#]/u)[0];
  if (!/^[A-Za-z][A-Za-z\d_]{4,31}$/u.test(username)) {
    throw new TypeError('A valid Telegram owner username is required.');
  }
  return `@${username}`;
}

export async function createMtcuteClient({ apiHash, apiId, logger }) {
  const { MemoryStorage, TelegramClient } = await import('@mtcute/node');
  return installTelegramSdkLogging(
    new TelegramClient({
      apiHash,
      apiId,
      storage: new MemoryStorage(),
    }),
    logger
  );
}

export function createAvailabilityMessage(offer) {
  const introduction = 'Hello! Is this accommodation still available?';
  const url = offer.url ? `\n${offer.url}` : '';
  const titleBudget = Math.max(0, 1_000 - introduction.length - url.length - 1);
  const title = String(offer.title || 'Accommodation').slice(0, titleBudget);
  return `${introduction}\n${title}${url}`.slice(0, 1_000);
}

export class TelegramAvailabilityService {
  constructor({
    apiHash,
    apiId,
    clientFactory = createMtcuteClient,
    expectedUserId,
    now,
    router,
    session,
    sessionFormat = SESSION_FORMAT,
    store,
  } = {}) {
    this.apiHash = apiHash;
    this.apiId = apiId;
    this.clientFactory = clientFactory;
    this.expectedUserId = expectedUserId;
    this.now = now || (() => new Date());
    this.router = router;
    this.session = session;
    this.sessionFormat = sessionFormat;
    this.store = store;
  }

  credentials() {
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
    return { apiHash: this.apiHash, apiId };
  }

  // eslint-disable-next-line complexity -- Explicit inquiry validation stays adjacent to its no-duplicate send path.
  async check(offerId, { message, recipient } = {}) {
    const credentials = this.router ? undefined : this.credentials();
    const offers = (await this.store?.listOffers?.()) || [];
    const offer = offers.find((candidate) => candidate.id === offerId);
    if (!offer) {
      throw new Error(`Offer not found: ${offerId}`);
    }
    const destination = normalizeRecipient(
      recipient || offer.contacts?.telegram?.[0]
    );
    if (this.router) {
      const sent = await this.router.send(
        destination,
        message || createAvailabilityMessage(offer),
        { idempotencyKey: `availability:${offerId}:${destination}` }
      );
      return {
        messageId: sent?.id ?? sent?.message_id,
        offerId,
        recipient: destination,
        sentAt: this.now().toISOString(),
      };
    }
    const session = nativeSessionPayload(this.session, this.sessionFormat);
    const lease = await acquireTelegramClient(
      this.clientFactory,
      [credentials.apiId, credentials.apiHash, session],
      () =>
        openTelegramClient(this.clientFactory, credentials, async (client) => {
          await client.start({ session });
          return client.getMe?.();
        })
    );
    const { client } = lease;
    let failure;
    let result;
    try {
      if (
        this.expectedUserId !== undefined &&
        String(lease.me?.id) !== String(this.expectedUserId)
      ) {
        throw new Error('Telegram identity mismatch.');
      }
      const sent = await client.sendText(
        destination,
        message || createAvailabilityMessage(offer)
      );
      result = {
        messageId: sent?.id,
        offerId,
        recipient: destination,
        sentAt: this.now().toISOString(),
      };
    } catch (error) {
      failure = error;
    }
    try {
      await lease.release();
    } catch (cleanupError) {
      if (failure) {
        throw new AggregateError(
          [failure, cleanupError],
          'Telegram availability send and client cleanup both failed.',
          { cause: cleanupError }
        );
      }
      throw cleanupError;
    }
    if (failure) {
      throw failure;
    }
    return result;
  }

  destroy() {
    return this.router?.destroy?.();
  }
}
