const DEFAULT_PRESET = 'default';
const MAX_SHOWN_OFFERS = 10_000;

function userKey(value) {
  const key = String(value || '').trim();
  if (!/^-?\d+$/u.test(key)) {
    throw new TypeError('A numeric Telegram user ID is required.');
  }
  return key;
}

export function normalizePresetName(value) {
  const name = String(value || '')
    .trim()
    .toLocaleLowerCase('en');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(name)) {
    throw new TypeError(
      'Preset names must be 1-32 letters, numbers, underscores, or hyphens.'
    );
  }
  return name;
}

function defaultUserState() {
  return {
    activePreset: DEFAULT_PRESET,
    presets: { [DEFAULT_PRESET]: {} },
    shownOfferIds: [],
  };
}

function stateFor(state, id) {
  state.users ||= {};
  state.users[id] ||= defaultUserState();
  state.users[id].presets ||= { [DEFAULT_PRESET]: {} };
  state.users[id].presets[DEFAULT_PRESET] ||= {};
  state.users[id].activePreset ||= DEFAULT_PRESET;
  state.users[id].shownOfferIds ||= [];
  return state.users[id];
}

export function mergeSearchOptions(base = {}, overrides = {}) {
  const merged = { ...base, ...overrides };
  if (base.filters || overrides.filters) {
    merged.filters = { ...(base.filters || {}), ...(overrides.filters || {}) };
  }
  return merged;
}

export class SearchPresetService {
  constructor({ now, store } = {}) {
    this.now = now || (() => new Date());
    this.store = store;
    this.queue = Promise.resolve();
  }

  async read() {
    return (await this.store?.loadSearchState?.()) || { users: {} };
  }

  update(operation) {
    const pending = this.queue.then(async () => {
      const state = await this.read();
      const result = await operation(state);
      await this.store?.saveSearchState?.(state);
      return result;
    });
    this.queue = pending.catch(() => {});
    return pending;
  }

  async resolve(userId, overrides = {}, presetName) {
    const state = await this.read();
    const user = stateFor(state, userKey(userId));
    const name = presetName
      ? normalizePresetName(presetName)
      : user.activePreset;
    const preset = user.presets[name];
    if (!preset) {
      throw new Error(`Search preset not found: ${name}`);
    }
    return mergeSearchOptions(preset, overrides);
  }

  async list(userId) {
    const state = await this.read();
    const user = stateFor(state, userKey(userId));
    return Object.entries(user.presets)
      .map(([name, options]) => ({
        active: name === user.activePreset,
        name,
        options,
        subscribed: name === user.subscription?.preset,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  save(userId, presetName, overrides = {}) {
    return this.update((state) => {
      const user = stateFor(state, userKey(userId));
      const name = normalizePresetName(presetName);
      user.presets[name] = mergeSearchOptions(
        user.presets[user.activePreset],
        overrides
      );
      return { name, options: user.presets[name] };
    });
  }

  use(userId, presetName) {
    return this.update((state) => {
      const user = stateFor(state, userKey(userId));
      const name = normalizePresetName(presetName);
      if (!user.presets[name]) {
        throw new Error(`Search preset not found: ${name}`);
      }
      user.activePreset = name;
      return { name, options: user.presets[name] };
    });
  }

  remove(userId, presetName) {
    return this.update((state) => {
      const user = stateFor(state, userKey(userId));
      const name = normalizePresetName(presetName);
      if (name === DEFAULT_PRESET) {
        throw new Error('The default search preset cannot be deleted.');
      }
      if (!user.presets[name]) {
        throw new Error(`Search preset not found: ${name}`);
      }
      if (user.subscription?.preset === name) {
        throw new Error('Stop or switch the subscription before deleting it.');
      }
      delete user.presets[name];
      if (user.activePreset === name) {
        user.activePreset = DEFAULT_PRESET;
      }
      return name;
    });
  }

  subscribe(userId, presetName) {
    return this.update((state) => {
      const user = stateFor(state, userKey(userId));
      const name = presetName
        ? normalizePresetName(presetName)
        : user.activePreset;
      if (!user.presets[name]) {
        throw new Error(`Search preset not found: ${name}`);
      }
      user.subscription = {
        preset: name,
        startedAt: this.now().toISOString(),
      };
      return { name, options: user.presets[name] };
    });
  }

  unsubscribe(userId) {
    return this.update((state) => {
      const user = stateFor(state, userKey(userId));
      const previous = user.subscription;
      delete user.subscription;
      return previous;
    });
  }

  async activeSubscriptions() {
    const state = await this.read();
    return Object.entries(state.users || {})
      .filter(([, user]) => user.subscription?.preset)
      .map(([id, user]) => ({ id, preset: user.subscription.preset }));
  }

  async unseen(userId, offers) {
    const state = await this.read();
    const user = stateFor(state, userKey(userId));
    const shown = new Set(user.shownOfferIds);
    return offers.filter((offer) => offer.id && !shown.has(offer.id));
  }

  markShown(userId, offers) {
    const ids = offers.map((offer) => offer.id).filter(Boolean);
    if (!ids.length) {
      return Promise.resolve();
    }
    return this.update((state) => {
      const user = stateFor(state, userKey(userId));
      user.shownOfferIds = [...new Set([...user.shownOfferIds, ...ids])].slice(
        -MAX_SHOWN_OFFERS
      );
    });
  }
}

export class TelegramSubscriptionService {
  constructor({
    delivery,
    intervalMs = 15 * 60 * 1000,
    logger,
    presets,
    search,
  }) {
    this.delivery = delivery;
    this.intervalMs = intervalMs;
    this.logger = logger || console;
    this.presets = presets;
    this.search = search;
    this.timer = undefined;
    this.running = false;
  }

  async runFor(userId, presetName) {
    const options = await this.presets.resolve(userId, {}, presetName);
    const offers = await this.search.search({
      ...options,
      limit: Math.min(options.limit || 50, 50),
      refresh: true,
    });
    const unseen = await this.presets.unseen(userId, offers);
    if (unseen.length) {
      await this.delivery(userId, unseen);
      await this.presets.markShown(userId, unseen);
    }
    return unseen;
  }

  async runOnce() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      for (const subscription of await this.presets.activeSubscriptions()) {
        try {
          await this.runFor(subscription.id, subscription.preset);
        } catch (error) {
          this.logger.error?.(
            `Subscription refresh failed for Telegram user ${subscription.id}: ${error.message}`
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) {
      return;
    }
    void this.runOnce();
    this.timer = globalThis.setInterval(
      () => void this.runOnce(),
      this.intervalMs
    );
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      globalThis.clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
