import { clearInterval, setInterval } from 'node:timers';

import { TraceRecorder } from './trace.js';

function validName(value) {
  const name = String(value || '')
    .normalize('NFC')
    .trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u.test(name)) {
    throw new TypeError(
      'Preset names may contain letters, numbers, dot, dash, and underscore.'
    );
  }
  return name;
}

function identityAliases(offer) {
  return [
    ...new Set(
      [
        ...(offer.identityKeys || []),
        offer.id,
        offer.url,
        offer.officialUrl,
        ...(offer.variants || []).flatMap((variant) => [
          variant.id,
          variant.url,
          variant.officialUrl,
        ]),
      ]
        .filter(Boolean)
        .map(String)
    ),
  ].sort();
}

function sortedObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortedObject);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortedObject(child)])
    );
  }
  return value;
}

function groupKey(options) {
  return JSON.stringify(sortedObject(options));
}

function mergeOptions(base, overrides) {
  const filters =
    base.filters || overrides.filters
      ? { ...(base.filters || {}), ...(overrides.filters || {}) }
      : undefined;
  return {
    ...base,
    ...overrides,
    ...(filters ? { filters } : {}),
  };
}

export class PresetService {
  constructor({ maxShownPerUser = 500, now = () => new Date(), store }) {
    this.maxShownPerUser = maxShownPerUser;
    this.now = now;
    this.store = store;
    this.pending = Promise.resolve();
  }

  #change(task) {
    const operation = this.pending.then(task, task);
    this.pending = operation.catch(() => {});
    return operation;
  }

  #records(kind) {
    return this.store.loadRecords(kind);
  }

  async #updateRecords(kind, update) {
    if (typeof this.store.updateRecords === 'function') {
      return this.store.updateRecords(kind, update);
    }
    const next = await update(await this.#records(kind));
    await this.store.saveRecords(kind, next);
    return next;
  }

  async list(userId) {
    const owner = String(userId);
    const presets = (await this.#records('presets'))
      .filter((preset) => preset.userId === String(userId))
      .sort((left, right) => left.name.localeCompare(right.name));
    return [
      {
        id: `${owner}:default`,
        name: 'default',
        options: {},
        userId: owner,
      },
      ...presets,
    ];
  }

  async show(userId, name) {
    const selected = name || (await this.activeName(userId));
    const preset = (await this.list(userId)).find(
      (candidate) => candidate.name === validName(selected)
    );
    if (!preset) {
      throw new Error(`Preset ${selected} does not exist.`);
    }
    return preset;
  }

  async activeName(userId) {
    const setting = (await this.#records('user-settings')).find(
      (candidate) => candidate.userId === String(userId)
    );
    return setting?.activePresetName || 'default';
  }

  async activeOptions(userId) {
    return (await this.show(userId, await this.activeName(userId))).options;
  }

  save(userId, name, overrides = {}) {
    return this.#change(async () => {
      const normalizedName = validName(name);
      if (normalizedName === 'default') {
        throw new Error('The built-in default preset cannot be overwritten.');
      }
      const owner = String(userId);
      const options = mergeOptions(await this.activeOptions(owner), overrides);
      const record = {
        id: `${owner}:${normalizedName}`,
        name: normalizedName,
        options,
        userId: owner,
      };
      await this.#updateRecords('presets', (presets) => {
        const next = presets.filter((preset) => preset.id !== record.id);
        next.push(record);
        return next;
      });
      return record;
    });
  }

  use(userId, name) {
    return this.#change(async () => {
      const owner = String(userId);
      const normalizedName = validName(name);
      await this.show(owner, normalizedName);
      await this.#updateRecords('user-settings', (settings) => {
        const next = settings.filter((setting) => setting.userId !== owner);
        next.push({
          activePresetName: normalizedName,
          id: owner,
          userId: owner,
        });
        return next;
      });
    });
  }

  delete(userId, name) {
    return this.#change(async () => {
      const normalizedName = validName(name);
      const owner = String(userId);
      if (normalizedName === 'default') {
        throw new Error('The default preset cannot be deleted.');
      }
      if ((await this.activeName(owner)) === normalizedName) {
        throw new Error('An active preset cannot be deleted.');
      }
      const subscribed = (await this.#records('subscriptions')).some(
        (subscription) =>
          subscription.userId === owner &&
          subscription.presetName === normalizedName
      );
      if (subscribed) {
        throw new Error('A subscribed preset cannot be deleted.');
      }
      await this.#updateRecords('presets', (presets) => {
        const next = presets.filter(
          (preset) =>
            !(preset.userId === owner && preset.name === normalizedName)
        );
        if (next.length === presets.length) {
          throw new Error(`Preset ${normalizedName} does not exist.`);
        }
        return next;
      });
    });
  }

  async resolveSearch(userId, overrides) {
    return mergeOptions(await this.activeOptions(userId), overrides);
  }

  subscribe(userId, name) {
    return this.#change(async () => {
      const owner = String(userId);
      const presetName = name ? validName(name) : await this.activeName(owner);
      const preset = await this.show(owner, presetName);
      const record = {
        id: owner,
        options: preset.options,
        presetName,
        userId: owner,
      };
      await this.#updateRecords('subscriptions', (subscriptions) => {
        const next = subscriptions.filter(
          (subscription) => subscription.userId !== owner
        );
        next.push(record);
        return next;
      });
      return record;
    });
  }

  unsubscribe(userId) {
    return this.#change(async () => {
      const owner = String(userId);
      await this.#updateRecords('subscriptions', (subscriptions) =>
        subscriptions.filter((subscription) => subscription.userId !== owner)
      );
    });
  }

  async subscription(userId) {
    return (await this.#records('subscriptions')).find(
      (candidate) => candidate.userId === String(userId)
    );
  }

  listSubscriptions() {
    return this.#records('subscriptions');
  }

  async unseen(userId, offers) {
    const shown = (await this.#records('shown-offers')).filter(
      (record) => record.userId === String(userId)
    );
    const aliases = new Set(shown.flatMap((record) => record.aliases));
    return offers.filter(
      (offer) => !identityAliases(offer).some((alias) => aliases.has(alias))
    );
  }

  #updateDeliveryRecords(userId, offers, update) {
    return this.#change(async () => {
      const owner = String(userId);
      await this.#updateRecords('shown-offers', (shown) => {
        const others = shown.filter((record) => record.userId !== owner);
        const owned = new Map(
          shown
            .filter((record) => record.userId === owner)
            .map((record) => [record.id, record])
        );
        for (const offer of offers) {
          const aliases = identityAliases(offer);
          const id = `${owner}:${aliases[0] || offer.id}`;
          const record = update({
            aliases,
            existing: owned.get(id),
            id,
            owner,
          });
          owned.delete(id);
          owned.set(id, record);
        }
        return [...others, ...[...owned.values()].slice(-this.maxShownPerUser)];
      });
    });
  }

  prepareDelivery(userId, offers) {
    return this.#updateDeliveryRecords(
      userId,
      offers,
      ({ aliases, existing, id, owner }) =>
        existing?.deliveredAt
          ? existing
          : {
              aliases,
              deliveryState: 'prepared',
              id,
              preparedAt: this.now().toISOString(),
              userId: owner,
            }
    );
  }

  markDelivered(userId, offers) {
    return this.#updateDeliveryRecords(
      userId,
      offers,
      ({ aliases, id, owner }) => ({
        aliases,
        deliveredAt: this.now().toISOString(),
        id,
        userId: owner,
      })
    );
  }

  markSuccessfulRun(userId, date = this.now()) {
    return this.#change(async () => {
      const owner = String(userId);
      await this.#updateRecords('subscriptions', (subscriptions) => {
        const subscription = subscriptions.find(
          (item) => item.userId === owner
        );
        if (subscription) {
          subscription.lastSuccessfulRunAt = date.toISOString();
        }
        return subscriptions;
      });
    });
  }
}

export class SubscriptionScheduler {
  constructor({
    deliver,
    intervalMs = 15 * 60 * 1000,
    logger = console,
    maxAgeMs = 6 * 60 * 60 * 1000,
    now = () => new Date(),
    presets,
    search,
    store,
    traceRecorder,
  }) {
    this.deliver = deliver;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    this.presets = presets;
    this.search = search;
    this.trace = traceRecorder || new TraceRecorder({ now, store });
    this.running = undefined;
    this.timer = undefined;
  }

  start() {
    if (!this.timer) {
      const run = () =>
        void this.tick().catch((error) =>
          this.logger.error?.('subscription search failed', {
            error: error.message,
          })
        );
      run();
      this.timer = setInterval(run, this.intervalMs);
    }
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  tick() {
    if (this.running) {
      return this.running;
    }
    this.running = this.#run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async #run() {
    const subscriptions = await this.presets.listSubscriptions();
    const groups = new Map();
    for (const subscription of subscriptions) {
      const key = groupKey(subscription.options);
      groups.set(key, [...(groups.get(key) || []), subscription]);
    }
    let groupIndex = 0;
    for (const group of groups.values()) {
      groupIndex += 1;
      const now = this.now();
      const runId = `subscription:${now.toISOString()}:${groupIndex}`;
      this.trace.record({
        runId,
        stage: 'subscription-search',
        status: 'start',
      });
      let offers;
      try {
        offers = (
          await this.search({ ...group[0].options, traceRunId: runId })
        ).filter((offer) => {
          const collectedAt = new Date(offer.collectedAt).getTime();
          const age = now.getTime() - collectedAt;
          return (
            Number.isFinite(collectedAt) && age >= 0 && age <= this.maxAgeMs
          );
        });
        this.trace.record({
          runId,
          stage: 'subscription-search',
          status: 'success',
          metadata: { offers: offers.length },
        });
      } catch (error) {
        this.trace.record({
          runId,
          stage: 'subscription-search',
          status: 'failure',
          metadata: { code: error?.code, message: error?.message },
        });
        await this.trace.persist();
        throw error;
      }
      for (const subscription of group) {
        await this.presets.markSuccessfulRun(subscription.userId, now);
        const unseen = await this.presets.unseen(subscription.userId, offers);
        for (const offer of unseen) {
          this.trace.record({
            runId,
            offerId: offer.id,
            stage: 'delivery',
            status: 'start',
          });
          try {
            await this.deliver(subscription.userId, [offer], { runId });
            await this.presets.markDelivered(subscription.userId, [offer]);
            this.trace.record({
              runId,
              offerId: offer.id,
              stage: 'delivery',
              status: 'success',
            });
          } catch (error) {
            this.trace.record({
              runId,
              offerId: offer.id,
              stage: 'delivery',
              status: 'failure',
              metadata: { code: error?.code, message: error?.message },
            });
            this.logger.warn?.('subscription delivery failed', {
              error: error.message,
              offerId: offer.id,
            });
            break;
          }
        }
      }
      await this.trace.persist();
    }
  }
}
