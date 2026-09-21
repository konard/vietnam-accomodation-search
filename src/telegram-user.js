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

async function createMtcuteClient({ apiHash, apiId }) {
  const { MemoryStorage, TelegramClient } = await import('@mtcute/node');
  return new TelegramClient({
    apiHash,
    apiId,
    storage: new MemoryStorage(),
  });
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
    now,
    session,
    store,
  } = {}) {
    this.apiHash = apiHash;
    this.apiId = apiId;
    this.clientFactory = clientFactory;
    this.now = now || (() => new Date());
    this.session = session;
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

  async check(offerId, { message, recipient } = {}) {
    const credentials = this.credentials();
    const offers = (await this.store?.listOffers?.()) || [];
    const offer = offers.find((candidate) => candidate.id === offerId);
    if (!offer) {
      throw new Error(`Offer not found: ${offerId}`);
    }
    const destination = normalizeRecipient(
      recipient || offer.contacts?.telegram?.[0]
    );
    const client = await this.clientFactory(credentials);
    try {
      await client.start({ session: this.session });
      const sent = await client.sendText(
        destination,
        message || createAvailabilityMessage(offer)
      );
      return {
        messageId: sent?.id,
        offerId,
        recipient: destination,
        sentAt: this.now().toISOString(),
      };
    } finally {
      await client.destroy();
    }
  }
}
