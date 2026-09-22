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
    drainDeadlineMs = 15_000,
    healthHost = '127.0.0.1',
    healthPort = 8080,
    logger = console,
    resources = [],
    scheduler,
    userAuth,
    userAuthOptional = false,
  } = {}) {
    this.accepting = false;
    this.bot = bot;
    this.drainDeadlineMs = drainDeadlineMs;
    this.healthHost = healthHost;
    this.healthPort = healthPort;
    this.inFlight = 0;
    this.live = false;
    this.logger = logger;
    this.ready = false;
    this.resources = resources;
    this.scheduler = scheduler;
    this.userAuth = userAuth;
    this.userAuthOptional = userAuthOptional;
    this.exitCode = 0;
    this.stopping = undefined;
    this.bot?.catch?.((failure) => this.#botError(failure?.error || failure));
  }

  health(kind = 'ready') {
    return kind === 'live'
      ? { status: this.live ? 'live' : 'stopped' }
      : { status: this.ready ? 'ready' : 'not-ready' };
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
      this.polling = this.startPromise.catch(async (error) => {
        await this.#fatal(error);
        error.exitCode = this.exitCode;
        throw error;
      });
      this.scheduler?.start?.();
      this.ready = true;
      return this;
    } catch (error) {
      await this.#fatal(error);
      error.exitCode = this.exitCode;
      throw error;
    }
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
        if (reason !== 'fatal') {
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
