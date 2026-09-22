function numericSet(values = []) {
  return new Set(
    values
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter((value) => /^-?\d+$/u.test(value))
  );
}

export class TelegramAccessPolicy {
  constructor({
    allowedChatIds = [],
    allowedUserIds = [],
    mode = 'private',
    now = Date.now,
    publicLimit = 10,
    publicWindowMs = 60_000,
  } = {}) {
    if (!['private', 'public'].includes(mode)) {
      throw new TypeError(`Unsupported Telegram access mode: ${mode}`);
    }
    this.allowedChatIds = numericSet(allowedChatIds);
    this.allowedUserIds = numericSet(allowedUserIds);
    this.mode = mode;
    this.now = now;
    this.publicLimit = publicLimit;
    this.publicWindowMs = publicWindowMs;
    this.usage = new Map();
  }

  #identities(context) {
    return {
      chatId:
        context.chat?.id === undefined ? undefined : String(context.chat.id),
      userId:
        context.from?.id === undefined ? undefined : String(context.from.id),
    };
  }

  // eslint-disable-next-line complexity -- Authorization keeps every fail-closed branch in one auditable policy method.
  authorize(context, { action = 'command', privileged = false } = {}) {
    const { chatId, userId } = this.#identities(context);
    const allowed =
      (userId && this.allowedUserIds.has(userId)) ||
      (chatId && this.allowedChatIds.has(chatId));
    if (privileged && !allowed) {
      throw new Error('This privileged command is not authorized.');
    }
    if (this.mode === 'private' && !allowed) {
      throw new Error(
        'This bot is private and this numeric user/chat ID is not authorized.'
      );
    }
    if (
      this.mode === 'public' &&
      !privileged &&
      ['search', 'subscribe'].includes(action)
    ) {
      const key = `${userId || 'none'}:${chatId || 'none'}:${action}`;
      const now = this.now();
      const current = this.usage.get(key);
      const usage =
        !current || now - current.startedAt >= this.publicWindowMs
          ? { count: 0, startedAt: now }
          : current;
      usage.count += 1;
      this.usage.set(key, usage);
      if (usage.count > this.publicLimit) {
        throw new Error(
          'Telegram command rate limit exceeded; try again later.'
        );
      }
    }
    return { chatId, userId };
  }
}
