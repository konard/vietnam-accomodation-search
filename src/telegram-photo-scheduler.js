import { setTimeout as wait } from 'node:timers/promises';
import {
  classifyTelegramError,
  retryTelegramOperation,
} from './telegram-errors.js';
import { untilAborted } from './browser-adapters.js';

// One scheduler belongs to a provider, so albums and sources share a budget.
// Native RPC waits apply to all queued lookups, including other source peers.
export class TelegramPhotoScheduler {
  constructor({ minIntervalMs = 100, now = Date.now, sleep = wait } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.now = now;
    this.sleep = sleep;
    this.tail = Promise.resolve();
    this.nextAt = 0;
    this.resolved = new Map();
    this.pending = new Map();
  }

  resolve(key, operation, { signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.resolved.has(key)) {
      return Promise.resolve(this.resolved.get(key));
    }
    if (this.pending.has(key)) {
      return untilAborted(this.pending.get(key), signal);
    }
    const work = this.run(operation, { signal }).then((result) => {
      // Only authenticated media identity can be reused. Never retain failures.
      if (
        String(result?.id ?? result?.raw?.id ?? '') === key.split(':').at(-1)
      ) {
        this.resolved.set(key, result);
        if (this.resolved.size > 512) {
          this.resolved.delete(this.resolved.keys().next().value);
        }
      }
      return result;
    });
    this.pending.set(key, work);

    work
      .finally(() => {
        if (this.pending.get(key) === work) {
          this.pending.delete(key);
        }
      })
      .catch(() => {});
    return untilAborted(work, signal).finally(() => {
      if (signal?.aborted && this.pending.get(key) === work) {
        this.pending.delete(key);
      }
    });
  }

  run(operation, { signal } = {}) {
    let active;
    const work = this.tail.then(async () => {
      signal?.throwIfAborted();
      const result = await retryTelegramOperation(
        async () => {
          const delay = Math.max(0, this.nextAt - this.now());
          if (delay) {
            await this.sleep(delay, undefined, { signal });
          }
          signal?.throwIfAborted();
          this.nextAt = this.now() + this.minIntervalMs;
          try {
            active = Promise.resolve().then(operation);
            return await untilAborted(active, signal);
          } catch (error) {
            const policy = classifyTelegramError(error);
            if (policy.category === 'rate-limit') {
              this.nextAt = Math.max(
                this.nextAt,
                this.now() + (policy.delayMs ?? 1000)
              );
            }
            throw error;
          }
        },
        {
          idempotent: true,
          signal,
          now: this.now,
          sleep: (ms) => this.sleep(ms, undefined, { signal }),
        }
      );
      return result;
    });
    // A caller deadline releases its wait, but never opens a second RPC while
    // an SDK call without cancellation is still in flight.
    this.tail = work.catch(() => {}).then(() => active?.catch(() => {}));
    return untilAborted(work, signal);
  }
}
