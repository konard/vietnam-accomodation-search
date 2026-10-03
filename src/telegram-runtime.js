import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import {
  classifyTelegramError,
  redactTelegramValue,
} from './telegram-errors.js';

function exitCode(error) {
  const category = classifyTelegramError(error).category;
  return category === 'auth' ? 20 : category === 'conflict' ? 21 : 1;
}

export const CONFLICT_BACKOFF = Object.freeze({
  baseMs: 5_000,
  maxMs: 5 * 60_000,
});
export const CONFLICT_MESSAGE =
  'telegram polling conflict: another poller holds this bot token';

/**
 * Delay before polling again after the nth consecutive conflict: exponential
 * from `baseMs`, capped at `maxMs`, with jitter in its upper half so two
 * instances sharing a token do not stay in lockstep.
 */
export function conflictDelay(
  attempt,
  { baseMs, maxMs } = CONFLICT_BACKOFF,
  random = Math.random
) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function closeResource(resource) {
  if (typeof resource.destroy === 'function') {
    return resource.destroy();
  }
  if (typeof resource.close === 'function') {
    return resource.close();
  }
  return resource.disconnect?.();
}

function withinDeadline(operation, deadline, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(message)),
      Math.max(0, deadline - Date.now())
    );
    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function captureFailure(operation, failures) {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}

export class TelegramRuntime {
  constructor({
    bot,
    conflictBackoff = CONFLICT_BACKOFF,
    drainDeadlineMs = 15_000,
    healthHost = '127.0.0.1',
    healthPort = 8080,
    logger = console,
    random = Math.random,
    resources = [],
    scheduler,
    userAuth,
    userAuthOptional = false,
  } = {}) {
    this.accepting = false;
    this.backoff = new AbortController();
    this.bot = bot;
    this.conflictBackoff = conflictBackoff;
    this.conflicts = 0;
    this.conflicted = false;
    this.drainDeadlineMs = drainDeadlineMs;
    this.healthHost = healthHost;
    this.healthPort = healthPort;
    this.inFlight = 0;
    this.live = false;
    this.logger = logger;
    this.random = random;
    this.ready = false;
    this.resources = resources;
    this.scheduler = scheduler;
    this.userAuth = userAuth;
    this.userAuthOptional = userAuthOptional;
    this.exitCode = 0;
    this.stopping = undefined;
    this.bot?.catch?.((failure) => this.#botError(failure?.error || failure));
    this.observesPolling = this.#observePolling();
  }

  // A successful getUpdates proves this instance owns polling again.
  #observePolling() {
    const config = this.bot?.api?.config;
    if (typeof config?.use !== 'function') {
      return false;
    }
    config.use(async (previous, method, ...rest) => {
      const result = await previous(method, ...rest);
      if (method === 'getUpdates' && result?.ok) {
        this.#pollingSucceeded();
      }
      return result;
    });
    return true;
  }

  health(kind = 'ready') {
    if (kind === 'live') {
      return { status: this.live ? 'live' : 'stopped' };
    }
    if (this.ready) {
      return { status: 'ready' };
    }
    return this.conflicted
      ? {
          conflicts: this.conflicts,
          reason: 'polling-conflict',
          status: 'not-ready',
        }
      : { status: 'not-ready' };
  }

  async #listen() {
    if (this.healthPort === null) {
      return;
    }
    this.server = createServer((request, response) => {
      const kind = request.url === '/live' ? 'live' : 'ready';
      const body = JSON.stringify(this.health(kind));
      const healthy = kind === 'live' ? this.live : this.ready;
      response.writeHead(healthy ? 200 : 503, {
        'content-type': 'application/json',
      });
      response.end(body);
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.healthPort, this.healthHost, resolve);
    });
  }

  async start() {
    this.live = true;
    await this.#listen();
    try {
      await this.bot?.api?.getMe?.();
      try {
        await this.userAuth?.validate?.();
      } catch (error) {
        if (!this.userAuthOptional) {
          throw error;
        }
        this.logger.warn?.(
          'Telegram user authentication failed; continuing bot-only.',
          redactTelegramValue(error)
        );
        this.userAuth = undefined;
      }
      this.accepting = true;
      let initialized;
      let pollingReady = false;
      const pollingInitialized = new Promise((resolve) => {
        initialized = () => {
          pollingReady = true;
          resolve();
        };
      });
      this.startPromise = Promise.resolve(
        this.bot?.start?.({ onStart: initialized })
      );
      const pollingEnded = this.startPromise.then(() => {
        if (!pollingReady) {
          throw new Error('Telegram polling stopped before readiness.');
        }
      });
      await Promise.race([pollingInitialized, pollingEnded]);
      this.polling = this.#supervise(this.startPromise);
      this.scheduler?.start?.();
      this.ready = true;
      return this;
    } catch (error) {
      await this.#fatal(error);
      error.exitCode = this.exitCode;
      throw error;
    }
  }

  // Polling conflicts after readiness are retried with backoff while the
  // instance reports not-ready; every other polling failure is fatal.
  async #supervise(polling) {
    for (let current = polling; ;) {
      try {
        return await current;
      } catch (error) {
        if (classifyTelegramError(error).category !== 'conflict') {
          await this.#fatal(error);
          error.exitCode = this.exitCode;
          throw error;
        }
        if (this.stopping) {
          return undefined;
        }
        await this.#conflictBackoff();
        if (this.stopping) {
          return undefined;
        }
        current = Promise.resolve(
          this.bot.start({
            onStart: () => {
              if (!this.observesPolling) {
                this.#pollingSucceeded();
              }
            },
          })
        );
        this.startPromise = current;
      }
    }
  }

  async #conflictBackoff() {
    this.conflicts += 1;
    this.conflicted = true;
    this.ready = false;
    const retryInMs = conflictDelay(
      this.conflicts,
      this.conflictBackoff,
      this.random
    );
    this.logger.error?.(CONFLICT_MESSAGE, {
      conflicts: this.conflicts,
      retryInMs,
    });
    await delay(retryInMs, undefined, { signal: this.backoff.signal }).catch(
      () => {}
    );
  }

  #pollingSucceeded() {
    if (!this.conflicted || this.stopping) {
      return;
    }
    this.conflicted = false;
    this.ready = true;
    this.logger.info?.('telegram polling resumed', {
      conflicts: this.conflicts,
    });
  }

  async middleware(_context, next) {
    if (!this.accepting) {
      return;
    }
    this.inFlight += 1;
    try {
      return await next();
    } finally {
      this.inFlight -= 1;
    }
  }

  async #botError(error) {
    const policy = classifyTelegramError(error);
    if (policy.fatal) {
      await this.#fatal(error);
    } else {
      this.logger.warn?.('telegram update failed', redactTelegramValue(error));
    }
  }

  async #fatal(error) {
    this.exitCode = exitCode(error);
    this.ready = false;
    this.logger.error?.(
      'fatal telegram runtime error',
      redactTelegramValue(error)
    );
    try {
      await this.stop('fatal');
    } catch (stopError) {
      this.logger.error?.(
        'telegram shutdown failed',
        redactTelegramValue(stopError)
      );
    }
  }

  stop(reason = 'shutdown') {
    if (this.stopping) {
      return this.stopping;
    }
    this.stopping = this.#stop(reason);
    return this.stopping;
  }

  async #stop(reason) {
    this.ready = false;
    this.accepting = false;
    this.backoff.abort();
    const failures = [];
    const deadline = Date.now() + this.drainDeadlineMs;
    const stopOperations = [
      () => this.scheduler?.stop?.(),
      () => this.bot?.stop?.(),
    ].map((operation) => captureFailure(operation, failures));
    try {
      await withinDeadline(
        Promise.all(stopOperations),
        deadline,
        'Timed out stopping Telegram polling or subscription scheduling.'
      );
    } catch (error) {
      failures.push(error);
    }
    if (this.startPromise) {
      try {
        await withinDeadline(
          this.startPromise,
          deadline,
          'Timed out waiting for Telegram polling to stop.'
        );
      } catch (error) {
        // A poll evicted by another poller has already ended.
        if (
          reason !== 'fatal' &&
          classifyTelegramError(error).category !== 'conflict'
        ) {
          failures.push(error);
        }
      }
    }
    while (this.inFlight > 0 && Date.now() < deadline) {
      await delay(10);
    }
    if (this.inFlight > 0) {
      failures.push(
        new Error(`Timed out draining ${this.inFlight} Telegram updates.`)
      );
    }
    const resourceOperations = this.resources.map((resource) =>
      captureFailure(() => closeResource(resource), failures)
    );
    try {
      await withinDeadline(
        Promise.all(resourceOperations),
        deadline,
        'Timed out waiting for Telegram resource cleanup.'
      );
    } catch (error) {
      failures.push(error);
    }
    if (this.server) {
      try {
        await withinDeadline(
          closeServer(this.server),
          deadline,
          'Timed out closing the Telegram health server.'
        );
      } catch (error) {
        failures.push(error);
      }
    }
    this.live = false;
    this.logger.info?.('telegram runtime stopped', { reason });
    if (failures.length) {
      if (this.exitCode === 0) {
        this.exitCode = 22;
      }
      throw new AggregateError(
        failures,
        'Telegram runtime shutdown was incomplete.'
      );
    }
  }

  installSignalHandlers(processLike = process) {
    const handler = () => {
      void this.stop('signal')
        .catch((error) =>
          this.logger.error?.(
            'telegram shutdown failed',
            redactTelegramValue(error)
          )
        )
        .finally(() => {
          processLike.exitCode = this.exitCode;
        });
    };
    processLike.once('SIGINT', handler);
    processLike.once('SIGTERM', handler);
    return () => {
      processLike.off('SIGINT', handler);
      processLike.off('SIGTERM', handler);
    };
  }
}

function updateIdentity(update) {
  if (update.update_id !== undefined) {
    return `update:${update.update_id}`;
  }
  const message =
    update.edited_message ||
    update.edited_channel_post ||
    update.channel_post ||
    update.message;
  if (!message) {
    return undefined;
  }
  const edited = update.edited_message || update.edited_channel_post;
  return `message:${message.chat?.id}:${message.message_id}:${message.edit_date || message.date || 0}:${edited ? 'edit' : 'new'}`;
}

export class UpdateDeduplicator {
  constructor({ maxEntries = 10_000, now = () => new Date(), store }) {
    this.maxEntries = maxEntries;
    this.now = now;
    this.store = store;
    this.pending = Promise.resolve();
  }

  accept(update) {
    const operation = this.pending.then(async () => {
      const id = updateIdentity(update);
      if (!id) {
        return true;
      }
      if (typeof this.store.updateRecords === 'function') {
        let accepted = false;
        await this.store.updateRecords('telegram-updates', (records) => {
          if (records.some((record) => record.id === id)) {
            return records;
          }
          accepted = true;
          records.push({ id, receivedAt: this.now().toISOString() });
          return records.slice(-this.maxEntries);
        });
        return accepted;
      }
      const records = await this.store.loadRecords('telegram-updates');
      if (records.some((record) => record.id === id)) {
        return false;
      }
      records.push({ id, receivedAt: this.now().toISOString() });
      await this.store.saveRecords(
        'telegram-updates',
        records.slice(-this.maxEntries)
      );
      return true;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
